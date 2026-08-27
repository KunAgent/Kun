import { app } from 'electron'
import { homedir } from 'node:os'
import { dirname, join } from 'node:path'
import { JsonSettingsStore } from './settings-store'
import {
  legacyHomeDataMigrationRequiresExclusiveAccess,
  migrateLegacyHomeDataDirs,
  rewriteLegacyPathsInSettingsFile
} from './legacy-data-migration'
import {
  canonicalKunRuntimeMigrationRequiresExclusiveAccess,
  runCanonicalKunRuntimeDataMigration,
  type RuntimeDataDirMigrationResult
} from './runtime-data-dir-migration'
import { assertNoActiveKunRuntimeUsingDataDir } from './runtime-data-dir-ownership'
import {
  acquireCanonicalRuntimeMigrationLock,
  runtimeMigrationAllowsPostMigrationSettingsWrite
} from './runtime-data-dir-migration-lock'
import { RuntimeDataDirRecovery } from './runtime-data-dir-recovery'
import { RuntimeDataRecoveryController } from './runtime-data-recovery-controller'
import {
  canonicalCurrentKunDataDir,
  canonicalLegacyKunDataDir
} from './kun-data-dir-paths'
import type { AppSettingsV1 } from '../shared/app-settings'
import {
  getRuntimeBaseUrlForSettings,
  kunRuntimeAdapter,
  runtimeAuthHeaders
} from './runtime/kun-adapter'
import {
  ensureKunServiceManager,
  resolveKunManagerDataDirFromSettings
} from './kun-process'
import {
  ManagerRevisionedDocumentClient,
  readManagerRuntime,
  requestManagerJson,
  type ServiceManagerConnection
} from '../../kun/src/manager/manager-client.js'
import {
  defaultKunControlDir,
  readManagerDiscovery
} from '../../kun/src/manager/manager-discovery.js'
import { listServiceManagerRuntimeActiveWork } from './runtime/service-manager-runtime-active-work'
import {
  drainKunOwnersForHandoff,
  KunHandoffError,
  withDrainedKunOwners
} from './runtime/kun-installed-build-handoff'
import { logKunHandoffEvent } from './runtime/kun-handoff-logging'
import { SETTINGS_FILE_NAME } from './settings-file-paths'
import { StorageRelocationController } from './storage-relocation/controller'
import { StorageRelocationEngine } from './storage-relocation/engine'
import type {
  StorageRelocationActiveWork,
  StorageRelocationProgress
} from '../shared/storage-relocation'
import { logError } from './logger'
import {
  mainState,
  remainingHomeMappings,
  runtimeJsonError,
  startupMigrationLog,
  traceStartup
} from './main-app-context'
import {
  createRuntimeDataRecoveryWindow,
  createStorageRelocationWindow,
  loadRuntimeDataRecoveryWindow
} from './main-window'

export function assertCanonicalRuntimeMigrationReady(): void {
  if (mainState.canonicalRuntimeMigration?.status !== 'blocked') return
  throw runtimeJsonError(
    'policy_blocked',
    `Kun Runtime data migration could not finish safely. Historical data was preserved and ` +
    `managed Runtime writes are blocked until recovery succeeds. ` +
    `${mainState.canonicalRuntimeMigration.message ?? `See ${mainState.canonicalRuntimeMigration.journalPath}.`}`
  )
}

export async function listStorageRelocationActiveWork(
  manager: ServiceManagerConnection
): Promise<StorageRelocationActiveWork[]> {
  const work: StorageRelocationActiveWork[] = mainState.terminalPtyController?.listSessionIds().map((id) => ({
    kind: 'background-service' as const,
    id: `terminal:${id}`,
    label: `Terminal session ${id}`,
    interruptible: true
  })) ?? []
  work.push(...await listServiceManagerRuntimeActiveWork(manager))
  return work
}

