import { app } from 'electron'
import { homedir } from 'node:os'
import { join } from 'node:path'
import {
  DEFAULT_KUN_DATA_DIR,
  getKunRuntimeSettings,
  type AppSettingsV1
} from '../../shared/app-settings'
import {
  buildKunServeArgs,
  resolveKunExecutable,
  resolveKunRuntimeBuildId
} from '../resolve-kun-binary'
import {
  isKunChildRunning,
  getKunServiceManagerBinding,
  reclaimKunPort,
  resolveAvailableKunPort,
  startKunChild,
  stopKunChildAndWait
} from '../kun-process'
import { getKunBaseUrl } from '../kun-base-url'
import {
  inspectSharedRuntime
} from '../../../kun/src/cli/shared-runtime.js'
import type { RuntimeClientOwnerKind } from '../../../kun/src/contracts/runtime-owner.js'
import type { RuntimeDiscoveryRecord } from '../../../kun/src/server/runtime-discovery.js'
import { stopSharedRuntimeForReplacement } from './kun-serve-replacement'
import {
  resolveCliRuntimeFlavor,
  runtimeBuildIdForFlavor
} from '../../../kun/src/cli/runtime-flavor.js'
import { sameCanonicalPath } from '../../../kun/src/manager/canonical-path.js'

const KUN_RUNTIME_ID = 'kun' as const

export type BundledBuildReplacementProbe =
  | { state: 'matched'; ownership: 'none' | 'current' }
  | { state: 'mismatched' }
  | { state: 'foreign-owned'; ownerKind: RuntimeClientOwnerKind; buildMatches: boolean }
  | { state: 'unknown'; error: Error }

export function classifyBundledBuildReplacement(
  discovery: Pick<RuntimeDiscoveryRecord, 'buildId' | 'clientOwnerKind'>,
  expectedBuildId: string
): BundledBuildReplacementProbe {
  if (discovery.clientOwnerKind) {
    return {
      state: 'foreign-owned',
      ownerKind: discovery.clientOwnerKind,
      buildMatches: discovery.buildId === expectedBuildId
    }
  }
  return discovery.buildId === expectedBuildId
    ? { state: 'matched', ownership: 'current' }
    : { state: 'mismatched' }
}

function appRoot(): string {
  return app.isPackaged
    ? app.getAppPath().replace(/app\.asar$/, 'app.asar.unpacked')
    : app.getAppPath()
}

