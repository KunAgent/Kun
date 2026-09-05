import { z } from 'zod'

export const ModelRequestFailureStateSchema = z.enum([
  'provider_responded',
  'sent_no_response',
  'not_sent'
])
export type ModelRequestFailureState = z.infer<typeof ModelRequestFailureStateSchema>

export const ModelRequestFailureCategorySchema = z.enum([
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
])
export type ModelRequestFailureCategory = z.infer<typeof ModelRequestFailureCategorySchema>

/** Safe, durable provenance for one failed model request. */
export const ModelRequestFailureContextSchema = z.object({
  requestState: ModelRequestFailureStateSchema,
  providerId: z.string().min(1).max(128).optional(),
  model: z.string().min(1).max(512).optional(),
  httpStatus: z.number().int().min(100).max(599).optional(),
  providerCode: z.string().min(1).max(128).optional(),
  category: ModelRequestFailureCategorySchema.optional(),
  retryAfterMs: z.number().int().nonnegative().max(3_600_000).optional()
}).strict()
export type ModelRequestFailureContext = z.infer<typeof ModelRequestFailureContextSchema>