export async function interruptStorageRelocationWork(manager: ServiceManagerConnection): Promise<void> {
  const work = await listStorageRelocationActiveWork(manager)
  const blocked = work.filter((item) => !item.interruptible)
  if (blocked.length > 0) {
    throw new Error(`active_writer: ${blocked.map((item) => item.label).join('; ')}`)
  }
  mainState.terminalPtyController?.disposeAll()
  for (const item of work.filter((entry) => entry.kind === 'turn')) {
    const [flavor, threadId, turnId] = item.id.split(':')
    if (!threadId || !turnId || (flavor !== 'production' && flavor !== 'development')) continue
    const registration = await readManagerRuntime(manager, flavor)
    if (!registration) throw new Error(`active_writer: ${flavor} Runtime disappeared before interruption.`)
    const response = await fetch(
      `${registration.baseUrl}/v1/threads/${encodeURIComponent(threadId)}/turns/${encodeURIComponent(turnId)}/interrupt`,
      {
        method: 'POST',
        headers: {
          authorization: `Bearer ${registration.runtimeToken}`,
          'content-type': 'application/json'
        },
        body: JSON.stringify({ discard: false }),
        signal: AbortSignal.timeout(10_000)
      }
    )
    if (!response.ok && response.status !== 404 && response.status !== 409) {
      throw new Error(`active_writer: Failed to interrupt ${item.label} (HTTP ${response.status}).`)
    }
  }
  const deadline = Date.now() + 30_000
  while (Date.now() < deadline) {
    const remaining = (await listStorageRelocationActiveWork(manager))
      .filter((item) => item.kind === 'turn' || !item.interruptible)
    if (remaining.length === 0) return
    await new Promise<void>((resolve) => setTimeout(resolve, 250))
  }
  throw new Error('active_writer: Timed out waiting for active Kun writes to stop.')
}

export async function shutdownServiceManagerAndWait(manager: ServiceManagerConnection): Promise<void> {
  await requestManagerJson(manager, '/v1/manager/shutdown', {
    method: 'POST',
    body: { instanceId: manager.discovery.instanceId },
    timeoutMs: 10_000
  })
  const deadline = Date.now() + 15_000
  while (Date.now() < deadline) {
    try {
      process.kill(manager.discovery.pid, 0)
      await new Promise<void>((resolve) => setTimeout(resolve, 100))
    } catch {
      return
    }
  }
  throw new Error('active_writer: Kun Service Manager did not exit before migration.')
}

export async function shutdownActiveServiceManagerForUpdate(): Promise<void> {
  const manager = mainState.activeServiceManager
  if (!manager) return
  await drainKunOwnersForHandoff({
    reason: 'in-app-update',
    dataDirs: [manager.discovery.dataDir],
    settingsPath: manager.discovery.settingsPath,
    controlDir: defaultKunControlDir(),
    fetch,
    onEvent: logKunHandoffEvent
  })
  if (mainState.activeServiceManager === manager) mainState.activeServiceManager = null
}

export function createStartupKunHandoffRecovery(
  error: unknown
): (() => Promise<void>) | undefined {
  if (!(error instanceof KunHandoffError) || !error.retryable) return undefined

  return async () => {
    const userDataPath = app.getPath('userData')
    const settingsPath = join(userDataPath, SETTINGS_FILE_NAME)
    const dataDirs = error.reason === 'exclusive-data-migration'
      ? [
          canonicalLegacyKunDataDir(homedir(), process.platform),
          canonicalCurrentKunDataDir(homedir(), process.platform)
        ]
      : [await resolveKunManagerDataDirFromSettings(settingsPath)]

    await drainKunOwnersForHandoff({
      reason: error.reason,
      dataDirs,
      settingsPath,
      controlDir: defaultKunControlDir(),
      fetch,
      onEvent: logKunHandoffEvent
    })
  }
}

function managerProcessIsAlive(pid: number): boolean {
  try {
    process.kill(pid, 0)
    return true
  } catch (error) {
    return !(
      typeof error === 'object' &&
      error !== null &&
      'code' in error &&
      (error as NodeJS.ErrnoException).code === 'ESRCH'
    )
  }
}

async function withCanonicalRuntimeMigrationWritersDrained<T>(
  afterDrain: () => T | Promise<T>
): Promise<T> {
  const canonicalDirs = [
    canonicalLegacyKunDataDir(homedir(), process.platform),
    canonicalCurrentKunDataDir(homedir(), process.platform)
  ]
  const { value } = await withDrainedKunOwners({
    reason: 'exclusive-data-migration',
    dataDirs: canonicalDirs,
    controlDir: defaultKunControlDir(),
    fetch,
    onEvent: logKunHandoffEvent
  }, afterDrain)
  return value
}

