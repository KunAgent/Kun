import { BrowserWindow } from 'electron'
import {
  getKunRuntimeSettings,
  MIN_KUN_LOCAL_PORT,
  resolveKunRuntimeSettings,
  type AppSettingsPatch,
  type AppSettingsV1
} from '../shared/app-settings'
import type { KunRuntimeSettingsSyncStatusPayload } from '../shared/kun-gui-api'
import { parseRuntimeErrorBody } from '../shared/runtime-error'
import {
  getRuntimeBaseUrlForSettings,
  kunRuntimeAdapter,
  runtimeAuthHeaders,
  runtimeRequestViaHost,
  runtimeRequestViaLease,
  type RuntimeRequestInit,
  type RuntimeRequestLease
} from './runtime/kun-adapter'
import { waitForRuntimeTurnsIdle } from './runtime/managed-runtime-idle'
import {
  resolveKunDataDir,
  syncGuiManagedKunConfig,
  waitForKunStartupSettled
} from './kun-process'
import { managedKunHostCanAutoStart } from './managed-runtime-startup-policy'
import { logError, logInfo, logWarn } from './logger'
import {
  buildManagedRuntimeHotApplyBody,
  classifyManagedRuntimeHotApplyResponse
} from './runtime/kun-runtime-config-service'
import {
  applyRuntimeSettingsRollback,
  runtimeProcessConfigChanged,
  runtimeRollbackTerminalStatus,
  runtimeRollbackTargetUnchanged,
  runtimeSettingsApplyMode
} from './runtime-settings-apply-mode'
import {
  getClawScheduleMcpLaunchConfig,
  mainState,
  runtimeFailure,
  runtimeSettingsIntents
} from './main-app-context'
import {
  kunRuntimeHealthMonitor,
  noteRuntimeHealthy,
  publishRuntimeStatus,
  runtimeSupervisor
} from './main-runtime-health'
import {
  ensureKunRuntime,
  ensureRuntime,
  resolveManagedKunLaunchSettings
} from './main-runtime-startup'
import { reconcileBrowserUseHostForRuntime } from './browser-use/browser-use-host'
import { bundledSkillsDirectory } from './bundled-skill-resources'

export function publishRuntimeSettingsSyncStatus(
  status: Omit<KunRuntimeSettingsSyncStatusPayload, 'at'>
): void {
  const full = { ...status, at: new Date().toISOString() }
  mainState.runtimeSettingsSyncStatus = full
  for (const win of BrowserWindow.getAllWindows()) {
    if (!win.isDestroyed()) win.webContents.send('runtime:settings-sync-status', full)
  }
}

type RuntimeSettingsApplyReservation = {
  generation: number
  shouldApply: boolean
}

/**
 * Record persisted intent before any post-save await. This closes the window
 * in which an older failed apply could otherwise roll back a newer snapshot
 * that was already durable but had not yet entered the lifecycle lane.
 */
export function reserveRuntimeSettingsApply(
  prev: AppSettingsV1,
  next: AppSettingsV1
): RuntimeSettingsApplyReservation {
  runtimeSupervisor.noteLatest(next)
  if (!managedKunHostCanAutoStart(next)) {
    runtimeSupervisor.setManagedRuntimeExpected(false)
  }
  const generation = runtimeSettingsIntents.reserve()
  const applyMode = runtimeSettingsApplyMode(mainState.settledRuntimeSettings ?? prev, next)
  if (applyMode === 'none' && !runtimeSupervisor.hasPendingOperation()) {
    mainState.settledRuntimeSettings = next
    publishRuntimeSettingsSyncStatus({ state: 'synced', generation })
    return { generation, shouldApply: false }
  }
  publishRuntimeSettingsSyncStatus({ state: 'syncing', generation })
  return { generation, shouldApply: true }
}