export const kunRuntimeAdapter = {
  id: KUN_RUNTIME_ID,

  async resolveExecutable(settings: AppSettingsV1): Promise<string> {
    const runtime = getKunRuntimeSettings(settings)
    const resolution = resolveKunExecutable(appRoot(), runtime.binaryPath)
    if (resolution.kind === 'node-script') {
      const scriptPath = resolution.args[0] ?? ''
      return runtime.binaryPath.trim()
        ? `Node.js script (${scriptPath})`
        : `Bundled Kun (${scriptPath})`
    }
    return resolution.command
  },

  ensureRunning(settings: AppSettingsV1): Promise<void> {
    return ensureResolvedKunRuntime(settings)
  },

  /**
   * Start a fresh current-flavor owner after an explicit replacement. This
   * bypasses normal active-turn reuse and verifies the bundled build before
   * returning, so an updater cannot silently reconnect to an older serve.
   */
  ensureReplacementRunning(settings: AppSettingsV1): Promise<void> {
    return ensureReplacementKunRuntime(settings)
  },

  /** Stop only the Runtime child owned by this Electron process. */
  async stopAndWait(): Promise<void> {
    await stopKunChildAndWait()
  },

  isChildRunning(): boolean {
    return isKunChildRunning()
  },

  getBaseUrl(settings: AppSettingsV1): string {
    const runtime = getKunRuntimeSettings(settings)
    return getKunBaseUrl(runtime.port)
  },

  resolveConnection(settings: AppSettingsV1): Promise<boolean> {
    return refreshResolvedKunRuntime(settings)
  },

  async stopSharedAndWait(settings: AppSettingsV1): Promise<void> {
    void settings
    await stopKunChildAndWait()
  },

  /**
   * Explicitly remove the current shared serve before a user-confirmed restart
   * or an application-file update. Unlike ordinary health recovery, this may
   * use a narrowly verified termination fallback when graceful shutdown fails.
   */
  async stopSharedForReplacementAndWait(settings: AppSettingsV1): Promise<void> {
    const dataDir = expandDataDir(getKunRuntimeSettings(settings).dataDir)
    await stopSharedRuntimeForReplacement(dataDir, fetch, sharedRuntimeScope(dataDir))
    await stopKunChildAndWait()
  },

  /**
   * A packaged production app owns the bundled build after an install/update.
   * Custom binaries and development runtimes retain their normal attach policy.
   */
  async probeBundledBuildReplacement(settings: AppSettingsV1): Promise<BundledBuildReplacementProbe> {
    const runtime = getKunRuntimeSettings(settings)
    const runtimeFlavor = resolveCliRuntimeFlavor({ env: process.env })
    if (!app.isPackaged || runtime.binaryPath.trim() || runtimeFlavor !== 'production') {
      return { state: 'matched', ownership: 'none' }
    }
    const dataDir = expandDataDir(runtime.dataDir)
    const expectedBuildId = expectedKunRuntimeBuildId(
      await resolveKunRuntimeBuildId(resolveKunExecutable(appRoot(), runtime.binaryPath)),
      runtimeFlavor
    )
    if (!expectedBuildId) {
      return { state: 'unknown', error: new Error('The packaged Kun Runtime build identity is missing.') }
    }
    let inspected: Awaited<ReturnType<typeof inspectSharedRuntime>>
    try {
      inspected = await inspectSharedRuntime(
        dataDir,
        fetch,
        sharedRuntimeScope(dataDir, runtimeFlavor)
      )
    } catch (error) {
      return {
        state: 'unknown',
        error: error instanceof Error ? error : new Error(String(error))
      }
    }
    if (!inspected) return { state: 'matched', ownership: 'none' }
    return classifyBundledBuildReplacement(inspected.discovery, expectedBuildId)
  },

  reclaimPort(port: number): Promise<{ ok: true } | { ok: false; message: string }> {
    return reclaimKunPort(port)
  },

  resolveAvailablePort(port: number): Promise<{ port: number; changed: boolean; message?: string }> {
    return resolveAvailableKunPort(port)
  }
}

export function getRuntimeBaseUrlForSettings(settings: AppSettingsV1): string {
  return kunRuntimeAdapter.getBaseUrl(settings)
}

/** Resolve the bearer token for the active Kun connection. */
export function getRuntimeAuthToken(settings: AppSettingsV1): string {
  const runtime = getKunRuntimeSettings(settings)
  return runtime.runtimeToken.trim()
}

/** Build the bearer-token authorization header for Kun requests. */
export function runtimeAuthHeaders(settings: AppSettingsV1): Headers {
  const headers = new Headers()
  const token = getRuntimeAuthToken(settings)
  if (token) {
    headers.set('Authorization', `Bearer ${token}`)
  }
  return headers
}

async function ensureResolvedKunRuntime(settings: AppSettingsV1): Promise<void> {
  if (isKunChildRunning()) return
  await startKunChild(settings)
}

async function ensureReplacementKunRuntime(settings: AppSettingsV1): Promise<void> {
  await startKunChild(settings)
}

export function expectedKunRuntimeBuildId(
  sourceBuildId: string | undefined,
  runtimeFlavor: ReturnType<typeof resolveCliRuntimeFlavor>
): string | undefined {
  return runtimeBuildIdForFlavor(sourceBuildId, runtimeFlavor)
}

