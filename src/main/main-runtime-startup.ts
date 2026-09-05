import { randomBytes } from 'node:crypto'
import {
  applyKunRuntimePatch,
  getKunRuntimeSettings,
  type AppSettingsV1
} from '../shared/app-settings'
import {
  kunRuntimeAdapter
} from './runtime/kun-adapter'
import {
  isKunChildRunning,
  waitForKunStartupSettled
} from './kun-process'
import { clearHistoricalKunServeProcesses } from './runtime/kun-serve-process-cleanup'
import { waitForRuntimeTurnsIdle } from './runtime/managed-runtime-idle'
import { managedKunHostCanAutoStart } from './managed-runtime-startup-policy'
import { logWarn } from './logger'
import { defaultKunControlDir } from '../../kun/src/manager/manager-discovery.js'
import {
  mainState,
  runtimeJsonError
} from './main-app-context'
import { drainKunOwnersForHandoff } from './runtime/kun-installed-build-handoff'
import { logKunHandoffEvent } from './runtime/kun-handoff-logging'
import {
  kunRuntimeHealthMonitor,
  noteRuntimeHealthy,
  probeRuntimeApi,
  RUNTIME_HUNG_CONFIRM_MS,
  runtimeFingerprint,
  runtimeSupervisor
} from './main-runtime-health'

export async function ensureRuntime(settings: AppSettingsV1): Promise<AppSettingsV1> {
  const requested = runtimeSupervisor.latestOr(settings)
  // Availability is the durable intent, not a reward for one successful
  // launch. Arm recovery before the first attempt so a cold-start failure is
  // retried automatically by the watchdog.
  if (managedKunHostCanAutoStart(requested)) {
    runtimeSupervisor.setManagedRuntimeExpected(true)
  }
  mainState.assertCanonicalRuntimeMigrationReady()
  const fingerprint = runtimeFingerprint(requested)
  return runtimeSupervisor.ensure(
    fingerprint,
    // Freeze this FIFO node to the snapshot used for its fingerprint. A later
    // persisted settings snapshot has its own queued apply node and must not
    // jump across this lifecycle barrier.
    () => ensureRuntimeOnce(requested)
  )
}

async function ensureRuntimeOnce(settings: AppSettingsV1): Promise<AppSettingsV1> {
  return ensureKunRuntime(settings)
}

export async function resolveManagedKunLaunchSettings(
  settings: AppSettingsV1,
  source: string
): Promise<AppSettingsV1> {
  const token = await ensureManagedKunRuntimeToken(settings, source)
  return resolveManagedKunPort(token.settings, source, 0)
}

function generateKunRuntimeToken(): string {
  return randomBytes(32).toString('base64url')
}

export async function ensureManagedKunRuntimeToken(
  settings: AppSettingsV1,
  source: string
): Promise<{ settings: AppSettingsV1; generated: boolean }> {
  if (getKunRuntimeSettings(settings).runtimeToken.trim()) {
    return { settings, generated: false }
  }
  const candidate = generateKunRuntimeToken()
  const result = await mainState.store.updateIf(
    (current) => !getKunRuntimeSettings(current).runtimeToken.trim(),
    (current) => applyKunRuntimePatch(current, { runtimeToken: candidate })
  )
  runtimeSupervisor.noteLatest(result.settings)
  if (result.applied) {
    logWarn(source, 'Generated a local access token for the GUI-owned Kun Runtime.')
  }
  return { settings: result.settings, generated: result.applied }
}

async function resolveManagedKunPort(
  settings: AppSettingsV1,
  source: string,
  retry: number
): Promise<AppSettingsV1> {
  const runtime = getKunRuntimeSettings(settings)
  const resolved = await kunRuntimeAdapter.resolveAvailablePort(runtime.port)
  if (!resolved.changed) return settings
  const result = await mainState.store.updateIf(
    (current) => getKunRuntimeSettings(current).port === runtime.port,
    (current) => applyKunRuntimePatch(current, { port: resolved.port })
  )
  runtimeSupervisor.noteLatest(result.settings)
  if (result.applied) {
    logWarn(source, `Kun port ${runtime.port} is unavailable; using ${resolved.port}.`, {
      previousPort: runtime.port,
      port: resolved.port,
      message: resolved.message
    })
    return result.settings
  }
  return retry === 0
    ? resolveManagedKunPort(result.settings, source, 1)
    : result.settings
}

