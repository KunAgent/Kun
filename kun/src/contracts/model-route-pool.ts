import { z } from 'zod'
import { GatewayMiddlewareSchema } from './gateway-middleware.js'

export const LOCAL_MODEL_GATEWAY_PROVIDER_ID = 'route-gateway:local'

export const ModelRouteStrategySchema = z.enum([
  'priority',
  'round-robin',
  'weighted-round-robin',
  'least-latency',
  'least-used',
  'adaptive',
  /** The user picks one member (`pick`); the others wait as fallbacks. */
  'manual'
])

/** A target whose `modelId` names another route alias; flattened at load with cycle checks. */
export const NESTED_ROUTE_PROVIDER_ID = '@route'
export const MAX_NESTED_ROUTE_DEPTH = 3

const RouteEffortSchema = z.enum(['off', 'low', 'medium', 'high', 'max', 'auto'])
export type ModelRouteStrategy = z.infer<typeof ModelRouteStrategySchema>

export const ModelRouteTargetConfigSchema = z.object({
  id: z.string().min(1).max(64),
  providerId: z.string().min(1).max(128),
  modelId: z.string().min(1).max(512),
  enabled: z.boolean().default(true),
  weight: z.number().int().min(1).max(100).default(1),
  /** Reasoning this member always runs at, whatever the caller asked. */
  effort: RouteEffortSchema.optional()
}).strict()
export type ModelRouteTargetConfig = z.infer<typeof ModelRouteTargetConfigSchema>

/**
 * A rule puts one member first for the turns it matches. It is evaluated when
 * a turn begins and held for the rest of that turn, so tool results return
 * to the model that asked for them.
 */
export const ModelRouteRuleSchema = z.object({
  id: z.string().min(1).max(64),
  enabled: z.boolean().default(true),
  /** Target id to put first. */
  use: z.string().min(1).max(64),
  /** Reasoning to send that member at for matching turns. */
  effort: RouteEffortSchema.optional(),
  when: z.object({
    /** Calling agents (gateway attribution); `kun` for Kun's own turns. */
    agents: z.array(z.string().min(1).max(64)).max(20).optional(),
    /** Estimated prompt tokens, inclusive bounds. */
    minTokens: z.number().int().min(0).max(10_000_000).optional(),
    maxTokens: z.number().int().min(0).max(10_000_000).optional(),
    images: z.boolean().optional(),
    /** Reasoning efforts the caller asked for. */
    efforts: z.array(RouteEffortSchema).max(6).optional(),
    /** Local hours [from, to); wraps past midnight when from > to. */
    hours: z.object({ from: z.number().int().min(0).max(23), to: z.number().int().min(0).max(24) }).strict().optional(),
    /** Case-insensitive text the turn's latest user message contains. */
    contains: z.string().min(1).max(200).optional(),
    /** Intent the pool's classifier assigned to the turn. */
    intent: z.string().min(1).max(40).optional()
  }).strict()
}).strict()
export type ModelRouteRule = z.infer<typeof ModelRouteRuleSchema>

export const ModelRoutePoolConfigSchema = z.object({
  id: z.string().min(1).max(64),
  name: z.string().min(1).max(80),
  modelId: z.string().min(1).max(512),
  enabled: z.boolean().default(true),
  strategy: ModelRouteStrategySchema.default('priority'),
  /** Missing on legacy routes: preserve their request-filter behavior. */
  capabilityMode: z.enum(['guaranteed', 'request-filter']).optional(),
  affinity: z.object({
    mode: z.enum(['off', 'turn', 'session']),
    ttlMs: z.number().int().min(60_000).max(86_400_000).default(30 * 60_000)
  }).strict().optional(),
  targets: z.array(ModelRouteTargetConfigSchema).min(1).max(50),
  /** Member the `manual` strategy sends to. */
  pick: z.string().min(1).max(64).optional(),
  rules: z.array(ModelRouteRuleSchema).max(20).optional(),
  /** Small model that labels each new turn with one of `intents` for intent rules. */
  classifier: z.object({
    providerId: z.string().min(1).max(128),
    modelId: z.string().min(1).max(512),
    intents: z.array(z.string().min(1).max(40)).min(2).max(12)
  }).strict().optional(),
  /** Demote members whose known window is at least 95% full for this request (default on). */
  overflowMove: z.boolean().optional(),
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
  enabled: z.boolean().default(false),
  /**
   * Opt-in: expose configured API-key providers as `providerId/modelId` on the
   * local gateway. Off by default; subscription, OAuth, and non-HTTP providers
   * are never exposed regardless of this flag.
   */
  exposeProviderModels: z.boolean().default(false),
  /** Ordered request/reply transforms applied to external gateway traffic. */
  middleware: z.array(GatewayMiddlewareSchema).max(32).optional(),
  /** Extension providers the user exports, each with the one account requests use. */
  extensionExports: z.array(z.object({ providerId: z.string().min(1).max(160), accountId: z.string().min(1).max(160) }).strict()).max(50).optional(),
  /** Experimental: ChatGPT subscription connections the user chose to share through the gateway. */
  experimentalSubscriptionExports: z.array(z.string().min(1).max(128)).max(10).optional()
}).strict()
export type LocalModelGatewayConfig = z.infer<typeof LocalModelGatewayConfigSchema>

/**
 * Account-group rotation strategy inside a provider failover group:
 * - `smart`: adaptive score (latency, recent failures, cached quota).
 * - `order`: strict member priority; later accounts only run on failover.
 * - `rotate`: round-robin across enabled members.
 * - `least-used`: member with the fewest served requests this session.
 * - `pace`: member with the most allowance left per hour until its window
 *   resets, so less of each window is lost at reset.
 */
export const ModelFailoverStrategySchema = z.enum([
  'smart',
  'order',
  'rotate',
  'least-used',
  'pace'
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
  /** Local queue pressure is not an upstream health failure. */
  localAdmission?: boolean
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