export function bundledRuntimeBuildReplacementRequired(input: {
  isPackaged: boolean
  hasCustomBinary: boolean
  runtimeFlavor: ReturnType<typeof resolveCliRuntimeFlavor>
  expectedBuildId: string | undefined
  discoveredBuildId: string | undefined
}): boolean {
  return input.isPackaged &&
    !input.hasCustomBinary &&
    input.runtimeFlavor === 'production' &&
    Boolean(input.expectedBuildId) &&
    input.discoveredBuildId !== input.expectedBuildId
}

async function refreshResolvedKunRuntime(settings: AppSettingsV1): Promise<boolean> {
  void settings
  return isKunChildRunning()
}

function sharedRuntimeScope(
  dataDir: string,
  runtimeFlavor = resolveCliRuntimeFlavor({ env: process.env })
): {
  runtimeFlavor: ReturnType<typeof resolveCliRuntimeFlavor>
  manager?: NonNullable<ReturnType<typeof getKunServiceManagerBinding>>
} {
  const manager = getKunServiceManagerBinding()
  return {
    runtimeFlavor,
    ...(manager && sameCanonicalPath(manager.discovery.dataDir, dataDir) ? { manager } : {})
  }
}

function expandDataDir(value: string): string {
  return value.replace(/^~(?=$|[\\/])/, homedir())
}

export type RuntimeRequestInit = {
  method?: string
  body?: string
  headers?: Record<string, string>
  signal?: AbortSignal
  timeoutMs?: number
}

/**
 * Immutable identity for one Main-process HTTP operation.
 *
 * The discovery record can be replaced by a concurrent managed-runtime
 * restart. Callers that bind authorization material to a request (notably
 * protected approvals) must snapshot the endpoint and token together after
 * ensure and use that snapshot exactly once.
 */
export type RuntimeRequestLease = Readonly<{
  baseUrl: string
  runtimeToken: string
  runtimeInstanceId?: string
}>

const DEFAULT_RUNTIME_GET_TIMEOUT_MS = 15_000
const DEFAULT_RUNTIME_POST_TIMEOUT_MS = 60_000
const THREAD_TIMELINE_GET_TIMEOUT_MS = 120_000
const THREAD_SUMMARIZE_POST_TIMEOUT_MS = 120_000
const PROVIDER_QUOTA_GET_TIMEOUT_MS = 120_000
const USAGE_HISTORY_GET_TIMEOUT_MS = 120_000
const RUNTIME_EVENTS_TIMEOUT_MARGIN_MS = 5_000
const MAX_RUNTIME_EVENTS_WAIT_MS = 120_000

function isThreadTimelinePath(pathNorm: string): boolean {
  const queryIndex = pathNorm.indexOf('?')
  const pathname = queryIndex >= 0 ? pathNorm.slice(0, queryIndex) : pathNorm
  return /^\/v1\/threads\/[^/]+\/timeline$/u.test(pathname)
}

function isThreadSummarizePath(pathNorm: string): boolean {
  const queryIndex = pathNorm.indexOf('?')
  const pathname = queryIndex >= 0 ? pathNorm.slice(0, queryIndex) : pathNorm
  return /^\/v1\/threads\/[^/]+\/summarize$/u.test(pathname)
}

function isProviderQuotaPath(pathNorm: string): boolean {
  const queryIndex = pathNorm.indexOf('?')
  const pathname = queryIndex >= 0 ? pathNorm.slice(0, queryIndex) : pathNorm
  return pathname === '/v1/provider-quotas'
}

function runtimeEventsWaitMs(pathNorm: string): number | null {
  if (
    !pathNorm.startsWith('/v1/model-connections/events?') &&
    !pathNorm.startsWith('/v1/thread-activity/events?')
  ) return null
  const query = pathNorm.slice(pathNorm.indexOf('?') + 1)
  const waitMs = Number(new URLSearchParams(query).get('wait_ms'))
  return Number.isSafeInteger(waitMs) && waitMs > 0 ? waitMs : null
}

