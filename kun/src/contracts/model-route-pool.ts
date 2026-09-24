import { z } from 'zod'

export const LOCAL_MODEL_GATEWAY_PROVIDER_ID = 'route-gateway:local'

export const ModelRouteStrategySchema = z.enum([
  'priority',
  'round-robin',
  'weighted-round-robin',
  'least-latency',
  'least-used',
  'adaptive'
])
export type ModelRouteStrategy = z.infer<typeof ModelRouteStrategySchema>

export const ModelRouteTargetConfigSchema = z.object({
  id: z.string().min(1).max(64),
  providerId: z.string().min(1).max(128),
  modelId: z.string().min(1).max(512),
  enabled: z.boolean().default(true),
  weight: z.number().int().min(1).max(100).default(1)
}).strict()
export type ModelRouteTargetConfig = z.infer<typeof ModelRouteTargetConfigSchema>

export const ModelRoutePoolConfigSchema = z.object({
  id: z.string().min(1).max(64),
  name: z.string().min(1).max(80),
  modelId: z.string().min(1).max(512),
  enabled: z.boolean().default(true),
  strategy: ModelRouteStrategySchema.default('priority'),
  targets: z.array(ModelRouteTargetConfigSchema).min(1).max(50),
  failurePolicy: z.object({
    failoverHttpStatusCodes: z.array(z.number().int().min(400).max(599)).max(64),
    failoverOnNetworkError: z.boolean(),
    failoverOnTimeout: z.boolean(),
    failoverOnAuthError: z.boolean()
  }).strict(),
  healthPolicy: z.object({
    failureThreshold: z.number().int().min(1).max(20),
    cooldownMs: z.number().int().min(1_000).max(3_600_000),
    halfOpenMaxAttempts: z.number().int().min(1).max(10),
    /** Cooldown for credit/billing failures, which open on the first failure. */
    creditCooldownMs: z.number().int().min(1_000).max(86_400_000).optional(),
    /** Cooldown for quota-exhausted failures when no reset time is declared. */
    quotaCooldownMs: z.number().int().min(1_000).max(86_400_000).optional(),
    /** Cooldown for authentication failures, which open on the first failure. */
    authCooldownMs: z.number().int().min(1_000).max(86_400_000).optional(),
    /** Upper bound for the exponential cooldown of other failures. */
    maxCooldownMs: z.number().int().min(1_000).max(86_400_000).optional()
  }).strict()
}).strict()
export type ModelRoutePoolConfig = z.infer<typeof ModelRoutePoolConfigSchema>

export const LocalModelGatewayConfigSchema = z.object({
  enabled: z.boolean().default(false)
}).strict()
export type LocalModelGatewayConfig = z.infer<typeof LocalModelGatewayConfigSchema>

/**
 * Account-group rotation strategy inside a provider failover group:
 * - `smart`: adaptive score (latency, recent failures, cached quota).
 * - `order`: strict member priority; later accounts only run on failover.
 * - `rotate`: round-robin across enabled members.
 * - `least-used`: member with the fewest served requests this session.
 */
export const ModelFailoverStrategySchema = z.enum([
  'smart',
  'order',
  'rotate',
  'least-used'
])
export type ModelFailoverStrategy = z.infer<typeof ModelFailoverStrategySchema>

export const ModelFailoverMemberSchema = z.object({
  providerId: z.string().min(1).max(128),
  enabled: z.boolean().default(true),
  /** Declared model ids; a member only receives models it declares. */
  models: z.array(z.string().min(1).max(512)).max(500).default([])
}).strict()
export type ModelFailoverMember = z.infer<typeof ModelFailoverMemberSchema>

export const ModelFailoverFallbackTargetSchema = z.object({
  providerId: z.string().min(1).max(128),
  modelId: z.string().min(1).max(512)
}).strict()
export type ModelFailoverFallbackTarget = z.infer<typeof ModelFailoverFallbackTargetSchema>

/**
 * Provider-level failover: one logical provider backed by several accounts
 * (same vendor, distinct keys) plus an ordered cross-provider fallback
 * chain. `members[0]` is the representative account the GUI shows.
 * Groups are explicit opt-in — a provider absent from every group keeps
 * single-target behavior.
 */
export const ModelFailoverGroupSchema = z.object({
  providerId: z.string().min(1).max(128),
  members: z.array(ModelFailoverMemberSchema).min(1).max(21),
  strategy: ModelFailoverStrategySchema.default('smart'),
  fallbackTargets: z.array(ModelFailoverFallbackTargetSchema).max(20).default([])
}).strict()
export type ModelFailoverGroup = z.infer<typeof ModelFailoverGroupSchema>

export type ModelFailureCategory =
  | 'network'
  | 'timeout'
  | 'authentication'
  | 'quota'
  | 'rate_limit'
  | 'unavailable'
  | 'model_not_found'
  | 'request'
  | 'capability'
  | 'unknown'

/** Fine-grained reason produced by the shared failure classifier. */
export type ModelFailureReason =
  | 'credit'
  | 'quota'
  | 'rate'
  | 'overloaded'
  | 'auth'
  | 'model'
  | 'request'
  | 'other'

export type ModelFailureMetadata = {
  category: ModelFailureCategory
  /** Unified failure reason; additive alongside the legacy `category`. */
  reason?: ModelFailureReason
  /** True only when the provider supplied an HTTP or protocol-level error response. */
  responseReceived?: boolean
  httpStatus?: number
  providerCode?: string
  retryAfterMs?: number
  /** Provider-declared quota reset instant (ISO 8601), when known. */
  resetAt?: string
  failoverAllowed: boolean
  routePoolId?: string
  targetId?: string
  providerId?: string
  modelId?: string
}

export function isLoopbackHost(host: string | undefined): boolean {
  const value = (host ?? '127.0.0.1').trim().toLowerCase().replace(/^\[|\]$/g, '')
  return value === '127.0.0.1' || value === '::1' || value === 'localhost'
}
