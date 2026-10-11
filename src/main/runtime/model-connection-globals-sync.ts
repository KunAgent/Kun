import { getModelProviderSettings, type AppSettingsV1 } from '../../shared/app-settings'
import { getRuntimeBaseUrlForSettings, runtimeAuthHeaders } from './kun-adapter'
import { localModelGatewayConfigForRuntime, providerFailoverConfigForRuntime } from './kun-runtime-model-config'
import { logInfo, logWarn } from '../logger'

const REQUEST_TIMEOUT_MS = 10_000
const MAX_ATTEMPTS = 2

type RegistryGlobalsSnapshot = {
  revision: number
  proxy?: unknown
  routePools?: unknown
  failover?: unknown
  localModelGateway?: unknown
}

/** Globals as the revisioned registry stores them; mirrors the Providers page writer. */
export function desiredModelConnectionGlobals(settings: AppSettingsV1) {
  const provider = getModelProviderSettings(settings)
  return {
    proxy: provider.proxy ?? { enabled: false, url: '' },
    routePools: provider.routePools ?? [],
    failover: providerFailoverConfigForRuntime(settings),
    localModelGateway: localModelGatewayConfigForRuntime(settings)
  }
}

function sameJson(a: unknown, b: unknown): boolean {
  return JSON.stringify(canonical(a)) === JSON.stringify(canonical(b))
}

function canonical(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonical)
  if (!value || typeof value !== 'object') return value
  return Object.fromEntries(
    Object.keys(value as Record<string, unknown>).sort()
      .map((key) => [key, canonical((value as Record<string, unknown>)[key])])
  )
}

export function modelConnectionGlobalsDiffer(
  snapshot: RegistryGlobalsSnapshot,
  desired: ReturnType<typeof desiredModelConnectionGlobals>
): boolean {
  return !sameJson(snapshot.proxy ?? { enabled: false, url: '' }, desired.proxy) ||
    !sameJson(snapshot.routePools ?? [], desired.routePools) ||
    !sameJson(snapshot.failover ?? [], desired.failover) ||
    !sameJson(snapshot.localModelGateway ?? { enabled: false, exposeProviderModels: false }, desired.localModelGateway)
}

/**
 * Hot apply materializes routes and the local gateway from the revisioned
 * model-connections registry, which is otherwise only seeded at startup or
 * written by the Providers page. Settings saved elsewhere (the local gateway
 * page) must reach the registry before apply, or Runtime keeps serving the
 * stale gateway/routes until a restart.
 */
export async function syncModelConnectionGlobals(settings: AppSettingsV1, source: string): Promise<void> {
  const base = getRuntimeBaseUrlForSettings(settings)
  const desired = desiredModelConnectionGlobals(settings)
  for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt += 1) {
    const headers = runtimeAuthHeaders(settings)
    const current = await fetch(`${base}/v1/model-connections`, {
      headers,
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS)
    })
    if (!current.ok) return
    const snapshot = JSON.parse(await current.text()) as RegistryGlobalsSnapshot
    if (!modelConnectionGlobalsDiffer(snapshot, desired)) return
    headers.set('content-type', 'application/json')
    const patched = await fetch(`${base}/v1/model-connections`, {
      method: 'PATCH',
      headers,
      body: JSON.stringify({ expectedRevision: snapshot.revision, ...desired }),
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS)
    })
    if (patched.ok) {
      logInfo(source, 'Synced model-connection globals (routes, gateway) into the Runtime registry.')
      return
    }
    if (patched.status !== 409) {
      logWarn(source, `Model-connection globals sync failed (HTTP ${patched.status}).`)
      return
    }
  }
}
