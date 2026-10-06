import { GatewayClientPolicySchema, type GatewayClientPolicy } from '../../contracts/gateway-client-policy.js'
import { readJsonBody } from '../read-json-body.js'
import type { JsonResponse } from '../response.js'
import { gatewayJsonResponse as privateResponse } from './gateway-json-response.js'
import { listGatewayModels, resolveGatewayModel } from './model-gateway-core.js'
import type { ServerRuntime } from './server-runtime.js'

/**
 * Admin-only helpers for wiring external agents (Agents page, `kun connect`).
 * Both require the runtime admin token; a gateway key can never reach them.
 */
export async function gatewayAdminCatalog(runtime: ServerRuntime): Promise<JsonResponse> {
  if (!runtime.modelGateway) return privateResponse({ code: 'capability_unavailable', message: 'Gateway is unavailable.' }, 503)
  try {
    return privateResponse({ enabled: runtime.modelGateway.enabled(), data: await listGatewayModels(runtime) })
  } catch {
    return privateResponse({ code: 'capability_unavailable', message: 'Gateway configuration changed; retry.' }, 503)
  }
}

/** Unions a public model into a client's policy, so one agent key can follow the agent's model choice. */
export function widenClientPolicy(policy: GatewayClientPolicy | undefined, grant: { routeId?: string; modelId?: string; connectionIds: string[] }): GatewayClientPolicy {
  const base = GatewayClientPolicySchema.parse(policy ?? {})
  if (base.mode === 'legacy-unrestricted') return base
  const union = (left: string[], right: (string | undefined)[]) => [...new Set([...left, ...right.filter((value): value is string => Boolean(value))])]
  return GatewayClientPolicySchema.parse({ ...base,
    allowedRouteIds: union(base.allowedRouteIds, [grant.routeId]),
    allowedModelIds: union(base.allowedModelIds, [grant.modelId]),
    allowedConnectionIds: union(base.allowedConnectionIds, grant.connectionIds) })
}

export async function allowGatewayClientModel(runtime: ServerRuntime, clientId: string, request: Request): Promise<JsonResponse> {
  const credentials = runtime.modelGateway?.credentials
  if (!credentials || !runtime.modelConnections) return privateResponse({ code: 'capability_unavailable', message: 'Gateway is unavailable.' }, 503)
  if (!credentials.listClients().some((client) => client.clientId === clientId && !client.revokedAt)) {
    return privateResponse({ code: 'not_found', message: 'Gateway client not found.' }, 404)
  }
  const parsed = await readJsonBody(request, 64 * 1_024, request.signal)
  if (!parsed.ok) return parsed.response
  const body = (parsed.value ?? {}) as Record<string, unknown>
  const requested = [...new Set([...(typeof body.modelId === 'string' ? [body.modelId] : []),
    ...(Array.isArray(body.modelIds) ? body.modelIds.filter((value): value is string => typeof value === 'string') : [])]
    .map((value) => value.trim()))]
  if (!requested.length || requested.length > 500 || requested.some((value) => !value || value.length > 512)) {
    return privateResponse({ code: 'validation_error', message: 'Provide 1-500 public model ids.' }, 400)
  }
  try {
    const current = await runtime.modelConnections.gatewayClientPolicy(clientId)
    let policy = current.policy
    const allowed: string[] = []
    for (const modelId of requested) {
      const resolved = await resolveGatewayModel(runtime, modelId)
      if (!resolved) continue
      const pool = runtime.modelGateway?.pools().find((entry) => entry.enabled && entry.modelId === modelId)
      policy = widenClientPolicy(policy, { ...(pool ? { routeId: pool.id } : { modelId }),
        connectionIds: resolved.gatewayRouting.allowedTargets.map((target) => target.providerId) })
      allowed.push(modelId)
    }
    if (!allowed.length) return privateResponse({ code: 'validation_error', message: 'Select an exportable public model.' }, 400)
    const preview = await runtime.modelConnections.previewConfiguration({ expectedRevision: current.revision,
      operations: [{ kind: 'set-client-policy', clientId, policy }] })
    const committed = await runtime.modelConnections.commitConfiguration({ previewId: preview.previewId,
      expectedRevision: preview.expectedRevision, idempotencyKey: `gateway-client-allow:${clientId}:${current.revision}:${allowed.length}` })
    if (!committed.applied) throw new Error('not applied')
    return privateResponse({ clientId, allowed })
  } catch {
    return privateResponse({ code: 'capability_unavailable', message: 'The client policy could not be updated. Retry.' }, 503)
  }
}

/** Middleware counters (calls, average time, failures, load errors) for the gateway settings page. */
export function gatewayAdminMiddleware(runtime: ServerRuntime): JsonResponse {
  const host = runtime.modelGateway?.middleware
  if (!host) return privateResponse({ middleware: [] })
  return privateResponse({ middleware: host.stats() })
}