export function queueRuntimeSettingsApply(
  prev: AppSettingsV1,
  next: AppSettingsV1,
  reservation: RuntimeSettingsApplyReservation,
  prepare: () => Promise<void>
): void {
  const { generation, shouldApply } = reservation
  // A later persisted snapshot owns reconciliation. Its preparation is
  // part of the same FIFO node, so skipping a not-yet-enqueued stale
  // generation cannot reorder derived config files.
  if (!runtimeSettingsIntents.isCurrent(generation)) return

  const reportCurrent = (
    outcome: Pick<KunRuntimeSettingsSyncStatusPayload, 'state' | 'message'>
  ): void => {
    if (!runtimeSettingsIntents.isCurrent(generation)) return
    publishRuntimeSettingsSyncStatus({
      state: outcome.state,
      generation,
      ...(outcome.message ? { message: outcome.message } : {})
    })
  }

  runtimeSupervisor.enqueueSettingsApply(
    async () => {
      if (!runtimeSettingsIntents.isCurrent(generation)) return
      await prepare()
      if (!runtimeSettingsIntents.isCurrent(generation)) return
      if (!shouldApply) return
      // Keep this operation's target fixed. The coordinator alone may replace
      // an adjacent, not-yet-started settings task; reading a process-global
      // "latest" snapshot here would apply a later setting across an
      // intervening ensure/restart barrier.
      const current = next
      const applyStillCurrent = (): boolean =>
        runtimeSettingsIntents.isCurrent(generation) &&
        runtimeSupervisor.latestOr(current) === current
      const anchor = mainState.settledRuntimeSettings ?? prev
      const currentMode = runtimeSettingsApplyMode(anchor, current)
      if (currentMode === 'restart') {
        const outcome = await restartManagedRuntimeForSettingsChange(
          anchor,
          current,
          false,
          () => runtimeSettingsIntents.isCurrent(generation)
        )
        if (outcome.state !== 'failed') mainState.settledRuntimeSettings = current
        reportCurrent(outcome)
      } else if (currentMode === 'hot' || kunRuntimeAdapter.isChildRunning()) {
        let result = await applyManagedRuntimeSettingsHot(
          current,
          'settings-apply',
          applyStillCurrent
        )
        if (result === 'superseded') return
        if (result === 'skipped' && managedKunHostCanAutoStart(current)) {
          await ensureKunRuntime(current)
          if (!applyStillCurrent()) return
          result = await applyManagedRuntimeSettingsHot(
            current,
            'settings-apply',
            applyStillCurrent
          )
          if (result === 'superseded') return
        }
        if (result === 'restart_required') {
          const outcome = await restartManagedRuntimeForSettingsChange(
            anchor,
            current,
            true,
            () => runtimeSettingsIntents.isCurrent(generation)
          )
          if (outcome.state !== 'failed') mainState.settledRuntimeSettings = current
          reportCurrent(outcome)
        } else if (result === 'applied') {
          mainState.settledRuntimeSettings = current
          reportCurrent({ state: 'synced' })
        } else if (result === 'failed') {
          reportCurrent({
            state: 'failed',
            message: 'Kun rejected the updated configuration; the existing Runtime was kept running.'
          })
        } else {
          mainState.settledRuntimeSettings = current
          reportCurrent({ state: 'unavailable', message: 'Kun Runtime is not running.' })
        }
      } else {
        // A no-mode successor is still queued when a predecessor owned the
        // lifecycle lane at reservation time. The predecessor may have taken
        // Runtime down before failing, so equal settings do not imply equal
        // process state. Reconcile availability before declaring success.
        let outcome: ManagedRuntimeSettingsApplyOutcome
        if (managedKunHostCanAutoStart(current)) {
          try {
            await ensureKunRuntime(current)
            outcome = { state: 'synced' }
          } catch (error) {
            const message = error instanceof Error ? error.message : String(error)
            publishRuntimeStatus({
              state: 'failed',
              source: 'settings-apply',
              message: `Kun could not be reconciled with the latest durable settings: ${message}`
            })
            outcome = { state: 'failed', message }
          }
        } else {
          outcome = await restartManagedRuntimeForSettingsChange(
            anchor,
            current,
            true,
            () => runtimeSettingsIntents.isCurrent(generation)
          )
        }
        if (outcome.state !== 'failed') mainState.settledRuntimeSettings = current
        reportCurrent(outcome)
      }
    },
    (error: unknown) => {
      const message = error instanceof Error ? error.message : String(error)
      reportCurrent({ state: 'failed', message })
      logWarn('settings-apply', 'Failed to apply Kun runtime settings in background', {
        message
      })
    },
    'runtime-settings'
  )
}