/**
 * History aggregations replay every thread's usage records and hydrate full
 * thread records for per-turn attribution, so they are not a cheap status
 * route. Main owns the cancellable 120-second budget so renderer callers do
 * not report a timeout while the underlying aggregation is still running.
 */
function isUsageHistoryPath(pathNorm: string): boolean {
  const queryIndex = pathNorm.indexOf('?')
  const pathname = queryIndex >= 0 ? pathNorm.slice(0, queryIndex) : pathNorm
  if (pathname !== '/v1/usage') return false
  if (queryIndex < 0) return false
  const groupBy = new URLSearchParams(pathNorm.slice(queryIndex + 1)).get('group_by')
  return groupBy === 'day' || groupBy === 'model' || groupBy === 'thread' || groupBy === 'turn'
}

export function resolveRuntimeRequestTimeoutMs(
  pathNorm: string,
  method: string,
  requestedTimeoutMs?: number
): number {
  if (requestedTimeoutMs !== undefined) return requestedTimeoutMs
  const fallback = method === 'POST'
    ? DEFAULT_RUNTIME_POST_TIMEOUT_MS
    : DEFAULT_RUNTIME_GET_TIMEOUT_MS
  if (method === 'GET' && isThreadTimelinePath(pathNorm)) {
    return THREAD_TIMELINE_GET_TIMEOUT_MS
  }
  if (method === 'GET' && isProviderQuotaPath(pathNorm)) {
    return PROVIDER_QUOTA_GET_TIMEOUT_MS
  }
  if (method === 'GET' && isUsageHistoryPath(pathNorm)) {
    return USAGE_HISTORY_GET_TIMEOUT_MS
  }
  // A whole-session summary is one blocking model call over the full
  // transcript. The generic POST budget cut it off before the runtime could
  // answer, which surfaced as an unexplained desktop failure (#1200).
  if (method === 'POST' && isThreadSummarizePath(pathNorm)) {
    return THREAD_SUMMARIZE_POST_TIMEOUT_MS
  }
  if (method !== 'GET') return fallback
  const waitMs = runtimeEventsWaitMs(pathNorm)
  if (waitMs === null) return fallback
  return Math.max(
    fallback,
    Math.min(waitMs, MAX_RUNTIME_EVENTS_WAIT_MS) +
      RUNTIME_EVENTS_TIMEOUT_MARGIN_MS
  )
}

export async function runtimeRequestViaHost(
  settings: AppSettingsV1,
  pathAndQuery: string,
  init: RuntimeRequestInit,
  ensureRuntime: (settings: AppSettingsV1) => Promise<AppSettingsV1 | void>
): Promise<{ ok: boolean; status: number; body: string }> {
  init.signal?.throwIfAborted()
  const ensuredSettings = await ensureRuntime(settings)
  init.signal?.throwIfAborted()
  const requestSettings = ensuredSettings ?? settings
  const method = (init.method ?? 'GET').toUpperCase()
  const lease = snapshotRuntimeRequestLease(requestSettings)
  const pathNorm = pathAndQuery.startsWith('/') ? pathAndQuery : `/${pathAndQuery}`
  try {
    return await fetchRuntimeRequest(lease, pathNorm, method, init)
  } catch (error) {
    if (init.signal?.aborted) throw error
    // A request timeout is local to that operation. Let the watchdog decide
    // whether the process is globally unhealthy instead of turning one slow
    // attachment preview into an immediate managed-runtime restart.
    if (!isRuntimeConnectionFailure(error)) throw error
    const retrySettings = await ensureRuntime(requestSettings)
    init.signal?.throwIfAborted()
    const nextSettings = retrySettings ?? requestSettings
    const nextLease = snapshotRuntimeRequestLease(nextSettings)
    const safeToRetry = method === 'GET' || method === 'HEAD' ||
      nextLease.baseUrl !== lease.baseUrl
    if (!safeToRetry) throw error
    return fetchRuntimeRequest(nextLease, pathNorm, method, init)
  }
}

