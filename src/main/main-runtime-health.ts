import { app, BrowserWindow } from 'electron'
import type { AppSettingsV1 } from '../shared/app-settings'
import { resolveKunRuntimeSettings } from '../shared/app-settings'
import { parseRuntimeErrorBody } from '../shared/runtime-error'
import {
  getRuntimeBaseUrlForSettings,
  kunRuntimeAdapter,
  runtimeAuthHeaders
} from './runtime/kun-adapter'
import { KunRuntimeHealthMonitor } from './runtime/kun-runtime-health-monitor'
import {
  markCanonicalKunRuntimeMigrationRuntimeVerified
} from './runtime-data-dir-migration'
import {
  KunRuntimeSupervisor,
  type KunRuntimeStatus
} from './kun-runtime-supervisor'
import { managedKunHostCanAutoStart } from './managed-runtime-startup-policy'
import { logError, logWarn } from './logger'
import type { KunUnexpectedExitInfo } from './kun-process'
import { stopBrowserUseHost } from './browser-use/browser-use-host'
import { stopComputerUseHost } from './computer-use/computer-use-host'
import { stableSettingsStringify } from './runtime-settings-apply-mode'
import { mainState } from './main-app-context'
import { isAppQuitInProgress, runtimeShutdown } from './main-lifecycle'

export async function probeRuntimeApi(settings: AppSettingsV1): Promise<
  | { ok: true }
  | { ok: false; error: string; message: string }
> {
  const base = getRuntimeBaseUrlForSettings(settings)
  const headers = runtimeAuthHeaders(settings)
  headers.set('Accept', 'application/json')

  try {
    // Runtime readiness must stay independent of the user's session count.
    // Listing threads can require loading a large history projection, while
    // runtime info is authenticated and already part of the build contract.
    const res = await fetch(`${base}/v1/runtime/info`, {
      headers,
      signal: AbortSignal.timeout(2_000)
    })
    if (res.ok) return { ok: true }
    const info = parseRuntimeErrorBody(
      await res.text(),
      'The local runtime returned an unexpected error.'
    )
    if (res.status === 401) {
      return {
        ok: false,
        error: 'runtime_auth_required',
        message: 'The local Kun Runtime rejected the desktop access credential.'
      }
    }
    return {
      ok: false,
      error: info.code === 'unknown' ? 'runtime_request_failed' : info.code,
      message: info.message
    }
  } catch (e) {
    return {
      ok: false,
      error: 'fetch_failed',
      message: e instanceof Error ? e.message : String(e)
    }
  }
}

export const kunRuntimeHealthMonitor = new KunRuntimeHealthMonitor<AppSettingsV1>({
  runtimeBaseUrl: getRuntimeBaseUrlForSettings,
  runtimeHeaders: runtimeAuthHeaders,
  warn: (source, message) => logWarn(source, message)
})

export async function sleepWithAbort(ms: number, signal: AbortSignal): Promise<void> {
  if (signal.aborted || ms <= 0) return
  await new Promise<void>((resolve) => {
    const timer = setTimeout(() => {
      signal.removeEventListener('abort', onAbort)
      resolve()
    }, ms)
    const onAbort = (): void => {
      clearTimeout(timer)
      signal.removeEventListener('abort', onAbort)
      resolve()
    }
    signal.addEventListener('abort', onAbort, { once: true })
  })
}

/**
 * How long a managed child that failed the initial health probe gets to prove
 * it is merely busy (e.g. a long synchronous step) rather than hung, before the
 * ensure path force-restarts it in place. Generous on purpose: killing a
 * slow-but-alive runtime would cost the user their in-flight turn (#621).
 */
export const RUNTIME_HUNG_CONFIRM_MS = 10_000
// A detached shared Runtime does not emit a child-process exit event to this
// Electron instance. Probe often enough that a crash is recovered before the
// UI feels permanently offline, while still requiring multiple failures before
// treating a live process as unresponsive.
const RUNTIME_WATCHDOG_INTERVAL_MS = 10_000
export const runtimeSupervisor = new KunRuntimeSupervisor<AppSettingsV1>({
  deps: {
    loadSettings: () => mainState.store.load(),
    canAutoRestart: managedKunHostCanAutoStart,
    ensureRuntime: (settings) => mainState.ensureRuntime(settings),
    restartRuntime: (settings) => mainState.restartRuntime(settings),
    checkHealth: async (settings, timeoutMs) => {
      await kunRuntimeAdapter.resolveConnection(settings)
      return kunRuntimeHealthMonitor.waitForHealthy(settings, timeoutMs)
    },
    isChildRunning: () => kunRuntimeAdapter.isChildRunning(),
    isStopped: () => runtimeShutdown.isStoppedForQuit || isAppQuitInProgress(),
    publish: (full) => {
      logWarn('runtime-status', `${full.state} (${full.source})${full.message ? `: ${full.message}` : ''}`)
      for (const win of BrowserWindow.getAllWindows()) {
        if (!win.isDestroyed()) win.webContents.send('runtime:status', full)
      }
    },
    warn: (source, message, details) => logWarn(source, message, details),
    error: (source, message, details) => logError(source, message, details)
  },
  watchdogIntervalMs: RUNTIME_WATCHDOG_INTERVAL_MS
})
mainState.waitForRuntimeOperationsIdle = () => runtimeSupervisor.waitForIdle()