export function queueRuntimeMcpConfigApply(settings: AppSettingsV1): void {
  const settingsGeneration = mainState.runtimeSettingsSyncStatus.state === 'syncing'
    ? runtimeSettingsIntents.currentGeneration
    : null
  const reportSettingsOutcome = (outcome: ManagedRuntimeSettingsApplyOutcome): void => {
    if (
      settingsGeneration === null ||
      !runtimeSettingsIntents.isCurrent(settingsGeneration) ||
      mainState.runtimeSettingsSyncStatus.state !== 'syncing'
    ) return
    publishRuntimeSettingsSyncStatus({
      state: outcome.state,
      generation: settingsGeneration,
      ...(outcome.message ? { message: outcome.message } : {})
    })
  }
  runtimeSupervisor.enqueueSettingsApply(
    async () => {
      const current = settings
      const result = await applyManagedRuntimeSettingsHot(current, 'mcp-config')
      if (result === 'restart_required') {
        reportSettingsOutcome(await restartManagedRuntimeForMcpConfigChange(current))
      } else if (result === 'applied') {
        reportSettingsOutcome({ state: 'synced' })
      } else if (result === 'failed') {
        reportSettingsOutcome({
          state: 'failed',
          message: 'Kun rejected the MCP configuration; the existing Runtime was kept running.'
        })
      } else {
        reportSettingsOutcome({ state: 'unavailable', message: 'Kun Runtime is not running.' })
      }
    },
    (error: unknown) => {
      reportSettingsOutcome({
        state: 'failed',
        message: error instanceof Error ? error.message : String(error)
      })
      logWarn('mcp-config', 'Failed to apply Kun MCP config change in background', {
        message: error instanceof Error ? error.message : String(error)
      })
    },
    'mcp-config'
  )
}


export function validateRuntimeSettingsForApply(next: AppSettingsV1): string | null {
  const runtime = resolveKunRuntimeSettings(next)
  if (!Number.isInteger(runtime.port) || runtime.port < MIN_KUN_LOCAL_PORT || runtime.port > 65_535) {
    return `Kun port must be an integer between ${MIN_KUN_LOCAL_PORT} and 65535 (got ${String(runtime.port)})`
  }
  const baseUrl = (runtime.baseUrl ?? '').trim()
  if (baseUrl) {
    try {
      const parsed = new URL(baseUrl)
      if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
        return `model base URL must use http(s): ${baseUrl}`
      }
    } catch {
      return `model base URL is not a valid URL: ${baseUrl}`
    }
  }
  return null
}

export function preserveRuntimeTokenForFullSettingsSnapshot(
  prev: AppSettingsV1,
  partial: AppSettingsPatch
): AppSettingsPatch {
  const incomingKun = partial.agents?.kun
  if (!incomingKun || !isFullSettingsSnapshotPatch(partial)) return partial
  if (typeof incomingKun.runtimeToken !== 'string' || incomingKun.runtimeToken.trim()) return partial

  const currentToken = getKunRuntimeSettings(prev).runtimeToken.trim()
  if (!currentToken) return partial

  return {
    ...partial,
    agents: {
      ...partial.agents,
      kun: {
        ...incomingKun,
        runtimeToken: currentToken
      }
    }
  }
}

function isFullSettingsSnapshotPatch(partial: AppSettingsPatch): boolean {
  return partial.version !== undefined &&
    partial.provider !== undefined &&
    partial.agents?.kun !== undefined &&
    partial.log !== undefined &&
    partial.checkpointCleanup !== undefined &&
    partial.notifications !== undefined &&
    partial.appBehavior !== undefined &&
    partial.keyboardShortcuts !== undefined &&
    partial.write !== undefined &&
    partial.claw !== undefined &&
    partial.schedule !== undefined &&
    partial.workflow !== undefined &&
    partial.terminal !== undefined &&
    partial.guiUpdate !== undefined
}

type ManagedRuntimeHotApplyResult =
  | 'applied'
  | 'skipped'
  | 'superseded'
  | 'restart_required'
  | 'failed'
type ManagedRuntimeSettingsApplyOutcome = Pick<
  KunRuntimeSettingsSyncStatusPayload,
  'state' | 'message'
>

