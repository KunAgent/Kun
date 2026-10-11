import { z } from 'zod'
import { gatewayTargetExportable } from '../../domain/model-gateway-export-policy.js'
import { gatewayPolicyActive } from '../../contracts/gateway-client-policy.js'
import { ModelRoutePoolConfigSchema } from '../../contracts/model-route-pool.js'
import { routeCapabilityGuarantees } from '../../adapters/model/route-capability-contract.js'
import { capabilityFieldKnown } from '../../contracts/model-metadata-evidence.js'
import { GATEWAY_MAX_ROUTE_ATTEMPTS, GATEWAY_REQUEST_TIMEOUT_MS } from '../../adapters/model/gateway-routing-budget.js'
import type { ServerRuntime } from './server-runtime.js'

const Input = z.object({ routeId: z.string().min(1).max(128), clientId: z.string().max(128).optional(),
  protocol: z.enum(['chat_completions', 'responses', 'messages', 'gemini']).default('chat_completions'),
  tools: z.boolean().default(false), vision: z.boolean().default(false),
  maxOutputTokens: z.number().int().positive().optional(), draft: ModelRoutePoolConfigSchema.optional() }).strict()

/** Read-only explanation: never consumes a half-open slot, strategy cursor or inference token. */
export async function previewProviderRoute(runtime: ServerRuntime, raw: unknown) {
  const input = Input.parse(raw)
  const snapshot = await runtime.modelConnections!.snapshot()
  const saved = snapshot.routePools.find((route) => route.id === input.routeId)
  const pool = input.draft ?? saved
  if (!pool || pool.id !== input.routeId) throw new Error('Unknown route')
  const explicit = input.clientId ? await runtime.modelConnections!.gatewayClientPolicy(input.clientId) : undefined
  const policy = explicit?.policy ?? (input.clientId ? runtime.modelGateway?.credentials.defaultClientPolicy(input.clientId) : undefined)
  if (input.clientId && !policy) throw new Error('Unknown gateway client')
  const metadata = (providerId: string, modelId: string) => runtime.modelGateway?.modelCapabilities?.(modelId, providerId)
  const authorized = pool.targets.filter((target) => target.enabled && gatewayTargetExportable(snapshot.providers, target) &&
    (!policy || gatewayPolicyActive(policy) && policy.allowedProtocols.includes(input.protocol) &&
      (policy.mode === 'legacy-unrestricted' || policy.allowedRouteIds.includes(pool.id) && policy.allowedConnectionIds.includes(target.providerId))))
  const guarantees = routeCapabilityGuarantees(authorized.map((target) => metadata(target.providerId, target.modelId)))
  const guaranteedFailure = pool.capabilityMode === 'guaranteed' &&
    (input.tools && !guarantees.tools || input.vision && !guarantees.vision ||
      input.maxOutputTokens && guarantees.maxOutputTokens && input.maxOutputTokens > guarantees.maxOutputTokens)
  const targets = pool.targets.map((target) => {
    const capability = metadata(target.providerId, target.modelId)
    const reason = !pool.enabled || !target.enabled ? 'disabled'
      : !gatewayTargetExportable(snapshot.providers, target) ? 'connection_unavailable_or_not_exportable'
        : !authorized.some((entry) => entry.id === target.id) ? 'client_scope'
          : guaranteedFailure ? 'route_guarantee'
            : input.tools && (!capability?.supportsToolCalling || !capabilityFieldKnown(capability, 'supportsToolCalling')) ? 'tools_unknown_or_unsupported'
              : input.vision && (!capability?.inputModalities.includes('image') || !capabilityFieldKnown(capability, 'inputModalities')) ? 'vision_unknown_or_unsupported'
                : input.maxOutputTokens && capability?.maxOutputTokens && input.maxOutputTokens > capability.maxOutputTokens ? 'output_limit'
                  : runtime.modelGateway?.health && !runtime.modelGateway.health.available(pool, target) ? 'health_cooldown' : undefined
    return { targetId: target.id, providerId: target.providerId, modelId: target.modelId,
      eligible: reason === undefined, reason: reason ?? 'eligible', capability }
  })
  const eligible = pool.targets.filter((target) => targets.find((entry) => entry.targetId === target.id)?.eligible)
  const ordered = runtime.modelGateway?.previewOrder?.(pool, eligible) ?? eligible
  const configuration = await runtime.modelConnections!.configurationSnapshot?.()
  const affectedClients = Object.entries(configuration?.configuration.gatewayPolicies ?? {}).flatMap(([clientId, client]) =>
    client.mode === 'scoped' && client.allowedRouteIds.includes(pool.id) ? [{ clientId,
      excludedConnectionIds: [...new Set(pool.targets.filter((target) => !client.allowedConnectionIds.includes(target.providerId)).map((target) => target.providerId))] }] : [])
  return { revision: snapshot.revision, routeId: pool.id, alias: pool.modelId, strategy: pool.strategy,
    capabilityMode: pool.capabilityMode ?? 'request-filter', affinity: pool.affinity?.mode ?? 'off',
    dispatches: 0, maxAttempts: GATEWAY_MAX_ROUTE_ATTEMPTS,
    timeoutMs: Math.min(policy?.requestTimeoutMs ?? GATEWAY_REQUEST_TIMEOUT_MS, GATEWAY_REQUEST_TIMEOUT_MS),
    targets, guarantees, orderedTargetIds: ordered.map((target) => target.id),
    orderingBasis: runtime.modelGateway?.previewOrder ? 'live-strategy-state' : 'configured-order', affectedClients }
}
