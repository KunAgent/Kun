import type { RuntimeRequestResult } from '@shared/kun-gui-api'

const RECENT_USAGE_RESPONSE_TTL_MS = 1_000
const RECENT_USAGE_RESPONSE_MAX = 32

type CachedResponse = {
  path: string
  response: RuntimeRequestResult
  settledAt: number
}

const inflight = new Map<string, Promise<RuntimeRequestResult>>()
const transportInflight = new Map<string, {
  requester: typeof window.kunGui.runtimeRequest
  generation?: string | number
  request: Promise<RuntimeRequestResult>
}>()
const recent = new Map<string, CachedResponse>()

/**
 * Coalesce identical usage reads across the composer, timeline, welcome view,
 * and right panel. The short success cache absorbs same-commit React effects
 * without hiding explicit refreshes for more than one second.
 */
export function requestUsage(
  path: string,
  _label: string,
  generation?: string | number
): Promise<RuntimeRequestResult> {
  pruneRecentUsageResponses()
  const cacheKey = `${path}::${generation ?? 'stable'}`
  const cached = generation === undefined ? undefined : recent.get(cacheKey)
  if (cached && Date.now() - cached.settledAt <= RECENT_USAGE_RESPONSE_TTL_MS) {
    return Promise.resolve(cached.response)
  }
  const active = inflight.get(cacheKey)
  if (active) return active
  if (typeof window.kunGui?.runtimeRequest !== 'function') {
    return Promise.resolve({ ok: false, status: 503, body: '' })
  }
  const requester = window.kunGui.runtimeRequest
  const activeTransport = transportInflight.get(path)
  let transport = activeTransport?.requester === requester &&
    activeTransport.generation === generation
    ? activeTransport.request
    : undefined
  if (!transport) {
    // A terminal refresh must not relabel an older generation's response as
    // fresh. Queue behind an older transport for the same path so requests do
    // not stack, then issue a new read for this generation.
    transport = activeTransport?.requester === requester
      ? activeTransport.request.then(
        () => requester(path, 'GET'),
        () => requester(path, 'GET')
      )
      : requester(path, 'GET')
    const tracked = { requester, generation, request: transport }
    transportInflight.set(path, tracked)
    void transport.finally(() => {
      if (transportInflight.get(path) === tracked) transportInflight.delete(path)
    }).catch(() => undefined)
  }
  let request: Promise<RuntimeRequestResult>
  request = transport.then((response) => {
    if (response.ok && generation !== undefined) {
      for (const [key, cachedResponse] of recent) {
        if (cachedResponse.path === path && key !== cacheKey) recent.delete(key)
      }
      recent.set(cacheKey, { path, response, settledAt: Date.now() })
      pruneRecentUsageResponses()
    }
    return response
  }).finally(() => {
    if (inflight.get(cacheKey) === request) inflight.delete(cacheKey)
  })
  inflight.set(cacheKey, request)
  return request
}

function pruneRecentUsageResponses(): void {
  const now = Date.now()
  for (const [key, cached] of recent) {
    if (now - cached.settledAt > RECENT_USAGE_RESPONSE_TTL_MS) recent.delete(key)
  }
  while (recent.size > RECENT_USAGE_RESPONSE_MAX) {
    const oldest = recent.keys().next().value
    if (oldest === undefined) break
    recent.delete(oldest)
  }
}

export function resetUsageRequestCacheForTests(): void {
  inflight.clear()
  transportInflight.clear()
  recent.clear()
}
