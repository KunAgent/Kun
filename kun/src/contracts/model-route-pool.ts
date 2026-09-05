import { z } from 'zod'

export const LOCAL_MODEL_GATEWAY_PROVIDER_ID = 'route-gateway:local'

export const ModelRouteStrategySchema = z.enum([
  'priority',
  'round-robin',
  'weighted-round-robin',
  'least-latency',
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
    halfOpenMaxAttempts: z.number().int().min(1).max(10)
  }).strict()
}).strict()
export type ModelRoutePoolConfig = z.infer<typeof ModelRoutePoolConfigSchema>

export const LocalModelGatewayConfigSchema = z.object({
  enabled: z.boolean().default(false)
}).strict()
export type LocalModelGatewayConfig = z.infer<typeof LocalModelGatewayConfigSchema>

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

export type ModelFailureMetadata = {
  category: ModelFailureCategory
  /** True only when the provider supplied an HTTP or protocol-level error response. */
  responseReceived?: boolean
  httpStatus?: number
  providerCode?: string
  retryAfterMs?: number
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