function noteSuccessfulRuntimeSettings(source: string, settings: AppSettingsV1): AppSettingsV1 {
  mainState.settledRuntimeSettings = settings
  runtimeSupervisor.noteLatest(settings)
  noteRuntimeHealthy(source, settings)
  return settings
}

export async function ensureKunRuntime(settings: AppSettingsV1): Promise<AppSettingsV1> {
  const token = await ensureManagedKunRuntimeToken(settings, 'runtime-start')
  const currentSettings = token.settings
  if (token.generated && kunRuntimeAdapter.isChildRunning()) {
    // Only stop the controller-held child that inherited the old empty token.
    await kunRuntimeAdapter.stopAndWait()
  }
  const connectionResolved = await kunRuntimeAdapter.resolveConnection(currentSettings)

  const runtime = getKunRuntimeSettings(currentSettings)

  const healthy = connectionResolved &&
    // Match the watchdog probe budget: a single big scan (large events.jsonl
    // cold read) can exceed 2s without the runtime being unhealthy, and the
    // hung path below still provides the multi-second confirmation window.
    await kunRuntimeHealthMonitor.waitForHealthy(currentSettings, 5_000)
  if (healthy) {
    const runtimeApi = await probeRuntimeApi(currentSettings)
    if (runtimeApi.ok) {
      return noteSuccessfulRuntimeSettings('ensure', currentSettings)
    }
    throw runtimeJsonError(runtimeApi.error, runtimeApi.message)
  }

  if (!runtime.autoStart) {
    throw runtimeJsonError(
      'runtime_offline',
      'Kun is offline. Enable automatic startup in Settings, or start `kun serve` manually.'
    )
  }

  // A GUI-owned child that failed the probe may only be busy or waking from
  // system sleep. Give it a real recovery window before replacing it.
  if (kunRuntimeAdapter.isChildRunning()) {
    // Never tear down a child still inside its (deliberately generous) startup
    // window — interrupting a slow-but-healthy boot is the #544 restart storm.
    await waitForKunStartupSettled()
    if (kunRuntimeAdapter.isChildRunning()) {
      // Give a merely-busy runtime a real chance to answer before judging it
      // hung, so one long synchronous step does not cost the user their turn.
      const recovered = await kunRuntimeHealthMonitor.waitForHealthy(currentSettings, RUNTIME_HUNG_CONFIRM_MS)
      if (recovered) {
        const runtimeApi = await probeRuntimeApi(currentSettings)
        if (runtimeApi.ok) {
          return noteSuccessfulRuntimeSettings('ensure', currentSettings)
        }
        throw runtimeJsonError(runtimeApi.error, runtimeApi.message)
      }
      if (!isKunChildRunning()) {
        throw runtimeJsonError(
          'runtime_unhealthy',
          'Kun is still running but temporarily unresponsive. Its active runtime was preserved; retry after it recovers.'
        )
      }
      // The controller-held GUI child can be replaced safely in place.
      logWarn(
        'runtime-start',
        `GUI-private Kun child stopped responding on port ${runtime.port}; restarting it in place`
      )
      await kunRuntimeAdapter.stopSharedAndWait(currentSettings)
    }
  }

  let launchSettings = await resolveManagedKunLaunchSettings(currentSettings, 'runtime-start')
  const adapter = kunRuntimeAdapter
  try {
    await adapter.ensureRunning(launchSettings)
  } catch (error) {
    if (!isRuntimePortConflict(error)) {
      if (isClientRuntimeOwnerConflict(error)) {
        runtimeSupervisor.setManagedRuntimeExpected(false)
      }
      console.error('[kun-gui] failed to start kun:', error)
      throw error
    }
    launchSettings = await resolveManagedKunPort(
      runtimeSupervisor.latestOr(launchSettings),
      'runtime-start-retry',
      1
    )
    try {
      await adapter.ensureRunning(launchSettings)
    } catch (retryError) {
      console.error('[kun-gui] failed to start kun after selecting another port:', retryError)
      throw retryError
    }
  }
  const started = await kunRuntimeHealthMonitor.waitForHealthy(launchSettings, 20_000)
  if (!started) {
    throw runtimeJsonError(
      'runtime_unhealthy',
      'Kun did not become healthy after launch.'
    )
  }

  const runtimeApi = await probeRuntimeApi(launchSettings)
  if (!runtimeApi.ok) {
    throw runtimeJsonError(runtimeApi.error, runtimeApi.message)
  }
  return noteSuccessfulRuntimeSettings('ensure', launchSettings)
}

