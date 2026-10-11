import type { GatewayClientPolicy } from '../../contracts/gateway-client-policy.js'
import type { GatewayRouteTarget } from '../../domain/model-gateway-export-policy.js'
import type { ModelRoutePoolConfig } from '../../contracts/model-route-pool.js'
import type { ServerRuntime } from './server-runtime.js'
import { GatewayRequestGuard, type GatewayLease } from './gateway-request-guard.js'

type ClientGuard = { policy: GatewayClientPolicy; guard: GatewayRequestGuard }
const guards = new WeakMap<object, Map<string, ClientGuard>>()

export function cancelGatewayClientRequests(runtime: ServerRuntime, clientId: string): number {
  const owner = runtime.modelGateway?.credentials
  return owner ? guards.get(owner)?.get(clientId)?.guard.cancelAll() ?? 0 : 0
}

/** Requests the client has in flight now. */
export function gatewayClientActiveRequests(runtime: ServerRuntime, clientId: string): number {
  const owner = runtime.modelGateway?.credentials
  return owner ? guards.get(owner)?.get(clientId)?.guard.activeCount() ?? 0 : 0
}

export function clientGuardFor(runtime: ServerRuntime, clientId: string, policy: GatewayClientPolicy): GatewayRequestGuard {
  const owner = runtime.modelGateway!.credentials
  let clients = guards.get(owner)
  if (!clients) { clients = new Map(); guards.set(owner, clients) }
  let entry = clients.get(clientId)
  if (entry) { entry.policy = policy; return entry.guard }
  if (clients.size >= 1_025) {
    for (const [id, candidate] of clients) {
      if (candidate.guard.activeCount() === 0) { clients.delete(id); break }
    }
  }
  const state: ClientGuard = { policy, guard: undefined! }
  state.guard = new GatewayRequestGuard({ verify: () => false }, {
    get capacity() { return state.policy.burst },
    get refillPerSecond() { return state.policy.requestsPerMinute / 60 },
    get maxConcurrency() { return state.policy.maxConcurrent },
    get timeoutMs() { return state.policy.requestTimeoutMs }
  })
  clients.set(clientId, state)
  return state.guard
}

export function combinedGatewayLease(global: GatewayLease | null, scoped: GatewayLease | null): GatewayLease | null {
  if (!global || !scoped) { global?.release(); scoped?.release(); return null }
  return { signal: AbortSignal.any([global.signal, scoped.signal]),
    deadlineAt: Math.min(global.deadlineAt ?? Infinity, scoped.deadlineAt ?? Infinity),
    timedOut: () => global.timedOut() || scoped.timedOut(),
    release: () => { global.release(); scoped.release() },
    cancel: () => { global.cancel(); scoped.cancel() } }
}

export function clientRouteTargets(policy: GatewayClientPolicy | undefined, pool: ModelRoutePoolConfig,
  targets: GatewayRouteTarget[]): GatewayRouteTarget[] {
  if (!policy || policy.mode === 'legacy-unrestricted') return targets
  if (!policy.allowedRouteIds.includes(pool.id)) return []
  return targets.filter((target) => policy.allowedConnectionIds.includes(target.providerId))
}

export function clientDirectTargets(policy: GatewayClientPolicy | undefined,
  requested: GatewayRouteTarget, targets: GatewayRouteTarget[]): GatewayRouteTarget[] {
  if (!policy || policy.mode === 'legacy-unrestricted') return targets
  if (!policy.allowedModelIds.includes(`${requested.providerId}/${requested.modelId}`)) return []
  return targets.filter((target) => policy.allowedConnectionIds.includes(target.providerId) &&
    policy.allowedModelIds.includes(`${target.providerId}/${target.modelId}`))
}

export function gatewayRequestProtocol(request: Request): 'chat_completions' | 'responses' | 'messages' | 'gemini' | undefined {
  const path = new URL(request.url).pathname
  if (path.startsWith('/v1beta/')) return 'gemini'
  return path.endsWith('/chat/completions') ? 'chat_completions'
    : path.endsWith('/responses') ? 'responses'
      : path.includes('/messages') ? 'messages' : undefined
}