export async function applyManagedRuntimeSettingsHot(
  settings: AppSettingsV1,
  source: string,
  shouldApply: () => boolean = () => true
): Promise<ManagedRuntimeHotApplyResult> {
  mainState.assertCanonicalRuntimeMigrationReady()
  await waitForKunStartupSettled()
  if (!shouldApply()) return 'superseded'
  const adapter = kunRuntimeAdapter
  if (!adapter.isChildRunning()) return 'skipped'

  const runtime = resolveKunRuntimeSettings(settings)
  const dataDir = resolveKunDataDir(runtime)
  const config = await syncGuiManagedKunConfig(dataDir, runtime, {
    scheduleMcp: {
      settings,
      launch: getClawScheduleMcpLaunchConfig()
    },
    builtinSkillsRoot: bundledSkillsDirectory()
  })
  if (!shouldApply()) return 'superseded'
  const browserUseHost = await reconcileBrowserUseHostForRuntime(
    settings,
    shouldApply
  )
  if (!browserUseHost.current || !shouldApply()) return 'superseded'
  const browserUseHostBinding = browserUseHost.binding
  const body = buildManagedRuntimeHotApplyBody(
    settings,
    config,
    browserUseHostBinding
      ? {
          bridgeUrl: browserUseHostBinding.url,
          bridgeToken: browserUseHostBinding.token,
          approvalSigningKey: browserUseHostBinding.approvalSigningKey
        }
      : null
  )

  const headers = runtimeAuthHeaders(settings)
  headers.set('content-type', 'application/json')
  try {
    const response = await fetch(
      `${getRuntimeBaseUrlForSettings(settings)}/v1/runtime/config/apply`,
      {
        method: 'POST',
        headers,
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(120_000)
      }
    )
    const text = await response.text()
    if (!shouldApply()) return 'superseded'
    const outcome = classifyManagedRuntimeHotApplyResponse(response.status, response.ok, text)
    if (outcome.result === 'applied') {
      noteRuntimeHealthy(source, settings)
      return 'applied'
    }
    if (outcome.result === 'restart_required') {
      logWarn(source, `Kun hot config apply requested restart: ${outcome.message}`)
      return 'restart_required'
    }
    logWarn(source, `Kun rejected hot config without restart: ${outcome.message}`)
    return 'failed'
  } catch (error) {
    if (!shouldApply()) return 'superseded'
    const message = error instanceof Error ? error.message : String(error)
    logWarn(source, `Kun hot config apply failed; falling back to restart: ${message}`)
    return 'restart_required'
  }
}

async function restartManagedRuntimeForSettingsChange(
  prev: AppSettingsV1,
  next: AppSettingsV1,
  force = false,
  shouldRollback = (): boolean => true
): Promise<ManagedRuntimeSettingsApplyOutcome> {
  if (!force && !runtimeProcessConfigChanged(prev, next)) return { state: 'synced' }

  // Let any in-flight boot launch finish (or fail) before we read liveness
  // and stop the child. Killing a kun that is still inside its startup window
  // throws away the boot's progress and restarts the clock — the #544 restart
  // storm. Once it settles, the child is either healthy (graceful restart
  // below) or already gone (in which case auto-start launches the new
  // configuration without trying to stop a nonexistent process).
  await waitForKunStartupSettled()

  const runtime = resolveKunRuntimeSettings(next)
  const adapter = kunRuntimeAdapter
  const wasRunning = adapter.isChildRunning()

  if (wasRunning) {
    const safeToStop = await waitForManagedRuntimeReadyBeforeStop(prev, 'settings-apply')
    if (!safeToStop) {
      return {
        state: 'failed',
        message: 'Kun still has active work or its turn state could not be verified; restart was deferred.'
      }
    }
  }
  // Filesystem discovery is only a mirror. Always ask the Manager-aware
  // adapter to stop the authoritative registration, even when the mirror (and
  // therefore isChildRunning()) disappeared.
  await adapter.stopSharedAndWait(prev)
  if (!runtime.autoStart) {
    publishRuntimeStatus({
      state: 'stopped',
      source: 'settings-apply',
      message: 'Kun was stopped because automatic startup is disabled.'
    })
    return { state: 'unavailable', message: 'Kun Runtime is stopped by the current settings.' }
  }

  publishRuntimeStatus({ state: 'restarting', source: 'settings-apply' })
  try {
    const launchSettings = await resolveManagedKunLaunchSettings(next, 'settings-apply')
    await adapter.ensureRunning(launchSettings)
    const healthy = await kunRuntimeHealthMonitor.waitForHealthy(launchSettings, 20_000)
    if (!healthy) {
      throw new Error('Kun did not become healthy after the settings change')
    }
    noteRuntimeHealthy('settings-apply', launchSettings)
    publishRuntimeStatus({ state: 'running', source: 'settings-apply' })
    return { state: 'synced' }
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e)
    logWarn('settings-apply', `Kun restart failed after settings change: ${message}`)
    await rollbackRuntimeSettingsAfterFailedApply(prev, next, message, shouldRollback)
    return { state: 'failed', message }
  }
}