function isRuntimePortConflict(error: unknown): boolean {
  if (!(error instanceof Error)) return false
  const code = String((error as Error & { code?: unknown }).code ?? '')
  return code === 'EADDRINUSE' ||
    code === 'runtime_port_conflict' ||
    /(?:EADDRINUSE|address already in use|port \d+ is in use)/i.test(error.message)
}

function isClientRuntimeOwnerConflict(error: unknown): boolean {
  return error instanceof Error &&
    String((error as Error & { code?: unknown }).code ?? '') === 'client_runtime_owner_busy'
}

export async function prepareGuiRuntimeForStartupRetry(error?: unknown): Promise<void> {
  // Fence the watchdog before cleanup so it cannot launch a replacement while
  // the recovery window is preparing a new Electron instance.
  runtimeSupervisor.setManagedRuntimeExpected(false)
  await runtimeSupervisor.waitForIdle()
  await kunRuntimeAdapter.stopAndWait()
  if (!isServiceManagerDataMutexFailure(error)) return

  // A Manager state-write failure is sticky for the lifetime of that Manager:
  // relaunching only the Runtime reconnects to the same poisoned write queue
  // and repeats the HTTP 500. Retry is an explicit recovery action, so replace
  // the exact authenticated Manager after proving that no other client-owned
  // Runtime would be interrupted.
  const manager = mainState.activeServiceManager
  if (!manager) {
    throw new Error('Kun Service Manager recovery is unavailable; quit Kun and start it again.')
  }
  await drainKunOwnersForHandoff({
    reason: 'startup-retry',
    dataDirs: [manager.discovery.dataDir],
    settingsPath: manager.discovery.settingsPath,
    controlDir: defaultKunControlDir(),
    fetch,
    onEvent: logKunHandoffEvent
  })
  if (mainState.activeServiceManager === manager) {
    mainState.activeServiceManager = null
  }
}

export function isServiceManagerDataMutexFailure(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error ?? '')
  return /Kun Service Manager data mutex failed with HTTP 500\b/i.test(message)
}

/**
 * Startup policy: the GUI starts its own supervised child and never adopts a
 * TUI/foreign owner. The retained name keeps startup wiring stable.
 *
 * Automatic-startup disabled: attach-only, exactly like a plain ensure.
 */
export async function ensureKunServeFreshOnStartup(
  settings: AppSettingsV1
): Promise<AppSettingsV1> {
  const requested = runtimeSupervisor.latestOr(settings)
  if (!managedKunHostCanAutoStart(requested)) return requested
  return ensureRuntime(requested)
}

export async function restartRuntime(settings: AppSettingsV1): Promise<void> {
  const requested = runtimeSupervisor.latestOr(settings)
  if (!managedKunHostCanAutoStart(requested)) {
    runtimeSupervisor.setManagedRuntimeExpected(false)
  }
  return runtimeSupervisor.restart(
    // As with ensure, the queued restart owns exactly the settings snapshot
    // captured at enqueue time. Later settings are reconciled behind it.
    () => restartRuntimeOnce(requested)
  )
}

async function restartRuntimeOnce(settings: AppSettingsV1): Promise<void> {
  const idle = kunRuntimeAdapter.isChildRunning()
    ? await waitForRuntimeTurnsIdle({ settings })
    : 'idle'
  if (idle !== 'idle') {
    throw runtimeJsonError(
      'runtime_busy',
      idle === 'timeout'
        ? 'Kun still has active tasks; restart was deferred.'
        : 'Kun task state could not be verified; restart was deferred.'
    )
  }
  await restartRuntimeAfterStopping(
    settings,
    () => kunRuntimeAdapter.stopSharedAndWait(settings)
  )
}

/**
 * Replace the current shared serve after an explicit user or installer action.
 * Ordinary restarts keep their conservative shared-runtime stop behavior so a
 * watchdog cannot terminate an unresponsive turn by accident.
 */
export async function replaceKunServe(settings: AppSettingsV1): Promise<void> {
  const requested = runtimeSupervisor.latestOr(settings)
  if (!managedKunHostCanAutoStart(requested)) {
    runtimeSupervisor.setManagedRuntimeExpected(false)
  }
  return runtimeSupervisor.replace(
    () => replaceKunServeOnce(requested)
  )
}

/**
 * Broad restart used only by an explicit user action. Stop the current
 * discovered owner through the authenticated replacement path, then clear
 * any remaining current-user historical `kun serve` processes before electing
 * one fresh runtime.
 *
 * Ordinary health recovery remains separate so transient failures do not
 * interrupt another client or data-directory owner.
 */