async function assertCanonicalRuntimeMigrationWritersStopped(dataDir: string): Promise<void> {
  assertNoActiveKunRuntimeUsingDataDir(dataDir)
  const manager = await readManagerDiscovery(defaultKunControlDir()).catch(() => null)
  if (manager && managerProcessIsAlive(manager.pid)) {
    throw new Error(
      `an active Kun Service Manager still owns Runtime storage (pid ${manager.pid})`
    )
  }
}

export async function runStartupLegacyMigrations(): Promise<RuntimeDataDirMigrationResult> {
  if (mainState.updateHealthProbeOnly) {
    throw new Error('Update health probes must not run user-data migrations.')
  }
  const userDataPath = app.getPath('userData')
  const homeDir = homedir()
  const sourcePath = canonicalLegacyKunDataDir(homeDir, process.platform)
  const targetPath = canonicalCurrentKunDataDir(homeDir, process.platform)
  const runtimeRequiresExclusiveAccess = canonicalKunRuntimeMigrationRequiresExclusiveAccess({
    userDataPath,
    homeDir,
    platform: process.platform
  })
  const remainingRequiresExclusiveAccess = legacyHomeDataMigrationRequiresExclusiveAccess({
    userDataPath,
    homeDir,
    mappings: remainingHomeMappings
  })
  const requiresExclusiveAccess =
    runtimeRequiresExclusiveAccess || remainingRequiresExclusiveAccess
  let lock: ReturnType<typeof acquireCanonicalRuntimeMigrationLock> | undefined
  try {
    if (requiresExclusiveAccess) {
      lock = await withCanonicalRuntimeMigrationWritersDrained(() =>
        acquireCanonicalRuntimeMigrationLock([sourcePath, targetPath])
      )
      await assertCanonicalRuntimeMigrationWritersStopped(sourcePath)
      await assertCanonicalRuntimeMigrationWritersStopped(targetPath)
    }
    mainState.canonicalRuntimeMigration = runCanonicalKunRuntimeDataMigration({
      userDataPath,
      homeDir,
      log: startupMigrationLog,
      // A current Manager cannot pass the data-dir lock. Repeating the process
      // inventory at every migration fence also covers legacy standalone
      // Runtime binaries that predate the lock protocol.
      assertLegacyRuntimeInactive: (dataDir) =>
        assertNoActiveKunRuntimeUsingDataDir(dataDir)
    })

    // Settings are Manager-owned. Keep every remaining legacy directory move
    // and settings rewrite inside the same exclusive writer window whenever
    // the read-only preflight found work. A permanent compatibility symlink
    // with already-current settings does not trigger a Manager restart.
    if (
      remainingRequiresExclusiveAccess &&
      lock &&
      runtimeMigrationAllowsPostMigrationSettingsWrite(mainState.canonicalRuntimeMigration.status)
    ) {
      mainState.remainingHomeMigration = migrateLegacyHomeDataDirs({
        homeDir,
        mappings: remainingHomeMappings,
        log: startupMigrationLog
      })
      mainState.remainingSettingsRewritten = rewriteLegacyPathsInSettingsFile({
        userDataPath,
        homeDir,
        mappings: mainState.remainingHomeMigration
          .filter((entry) => entry.rewriteSafe)
          .map((entry) => entry.mapping),
        log: startupMigrationLog
      })
    }
  } catch (error) {
    mainState.canonicalRuntimeMigration = {
      status: 'blocked',
      authority: 'unknown',
      sourcePath,
      targetPath,
      journalPath: join(userDataPath, 'kun-runtime-data-migration-v3.json'),
      message: error instanceof Error ? error.message : String(error)
    }
  } finally {
    try {
      lock?.release()
    } catch (error) {
      mainState.canonicalRuntimeMigration = {
        status: 'blocked',
        authority: 'unknown',
        sourcePath,
        targetPath,
        journalPath: join(userDataPath, 'kun-runtime-data-migration-v3.json'),
        message:
          `Kun Runtime migration lock cleanup failed: ` +
          `${error instanceof Error ? error.message : String(error)}`
      }
    }
  }

  const migrationResult = mainState.canonicalRuntimeMigration
  if (!migrationResult) throw new Error('Runtime migration did not produce a result')
  traceStartup('startup legacy migration checked', {
    runtimeStatus: migrationResult.status,
    runtimeBackupPath: migrationResult.destinationBackupPath,
    runtimeMessage: migrationResult.message,
    remainingSettingsRewritten: mainState.remainingSettingsRewritten
  })
  return migrationResult
}

