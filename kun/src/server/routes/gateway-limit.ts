import type { GatewayClientLimit } from '../../contracts/gateway-client-limit.js'
import type { GatewayClientPolicy } from '../../contracts/gateway-client-policy.js'
import { budgetWindowEnd } from '../../services/gateway-token-budget.js'
import type { JsonResponse } from '../response.js'
import { gatewayClientActiveRequests } from './gateway-client-policy.js'
import { gatewayJsonResponse as jsonResponse } from './gateway-json-response.js'
import { authorizeGateway, openAiError } from './model-gateway-core.js'
import type { ServerRuntime } from './server-runtime.js'
import { GATEWAY_BUSY_RETRY_MS, gatewayRetryHeaders, rateLimitedMessage, withResponseHeaders } from './gateway-retry.js'

/** The same numbers the budget check uses before refusing a request with 429. */
export type { GatewayClientLimit }

export async function gatewayClientLimitStatus(runtime: ServerRuntime, client: { id: string; name?: string },
  policy: GatewayClientPolicy): Promise<GatewayClientLimit> {
  const now = Date.now()
  const summary = policy.tokenBudget || policy.costAlert
    ? await runtime.modelGateway?.budget?.summary(client.id, policy.tokenBudget, policy.costAlert) : undefined
  const window = summary?.windows.find((entry) => entry.active)
  const round = (value: number): number => Math.round(value * 1_000_000) / 1_000_000
  const budget = policy.tokenBudget
  const tokenBudget = budget ? (() => {
    const used = window ? window.measured + window.reserved : 0
    return { mode: budget.mode, period: budget.period, timeZone: budget.timeZone, tokens: budget.tokens, used,
      left: Math.max(0, budget.tokens - used), resetsAt: new Date(window?.endsAt ?? budgetWindowEnd(now, budget)).toISOString() }
  })() : undefined
  const alert = policy.costAlert
  const cost = alert ? (() => {
    const used = round(window?.estimatedCostUsd ?? 0)
    return { period: alert.period, timeZone: alert.timeZone, usd: alert.usd, used, left: round(Math.max(0, alert.usd - used)),
      enforce: alert.enforce === true, resetsAt: new Date(window?.endsAt ?? budgetWindowEnd(now, alert)).toISOString() }
  })() : undefined
  const pools = runtime.modelGateway?.pools() ?? []
  const models = policy.mode === 'legacy-unrestricted' ? 'all' as const
    : [...new Set([...policy.allowedModelIds, ...pools.filter((pool) => policy.allowedRouteIds.includes(pool.id)).map((pool) => pool.modelId)])]
  const expired = policy.expiresAt !== undefined && Date.parse(policy.expiresAt) <= now
  return {
    client, models, protocols: [...policy.allowedProtocols],
    limited: !policy.enabled || expired || (tokenBudget?.mode === 'hard' && tokenBudget.left <= 0) || (cost?.enforce === true && cost.left <= 0),
    rate: { requestsPerMinute: policy.requestsPerMinute, burst: policy.burst, maxConcurrent: policy.maxConcurrent,
      active: gatewayClientActiveRequests(runtime, client.id) },
    ...(tokenBudget ? { tokenBudget } : {}), ...(cost ? { cost } : {}),
    ...(policy.expiresAt ? { expiresAt: policy.expiresAt } : {})
  }
}

/** `GET /v1/kun/limit`: the calling key's own limits. */
export async function gatewayClientLimit(runtime: ServerRuntime, request: Request): Promise<JsonResponse> {
  const verdict = await authorizeGateway(runtime, request)
  if (!verdict.ok) {
    return verdict.reason === 'rate_limited'
      ? withResponseHeaders(openAiError(rateLimitedMessage(verdict.retryAfterMs ?? GATEWAY_BUSY_RETRY_MS), 'rate_limit_exceeded', 429), gatewayRetryHeaders(verdict.retryAfterMs ?? GATEWAY_BUSY_RETRY_MS))
      : openAiError('Invalid gateway API key.', 'invalid_api_key', verdict.reason === 'unavailable' ? 503 : 401)
  }
  if (!runtime.modelGateway?.enabled()) return openAiError('Local model gateway is disabled.', 'gateway_disabled', 404)
  if (verdict.auth.kind === 'harness') return jsonResponse({ client: { id: 'harness' }, limited: false, harness: true })
  const client = verdict.auth.client
  const policy = verdict.auth.policy
  if (!client || !policy) return jsonResponse({ client: { id: 'legacy' }, limited: false, models: 'all' })
  try {
    return jsonResponse(await gatewayClientLimitStatus(runtime, { id: client.clientId, name: client.name }, policy))
  } catch {
    return openAiError('Gateway budget storage is unavailable.', 'capability_unavailable', 503)
  }
}