export async function restartAllKunServeProcesses(
  settings: AppSettingsV1
): Promise<void> {
  const requested = runtimeSupervisor.latestOr(settings)
  if (!managedKunHostCanAutoStart(requested)) {
    runtimeSupervisor.setManagedRuntimeExpected(false)
  }
  return runtimeSupervisor.replace(
    () => restartAllKunServeProcessesOnce(requested)
  )
}

/**
 * Explicit desktop control: restart only the child owned by this Electron
 * process. Unlike the conservative automatic restart, this confirmed action
 * may interrupt active work. It never scans for or stops foreign Kun serves.
 */
export async function restartGuiRuntime(settings: AppSettingsV1): Promise<void> {
  const requested = runtimeSupervisor.latestOr(settings)
  if (!managedKunHostCanAutoStart(requested)) {
    runtimeSupervisor.setManagedRuntimeExpected(false)
  }
  return runtimeSupervisor.replace(
    () => restartRuntimeAfterStopping(
      requested,
      () => kunRuntimeAdapter.stopAndWait()
    )
  )
}

async function restartAllKunServeProcessesOnce(settings: AppSettingsV1): Promise<void> {
  await restartRuntimeAfterStopping(
    settings,
    async () => {
      await kunRuntimeAdapter.stopSharedForReplacementAndWait(settings)
      await clearHistoricalKunServeProcesses()
    },
    (launchSettings) => kunRuntimeAdapter.ensureReplacementRunning(launchSettings)
  )
}

async function replaceKunServeOnce(settings: AppSettingsV1): Promise<void> {
  await restartRuntimeAfterStopping(
    settings,
    () => kunRuntimeAdapter.stopSharedForReplacementAndWait(settings),
    (launchSettings) => kunRuntimeAdapter.ensureReplacementRunning(launchSettings)
  )
}

/**
 * A packaged bundle becomes authoritative after an update or manual install.
 * When automatic startup is disabled, remove the verified old serve but honor
 * the user's preference not to launch a replacement until they enable it.
 */
export async function reconcileBundledRuntimeAfterInstall(
  settings: AppSettingsV1
): Promise<void> {
  mainState.assertCanonicalRuntimeMigrationReady()
  const requested = runtimeSupervisor.latestOr(settings)
  const probe = await kunRuntimeAdapter.probeBundledBuildReplacement(requested)
  if (probe.state === 'matched') return
  if (probe.state === 'unknown') throw probe.error
  // Ordinary packaged startup never replaces an already registered client
  // owner. A GUI/TUI-owned Runtime must survive until its owner exits, while an
  // exact legacy shared daemon is retired narrowly by the client-owned election
  // immediately before spawn. Ambiguous ownerless evidence also fails there.
}

async function restartRuntimeAfterStopping(
  settings: AppSettingsV1,
  stop: () => Promise<void>,
  ensure: (settings: AppSettingsV1) => Promise<void> = (launchSettings) =>
    kunRuntimeAdapter.ensureRunning(launchSettings)
): Promise<void> {
  mainState.assertCanonicalRuntimeMigrationReady()
  // Don't tear down a child that is still completing its startup; wait for it
  // to settle so a restart trigger that races a boot doesn't reset the clock
  // (#544). Resolves immediately when nothing is launching.
  await waitForKunStartupSettled()
  const runtime = getKunRuntimeSettings(settings)

  if (!runtime.autoStart) {
    throw runtimeJsonError(
      'runtime_offline',
      'Kun is offline. Enable automatic startup in Settings, or start `kun serve` manually.'
    )
  }

  const adapter = kunRuntimeAdapter
  await stop()
  const launchSettings = await resolveManagedKunLaunchSettings(settings, 'runtime-restart')

  try {
    await ensure(launchSettings)
  } catch (e) {
    console.error('[kun-gui] failed to restart kun:', e)
    throw e
  }

  const healthy = await kunRuntimeHealthMonitor.waitForHealthy(launchSettings, 20_000)
  if (!healthy) {
    throw runtimeJsonError(
      'runtime_unhealthy',
      'Kun did not become healthy after restart.'
    )
  }

  const runtimeApi = await probeRuntimeApi(launchSettings)
  if (!runtimeApi.ok) {
    throw runtimeJsonError(runtimeApi.error, runtimeApi.message)
  }
  noteSuccessfulRuntimeSettings('restart', launchSettings)
}