/** Acquire one endpoint/token snapshot after the managed runtime is ready. */
export async function acquireRuntimeRequestLease(
  settings: AppSettingsV1,
  ensureRuntime: (settings: AppSettingsV1) => Promise<AppSettingsV1 | void>
): Promise<RuntimeRequestLease> {
  const ensuredSettings = await ensureRuntime(settings)
  return snapshotRuntimeRequestLease(ensuredSettings ?? settings)
}

/**
 * Send exactly one request through an already acquired lease.
 *
 * This deliberately performs no ensure, endpoint rebinding, or retry. A
 * non-idempotent request must fail against the runtime identity for which its
 * authorization material was created.
 */
export function runtimeRequestViaLease(
  lease: RuntimeRequestLease,
  pathAndQuery: string,
  init: RuntimeRequestInit
): Promise<{ ok: boolean; status: number; body: string }> {
  init.signal?.throwIfAborted()
  const method = (init.method ?? 'GET').toUpperCase()
  const pathNorm = pathAndQuery.startsWith('/') ? pathAndQuery : `/${pathAndQuery}`
  return fetchRuntimeRequest(lease, pathNorm, method, init)
}

function snapshotRuntimeRequestLease(settings: AppSettingsV1): RuntimeRequestLease {
  return Object.freeze({
    baseUrl: getRuntimeBaseUrlForSettings(settings),
    runtimeToken: getKunRuntimeSettings(settings).runtimeToken.trim()
  })
}

async function fetchRuntimeRequest(
  lease: RuntimeRequestLease,
  pathNorm: string,
  method: string,
  init: RuntimeRequestInit
): Promise<{ ok: boolean; status: number; body: string }> {
  const url = `${lease.baseUrl}${pathNorm}`
  const hdrs = new Headers()
  for (const [key, value] of Object.entries(init.headers ?? {})) {
    hdrs.set(key, value)
  }
  // Runtime identity is owned by Main. A caller-supplied header must never
  // replace (or synthesize, when absent) the lease authorization.
  if (lease.runtimeToken) {
    hdrs.set('Authorization', `Bearer ${lease.runtimeToken}`)
  } else {
    hdrs.delete('Authorization')
  }
  hdrs.set('Accept', 'application/json')
  if (init.body && !hdrs.has('Content-Type')) {
    hdrs.set('Content-Type', 'application/json')
  }
  const res = await fetch(url, {
    method,
    headers: hdrs,
    body: init.body,
    signal: requestSignal(
      init.signal,
      resolveRuntimeRequestTimeoutMs(pathNorm, method, init.timeoutMs)
    )
  })
  const text = await res.text()
  return { ok: res.ok, status: res.status, body: text }
}

function requestSignal(signal: AbortSignal | undefined, timeoutMs: number): AbortSignal {
  const timeout = AbortSignal.timeout(timeoutMs)
  return signal ? AbortSignal.any([signal, timeout]) : timeout
}

function isRuntimeConnectionFailure(error: unknown): boolean {
  if (!(error instanceof Error)) return false
  const text = `${error.name} ${error.message} ${String((error as { cause?: unknown }).cause ?? '')}`.toLowerCase()
  return (
    text.includes('fetch failed') ||
    text.includes('econnrefused') ||
    text.includes('econnreset') ||
    text.includes('socket') ||
    text.includes('connect')
  )
}

export { buildKunServeArgs, resolveKunExecutable }

/**
 * Default data directory used when the user has not provided one.
 * The path lives under the app user-data directory so packaged
 * installs do not need write access to the install folder.
 */
export function defaultKunDataDir(): string {
  return DEFAULT_KUN_DATA_DIR.replace(/^~(?=$|[\\/])/, homedir())
}