export function releaseRuntimeDataRecoveryMigrationLock(): void {
  const lock = mainState.runtimeDataRecoveryMigrationLock
  if (!lock) return
  mainState.runtimeDataRecoveryMigrationLock = null
  lock.release()
}

function acceptCompletedRuntimeDataRecovery(): RuntimeDataDirMigrationResult {
  if (!mainState.runtimeDataRecoveryMigrationLock) {
    throw new Error('Runtime data recovery acceptance requires the active migration lock.')
  }
  const result = runCanonicalKunRuntimeDataMigration({
    userDataPath: app.getPath('userData'),
    homeDir: homedir(),
    platform: process.platform,
    log: startupMigrationLog,
    assertLegacyRuntimeInactive: (dataDir) => assertNoActiveKunRuntimeUsingDataDir(dataDir)
  })
  mainState.canonicalRuntimeMigration = result
  if (result.status === 'blocked') {
    throw new Error(
      result.message ?? 'Runtime data recovery completed but its authority handoff was blocked.'
    )
  }
  traceStartup('runtime data recovery accepted', {
    status: result.status,
    authority: result.authority
  })
  return result
}

export async function runRuntimeDataRecoveryMaintenance(): Promise<void> {
  const homeDir = homedir()
  const userDataPath = app.getPath('userData')
  const sourcePath = canonicalLegacyKunDataDir(homeDir, process.platform)
  const targetPath = canonicalCurrentKunDataDir(homeDir, process.platform)
  mainState.runtimeDataRecoveryMigrationLock =
    await withCanonicalRuntimeMigrationWritersDrained(() =>
      acquireCanonicalRuntimeMigrationLock([sourcePath, targetPath])
    )
  try {
    await assertCanonicalRuntimeMigrationWritersStopped(sourcePath)
    await assertCanonicalRuntimeMigrationWritersStopped(targetPath)
    const recovery = new RuntimeDataDirRecovery({
      homeDir,
      userDataPath,
      platform: process.platform,
      log: startupMigrationLog,
      assertRuntimeInactive: (dataDir) => assertNoActiveKunRuntimeUsingDataDir(dataDir)
    })
    const initialStatus = await recovery.refresh()
    let relaunchScheduled = false
    const scheduleRelaunch = (delayMs = 750): void => {
      if (relaunchScheduled) return
      releaseRuntimeDataRecoveryMigrationLock()
      relaunchScheduled = true
      const relaunch = (): void => {
        app.relaunch()
        app.exit(0)
      }
      if (delayMs <= 0) relaunch()
      else setTimeout(relaunch, delayMs).unref?.()
    }
    const finishRecovery = (relaunchDelayMs = 750): void => {
      acceptCompletedRuntimeDataRecovery()
      scheduleRelaunch(relaunchDelayMs)
    }

    if (initialStatus.state === 'candidate-ready' && initialStatus.recommendedCandidateId) {
      const completed = await recovery.execute({
        action: 'restore',
        generation: initialStatus.generation,
        candidateId: initialStatus.recommendedCandidateId
      })
      if (completed.state !== 'completed') {
        throw new Error('Automatic Runtime data recovery did not reach a completed state.')
      }
      finishRecovery(0)
      return
    }
    if (initialStatus.state === 'new-install') {
      const completed = await recovery.execute({
        action: 'initialize-new-install',
        generation: initialStatus.generation,
        confirmation: 'initialize-empty-new-install'
      })
      if (completed.state !== 'completed') {
        throw new Error('Runtime data initialization did not reach a completed state.')
      }
      finishRecovery(0)
      return
    }

    const workbench = mainState.mainWindow
    if (workbench && !workbench.isDestroyed()) workbench.destroy()
    const window = createRuntimeDataRecoveryWindow()
    window.on('closed', () => {
      try {
        releaseRuntimeDataRecoveryMigrationLock()
      } catch (error) {
        console.error('[kun-gui] failed to release Runtime data recovery lock:', error)
      }
      if (!relaunchScheduled) app.quit()
    })
    new RuntimeDataRecoveryController({
      recovery,
      getMainWindow: () => mainState.mainWindow,
      onCompleted: () => finishRecovery()
    }).registerIpc()
    app.on('second-instance', () => {
      if (window.isDestroyed()) return
      if (window.isMinimized()) window.restore()
      window.show()
      window.focus()
    })
    app.on('activate', () => {
      if (window.isDestroyed()) return
      window.show()
      window.focus()
    })
    await loadRuntimeDataRecoveryWindow(window)
  } catch (error) {
    try {
      releaseRuntimeDataRecoveryMigrationLock()
    } catch (releaseError) {
      console.error('[kun-gui] failed to release Runtime data recovery lock:', releaseError)
    }
    throw error
  }
}

