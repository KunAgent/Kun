import { z } from 'zod'

/** Credential-free failure facts safe to persist and expose to a parent agent. */
export const ChildRunFailureSchema = z.object({
  source: z.enum(['model', 'runtime', 'contract']),
  code: z.string().min(1).max(128).optional(),
  category: z.enum([
    'network',
    'timeout',
    'authentication',
    'quota',
    'rate_limit',
    'unavailable',
    'model_not_found',
    'request',
    'capability',
    'unknown'
  ]).optional(),
  httpStatus: z.number().int().min(400).max(599).optional(),
  retryAfterMs: z.number().int().nonnegative().max(3_600_000).optional()
}).strict()
export type ChildRunFailure = z.infer<typeof ChildRunFailureSchema>

export const ProactiveRetryStatusSchema = z.object({
  enabled: z.boolean(),
  eligible: z.boolean(),
  count: z.number().int().nonnegative(),
  limit: z.number().int().min(1).max(3),
  remaining: z.number().int().nonnegative().max(3)
}).strict()
export type ProactiveRetryStatus = z.infer<typeof ProactiveRetryStatusSchema>