/**
 * A settings change took the runtime down and the new config cannot
 * boot. Restore the previous runtime/provider settings on disk (so the
 * next app launch is not bricked either) and bring kun back up on the
 * last-known-good configuration.
 */
async function rollbackRuntimeSettingsAfterFailedApply(
  prev: AppSettingsV1,
  desired: AppSettingsV1,
  failureMessage: string,
  shouldRollback: () => boolean
): Promise<void> {
  const adapter = kunRuntimeAdapter
  let base: AppSettingsV1 | null = null
  let rollbackCommitFailure = ''
  try {
    base = await runtimeSettingsIntents.serializePersistence(async () => {
      // Route definitions are durable user intent, not process-critical
      // launch settings. Keep them repairable while restoring the previous
      // Runtime/provider transport configuration.
      const rollback = await mainState.store.updateIf(
        (current) => shouldRollback() && runtimeRollbackTargetUnchanged(current, desired),
        (current) => applyRuntimeSettingsRollback(current, prev, desired)
      )
      if (!rollback.applied) return null
      const restored = rollback.settings
      runtimeSupervisor.noteLatest(restored)
      return restored
    })
  } catch (error) {
    rollbackCommitFailure = error instanceof Error ? error.message : String(error)
    logWarn('settings-apply', 'failed to restore previous runtime settings on disk', {
      message: rollbackCommitFailure
    })
  }
  if (rollbackCommitFailure) {
    publishRuntimeStatus(runtimeRollbackTerminalStatus({
      outcome: { kind: 'commit_failed', detail: rollbackCommitFailure },
      isCurrent: false,
      applyFailure: failureMessage
    }))
    return
  }
  if (!base) {
    logInfo('settings-apply', 'Skipped stale Runtime settings rollback because newer settings are durable.')
    publishRuntimeStatus(runtimeRollbackTerminalStatus({
      outcome: { kind: 'superseded' },
      isCurrent: false,
      applyFailure: failureMessage
    }))
    return
  }
  if (!managedKunHostCanAutoStart(base)) {
    runtimeSupervisor.setManagedRuntimeExpected(false)
  }
  mainState.settledRuntimeSettings = base
  const rollbackIsStillCurrent = async (): Promise<boolean> => {
    if (!shouldRollback()) return false
    try {
      return runtimeRollbackTargetUnchanged(await mainState.store.load(), base)
    } catch (error) {
      logWarn('settings-apply', 'Could not confirm that Runtime rollback status is still current.', {
        message: error instanceof Error ? error.message : String(error)
      })
      return false
    }
  }
  if (!getKunRuntimeSettings(base).autoStart) {
    const current = await rollbackIsStillCurrent()
    publishRuntimeStatus(runtimeRollbackTerminalStatus({
      outcome: { kind: 'stopped' },
      isCurrent: current,
      applyFailure: failureMessage
    }))
    return
  }
  try {
    const launchSettings = await resolveManagedKunLaunchSettings(base, 'settings-apply-rollback')
    await adapter.ensureRunning(launchSettings)
    const healthy = await kunRuntimeHealthMonitor.waitForHealthy(launchSettings, 20_000)
    if (!healthy) {
      throw new Error('previous configuration did not become healthy')
    }
    noteRuntimeHealthy('settings-apply-rollback', launchSettings)
    const current = await rollbackIsStillCurrent()
    publishRuntimeStatus(runtimeRollbackTerminalStatus({
      outcome: { kind: 'running' },
      isCurrent: current,
      applyFailure: failureMessage
    }))
  } catch (error) {
    const current = await rollbackIsStillCurrent()
    const restoreFailure = error instanceof Error ? error.message : String(error)
    publishRuntimeStatus(runtimeRollbackTerminalStatus({
      outcome: { kind: 'restore_failed', detail: restoreFailure },
      isCurrent: current,
      applyFailure: failureMessage
    }))
  }
}