export async function runStorageRelocationMaintenance(productionSettingsPath: string): Promise<void> {
  const window = createStorageRelocationWindow()
  let relaunchScheduled = false
  const scheduleRelaunch = (): void => {
    if (relaunchScheduled) return
    relaunchScheduled = true
    setTimeout(() => {
      app.relaunch()
      app.exit(0)
    }, 750).unref?.()
  }
  const publish = (progress: StorageRelocationProgress): void => {
    if (!window.isDestroyed()) window.webContents.send('storage-relocation:progress', progress)
  }
  const engine = new StorageRelocationEngine({
    homeDir: homedir(),
    userDataPath: app.getPath('userData'),
    installPath: dirname(process.execPath),
    platform: process.platform,
    featureEnabled: true,
    onProgress: publish,
    healthCheck: async () => {
      let manager: ServiceManagerConnection | null = null
      let settings: AppSettingsV1 | null = null
      try {
        manager = await ensureKunServiceManager({ settingsPath: productionSettingsPath })
        const recoveryStore = new JsonSettingsStore(app.getPath('userData'), {
          documentBackend: new ManagerRevisionedDocumentClient(manager, 'settings')
        })
        settings = await recoveryStore.load()
        await kunRuntimeAdapter.ensureRunning(settings)
        const headers = runtimeAuthHeaders(settings)
        const [health, threads, attachments, extensions] = await Promise.all([
          fetch(`${getRuntimeBaseUrlForSettings(settings)}/health`, {
            headers,
            signal: AbortSignal.timeout(15_000)
          }),
          fetch(`${getRuntimeBaseUrlForSettings(settings)}/v1/threads?limit=1&include=side`, {
            headers,
            signal: AbortSignal.timeout(15_000)
          }),
          fetch(`${getRuntimeBaseUrlForSettings(settings)}/v1/attachments/diagnostics`, {
            headers,
            signal: AbortSignal.timeout(15_000)
          }),
          fetch(`${getRuntimeBaseUrlForSettings(settings)}/v1/extensions`, {
            headers,
            signal: AbortSignal.timeout(15_000)
          })
        ])
        if (!health.ok || !threads.ok || !attachments.ok || !extensions.ok) {
          throw new Error(
            `Runtime health verification failed ` +
            `(${health.status}/${threads.status}/${attachments.status}/${extensions.status}).`
          )
        }
        const body = await threads.json() as { threads?: unknown }
        if (!Array.isArray(body.threads)) throw new Error('Runtime thread verification returned invalid data.')
      } catch (error) {
        if (settings) await kunRuntimeAdapter.stopSharedAndWait(settings).catch(() => undefined)
        if (manager) await shutdownServiceManagerAndWait(manager).catch(() => undefined)
        throw error
      }
    }
  })
  new StorageRelocationController({
    engine,
    getMainWindow: () => mainState.mainWindow,
    recoveryMode: true
  }).registerIpc()
  const repairPoll = setInterval(() => {
    void Promise.all([engine.status(), engine.hasPendingOperation()]).then(([status, pending]) => {
      if (!pending && (status.state === 'default' || status.state === 'relocated') && !status.recoveryRequired) {
        scheduleRelaunch()
      }
    }).catch(() => undefined)
  }, 2_000)
  repairPoll.unref?.()
  try {
    const result = await engine.runPending()
    if (result && (result.phase === 'completed' || !await engine.hasPendingOperation())) {
      scheduleRelaunch()
    }
  } catch (error) {
    logError('storage-relocation', 'Storage relocation maintenance failed.', {
      message: error instanceof Error ? error.message : String(error)
    })
  }
}

/**
 * Reject runtime-affecting values that would persist a config kun can
 * never boot with. Runs before the settings patch is written to disk.
 */