export function publishRuntimeStatus(status: Omit<KunRuntimeStatus, 'at'>): void {
  runtimeSupervisor.publish(status)
}

let runtimeMigrationVerificationPromise: Promise<void> | null = null
let runtimeMigrationVerificationCompleted = false
let runtimeMigrationVerificationErrorWarned = false

async function verifyRuntimeMigrationHistory(): Promise<void> {
  const settings = await mainState.store.load()
  const headers = runtimeAuthHeaders(settings)
  headers.set('Accept', 'application/json')
  const response = await fetch(
    `${getRuntimeBaseUrlForSettings(settings)}/v1/threads?include_archived=true&include=side`,
    {
      headers,
      signal: AbortSignal.timeout(15_000)
    }
  )
  if (!response.ok) {
    throw new Error(`Runtime thread inventory returned HTTP ${response.status}`)
  }
  const payload = JSON.parse(await response.text()) as { threads?: unknown }
  if (!Array.isArray(payload.threads)) {
    throw new Error('Runtime thread inventory response has no threads array')
  }
  const visibleThreadIds = payload.threads.flatMap((thread) =>
    thread &&
    typeof thread === 'object' &&
    typeof (thread as { id?: unknown }).id === 'string'
      ? [(thread as { id: string }).id]
      : []
  )
  const result = markCanonicalKunRuntimeMigrationRuntimeVerified(
    app.getPath('userData'),
    visibleThreadIds,
    { homeDir: app.getPath('home'), platform: process.platform }
  )
  runtimeMigrationVerificationErrorWarned = false
  runtimeMigrationVerificationCompleted = result.status !== 'incomplete'
  if (result.status === 'incomplete' && result.attempt === 1) {
    logWarn(
      'runtime-data-migration',
      'Runtime is healthy but its thread API does not expose every migrated thread; verification remains pending.',
      {
        expectedThreadCount: result.expectedThreadCount,
        visibleThreadCount: result.visibleThreadCount,
        missingThreadCount: result.missingThreadIds.length,
        missingThreadIds: result.missingThreadIds.slice(0, 20),
        attempt: result.attempt,
        maxAttempts: result.maxAttempts
      }
    )
  } else if (result.status === 'unresolved') {
    logWarn(
      'runtime-data-migration',
      'Runtime history verification reached its retry limit; automatic retries stopped without blocking Runtime availability.',
      {
        expectedThreadCount: result.expectedThreadCount,
        visibleThreadCount: result.visibleThreadCount,
        missingThreadCount: result.missingThreadIds.length,
        missingThreadIds: result.missingThreadIds.slice(0, 20),
        attempt: result.attempt,
        maxAttempts: result.maxAttempts
      }
    )
  }
}

function scheduleRuntimeMigrationHistoryVerification(): void {
  if (runtimeMigrationVerificationCompleted || runtimeMigrationVerificationPromise) return
  runtimeMigrationVerificationPromise = verifyRuntimeMigrationHistory()
    .catch((error) => {
      if (runtimeMigrationVerificationErrorWarned) return
      runtimeMigrationVerificationErrorWarned = true
      logWarn('runtime-data-migration', 'Could not verify migrated Runtime history through the thread API.', {
        message: error instanceof Error ? error.message : String(error)
      })
    })
    .finally(() => {
      runtimeMigrationVerificationPromise = null
    })
}

/** Record a healthy runtime and announce recovery without erasing recent crash attempts. */
export function noteRuntimeHealthy(source: string, settings?: AppSettingsV1): void {
  // A stale lifecycle operation may finish after the user disabled auto-start.
  // Promote expectation only from the latest persisted intent, never from the
  // operation's captured snapshot.
  if (settings && managedKunHostCanAutoStart(runtimeSupervisor.latestOr(settings))) {
    runtimeSupervisor.setManagedRuntimeExpected(true)
  }
  scheduleRuntimeMigrationHistoryVerification()
  runtimeSupervisor.noteHealthy(source)
}

export function handleUnexpectedKunExit(info: KunUnexpectedExitInfo): void {
  void stopBrowserUseHost()
  void stopComputerUseHost()
  runtimeSupervisor.handleUnexpectedExit(info)
}

export function startRuntimeWatchdog(): void {
  runtimeSupervisor.startWatchdog()
}

export function stopRuntimeWatchdog(): void {
  runtimeSupervisor.stopWatchdog()
}


export function runtimeFingerprint(settings: AppSettingsV1): string {
  return stableSettingsStringify(resolveKunRuntimeSettings(settings))
}