async function restartManagedRuntimeForMcpConfigChange(
  settings: AppSettingsV1
): Promise<ManagedRuntimeSettingsApplyOutcome> {
  // See restartManagedRuntimeForSettingsChange: never interrupt an in-flight
  // boot launch (#544 restart storm).
  await waitForKunStartupSettled()

  const runtime = resolveKunRuntimeSettings(settings)
  const adapter = kunRuntimeAdapter
  const wasRunning = adapter.isChildRunning()

  if (wasRunning) {
    const safeToStop = await waitForManagedRuntimeReadyBeforeStop(settings, 'mcp-config')
    if (!safeToStop) {
      return {
        state: 'failed',
        message: 'Kun still has active work or its turn state could not be verified; restart was deferred.'
      }
    }
  }
  await adapter.stopSharedAndWait(settings)
  if (!runtime.autoStart) {
    return { state: 'unavailable', message: 'Kun Runtime is stopped by the current settings.' }
  }

  publishRuntimeStatus({ state: 'restarting', source: 'mcp-config' })
  try {
    const launchSettings = await resolveManagedKunLaunchSettings(settings, 'mcp-config')
    await adapter.ensureRunning(launchSettings)
    const healthy = await kunRuntimeHealthMonitor.waitForHealthy(launchSettings, 20_000)
    if (!healthy) {
      throw new Error('Kun did not become healthy after the MCP config change')
    }
    noteRuntimeHealthy('mcp-config', launchSettings)
    publishRuntimeStatus({ state: 'running', source: 'mcp-config' })
    return { state: 'synced' }
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e)
    logWarn('mcp-config', `Kun restart failed after MCP config change: ${message}`)
    publishRuntimeStatus({
      state: 'failed',
      source: 'mcp-config',
      message: `Kun failed to restart after the MCP config change: ${message}. Check the MCP config file, then retry.`
    })
    return { state: 'failed', message }
  }
}

async function waitForManagedRuntimeReadyBeforeStop(
  settings: AppSettingsV1,
  source: string
): Promise<boolean> {
  const healthy = await kunRuntimeHealthMonitor.waitForHealthy(settings, 20_000)
  if (!healthy) {
    logWarn(source, 'Kun did not become healthy before a managed restart; restart was deferred')
    return false
  }
  const idle = await waitForRuntimeTurnsIdle({ settings })
  if (idle === 'timeout') {
    logWarn(source, 'Kun still has running turns after waiting; restart was deferred')
    return false
  } else if (idle === 'unavailable') {
    logWarn(source, 'Could not verify Kun turn idleness before a managed restart; restart was deferred')
    return false
  }
  return true
}

export async function runtimeRequest(
  settings: AppSettingsV1,
  pathAndQuery: string,
  init: RuntimeRequestInit
): Promise<{ ok: boolean; status: number; body: string }> {
  try {
    return await runtimeRequestViaHost(settings, pathAndQuery, init, ensureRuntime)
  } catch (e) {
    if (init.signal?.aborted) return runtimeFailure('aborted', 'Runtime request was cancelled.', 0)
    const message = e instanceof Error ? e.message : String(e)
    logError('runtime-request', `HTTP request to ${pathAndQuery} failed`, { message })
    const parsed = parseRuntimeErrorBody(message, message)
    if (parsed.code !== 'unknown' || parsed.message !== message) {
      return runtimeFailure(parsed.code, parsed.message, 0, parsed.details)
    }
    return runtimeFailure('fetch_failed', message)
  }
}

export async function runtimeRequestOnLease(
  lease: RuntimeRequestLease,
  pathAndQuery: string,
  init: RuntimeRequestInit
): Promise<{ ok: boolean; status: number; body: string }> {
  try {
    return await runtimeRequestViaLease(lease, pathAndQuery, init)
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e)
    logError('runtime-request', 'Leased protected Runtime request failed', {
      route: '/v1/approvals/:id',
      message
    })
    const parsed = parseRuntimeErrorBody(message, message)
    if (parsed.code !== 'unknown' || parsed.message !== message) {
      return runtimeFailure(parsed.code, parsed.message, 0, parsed.details)
    }
    return runtimeFailure('fetch_failed', message)
  }
}
