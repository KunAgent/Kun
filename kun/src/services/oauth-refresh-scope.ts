import { AsyncLocalStorage } from 'node:async_hooks'

/**
 * Credential sources whose OAuth refresh is running in the current async chain.
 *
 * A refresh resolves the provider's fetch (proxy, auth profile), which
 * materializes the model-connection registry, which can resolve the very same
 * credential source again to read the model catalog. Joining the in-flight
 * refresh from inside that chain would make it wait on itself, so nested
 * resolutions use the stored credential instead and let the outer refresh
 * finish.
 */
const activeRefreshes = new AsyncLocalStorage<ReadonlySet<string>>()

/**
 * Chains that only read stored credentials, such as model-metadata lookups
 * while the registry is applied at startup. A third-party token that expired
 * or an unreachable auth server must never hold up opening the application;
 * the token is refreshed by the next model request instead.
 */
const refreshSuppressed = new AsyncLocalStorage<true>()

/** Whether a credential resolution in this async chain may refresh `sourceId`. */
export function mayRefreshOAuthCredential(sourceId: string): boolean {
  return !refreshSuppressed.getStore() && !(activeRefreshes.getStore()?.has(sourceId) ?? false)
}

/** True while any credential source's refresh is running in the current async chain. */
export function isInsideAnyOAuthRefresh(): boolean {
  return (activeRefreshes.getStore()?.size ?? 0) > 0
}

export function runInsideOAuthRefresh<T>(sourceId: string, work: () => Promise<T>): Promise<T> {
  const active = new Set(activeRefreshes.getStore())
  active.add(sourceId)
  return activeRefreshes.run(active, work)
}

export function withoutOAuthRefresh<T>(work: () => Promise<T>): Promise<T> {
  return refreshSuppressed.run(true, work)
}
