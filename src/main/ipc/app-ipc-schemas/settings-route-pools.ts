import { z } from 'zod'
import { MAX_MODEL_ID_LENGTH } from './common'

const routeEffortSchema = z.enum(['off', 'low', 'medium', 'high', 'max', 'auto'])
const modelIdSchema = z.string().trim().min(1).max(MAX_MODEL_ID_LENGTH)

/** Renderer patches for route pools, including turn rules, member effort, manual pick and nesting. */
export const routePoolPatchesSchema = z.array(z.object({
  capabilityMode: z.enum(['guaranteed', 'request-filter']).optional(),
  affinity: z.object({ mode: z.enum(['off', 'turn', 'session']), ttlMs: z.number().int().min(60_000).max(86_400_000) }).strict().optional(),
  id: z.string().trim().min(1).max(64).optional(),
  name: z.string().trim().min(1).max(80).optional(),
  modelId: modelIdSchema.optional(),
  enabled: z.boolean().optional(),
  strategy: z.enum(['priority', 'round-robin', 'weighted-round-robin', 'least-latency', 'least-used', 'adaptive', 'manual']).optional(),
  targets: z.array(z.object({
    id: z.string().trim().min(1).max(64),
    providerId: z.string().trim().min(1).max(64),
    modelId: modelIdSchema,
    enabled: z.boolean(),
    weight: z.number().int().min(1).max(100),
    effort: routeEffortSchema.optional()
  }).strict()).max(50).optional(),
  pick: z.string().trim().min(1).max(64).optional(),
  rules: z.array(z.object({
    id: z.string().trim().min(1).max(64),
    enabled: z.boolean(),
    use: z.string().trim().min(1).max(64),
    effort: routeEffortSchema.optional(),
    when: z.object({
      agents: z.array(z.string().trim().min(1).max(64)).max(20).optional(),
      minTokens: z.number().int().min(0).max(10_000_000).optional(),
      maxTokens: z.number().int().min(0).max(10_000_000).optional(),
      images: z.boolean().optional(),
      efforts: z.array(routeEffortSchema).max(6).optional(),
      hours: z.object({ from: z.number().int().min(0).max(23), to: z.number().int().min(0).max(24) }).strict().optional(),
      contains: z.string().min(1).max(200).optional(),
      intent: z.string().trim().min(1).max(40).optional()
    }).strict()
  }).strict()).max(20).optional(),
  classifier: z.object({
    providerId: z.string().trim().min(1).max(128),
    modelId: modelIdSchema,
    intents: z.array(z.string().trim().min(1).max(40)).min(2).max(12)
  }).strict().optional(),
  overflowMove: z.boolean().optional(),
  failurePolicy: z.object({
    failoverHttpStatusCodes: z.array(z.number().int().min(400).max(599)).max(64),
    failoverOnNetworkError: z.boolean(),
    failoverOnTimeout: z.boolean(),
    failoverOnAuthError: z.boolean()
  }).strict().optional(),
  healthPolicy: z.object({
    failureThreshold: z.number().int().min(1).max(20),
    cooldownMs: z.number().int().min(1000).max(3_600_000),
    halfOpenMaxAttempts: z.number().int().min(1).max(10),
    creditCooldownMs: z.number().int().min(1000).max(86_400_000).optional(),
    quotaCooldownMs: z.number().int().min(1000).max(86_400_000).optional(),
    authCooldownMs: z.number().int().min(1000).max(86_400_000).optional(),
    maxCooldownMs: z.number().int().min(1000).max(86_400_000).optional()
  }).strict().optional()
}).strict()).max(100).optional()
