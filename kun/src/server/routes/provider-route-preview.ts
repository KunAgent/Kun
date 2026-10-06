import { z } from 'zod'
import { gatewayTargetExportable } from '../../domain/model-gateway-export-policy.js'
import { gatewayPolicyActive } from '../../contracts/gateway-client-policy.js'
import { GATEWAY_MAX_ROUTE_ATTEMPTS, GATEWAY_REQUEST_TIMEOUT_MS } from '../../adapters/model/gateway-routing-budget.js'
import type { ServerRuntime } from './server-runtime.js'

const Input = z.object({ routeId: z.string().min(1).max(128), clientId: z.string().max(128).optional(),
  protocol: z.enum(['chat_completions', 'responses', 'messages']).default('chat_completions'),
  tools: z.boolean().default(false), vision: z.boolean().default(false),
  maxOutputTokens: z.number().int().positive().optional() }).strict()

/** Read-only configuration/eligibility explanation. No half-open slot or strategy cursor is consumed. */
export async function previewProviderRoute(runtime: ServerRuntime, raw: unknown) {
  const input = Input.parse(raw)
  const snapshot = await runtime.modelConnections!.snapshot()
  const pool = snapshot.routePools.find((route) => route.id === input.routeId)
  if (!pool) throw new Error('Unknown route')
  const explicit = input.clientId ? await runtime.modelConnections!.gatewayClientPolicy(input.clientId) : undefined
  const policy = explicit?.policy ?? (input.clientId ? runtime.modelGateway?.credentials.defaultClientPolicy(input.clientId) : undefined)
  const metadata = (providerId: string, modelId: string) => runtime.modelGateway?.modelCapabilities?.(modelId, providerId)
  const targets = pool.targets.map((target) => {
    const capability = metadata(target.providerId, target.modelId)
    const reason = !pool.enabled || !target.enabled ? 'disabled'
      : !gatewayTargetExportable(snapshot.providers, target) ? 'connection_unavailable_or_not_exportable'
        : policy && (!gatewayPolicyActive(policy) || !policy.allowedProtocols.includes(input.protocol) ||
          policy.mode !== 'legacy-unrestricted' && (!policy.allowedRouteIds.includes(pool.id) || !policy.allowedConnectionIds.includes(target.providerId))) ? 'client_scope'
          : input.tools && !capability?.supportsToolCalling ? 'tools_unknown_or_unsupported'
            : input.vision && !capability?.inputModalities.includes('image') ? 'vision_unknown_or_unsupported'
              : input.maxOutputTokens && capability?.maxOutputTokens && input.maxOutputTokens > capability.maxOutputTokens ? 'output_limit'
                : runtime.modelGateway?.health && !runtime.modelGateway.health.available(pool, target) ? 'health_cooldown' : undefined
    return { targetId: target.id, providerId: target.providerId, modelId: target.modelId,
      eligible: reason === undefined, reason: reason ?? 'eligible', capability }
  })
  const eligible = targets.filter((target) => target.eligible)
  const caps = eligible.map((target) => target.capability)
  const minKnown = (field: 'contextWindowTokens' | 'maxOutputTokens') => caps.length && caps.every((cap) => cap?.[field])
    ? Math.min(...caps.map((cap) => cap![field]!)) : undefined
  return { revision: snapshot.revision, routeId: pool.id, alias: pool.modelId, strategy: pool.strategy,
    affinity: pool.affinity?.mode ?? 'off', dispatches: 0, maxAttempts: GATEWAY_MAX_ROUTE_ATTEMPTS,
    timeoutMs: Math.min(policy?.requestTimeoutMs ?? GATEWAY_REQUEST_TIMEOUT_MS, GATEWAY_REQUEST_TIMEOUT_MS),
    targets, guarantees: { tools: Boolean(caps.length && caps.every((cap) => cap?.supportsToolCalling)),
      vision: Boolean(caps.length && caps.every((cap) => cap?.inputModalities.includes('image'))),
      contextWindowTokens: minKnown('contextWindowTokens'), maxOutputTokens: minKnown('maxOutputTokens') } }
}
