import { z } from 'zod'
import { HarnessIdSchema } from './harness.js'

export const HarnessContinuationFailureSchema = z.object({
  stage: z.enum(['binding_validation', 'session/load', 'session/load_result', 'session/configure', 'session/new']),
  code: z.string().min(1).max(128),
  message: z.string().min(1).max(1_024),
  detailsAvailable: z.boolean(),
  rpcCode: z.number().int().optional(),
  connectionClosed: z.boolean(),
  process: z.object({
    exitCode: z.number().int().nullable(),
    signal: z.string().max(64).nullable(),
    stderrTail: z.string().max(4_096).optional()
  }).strict().optional()
}).strict()
export type HarnessContinuationFailure = z.infer<typeof HarnessContinuationFailureSchema>

export const HarnessContinuationSessionSchema = z.object({
  generation: z.number().int().positive(),
  nativeSessionId: z.string().min(1).max(1_024).optional()
}).strict()

export const HarnessContinuationPayloadSchema = z.object({
  harnessId: HarnessIdSchema,
  providerKind: z.literal('acp'),
  reason: z.enum(['history_changed', 'capabilities_changed', 'native_state_unavailable']),
  previousSession: HarnessContinuationSessionSchema,
  failure: HarnessContinuationFailureSchema,
  replacementSession: HarnessContinuationSessionSchema.optional(),
  recreationError: HarnessContinuationFailureSchema.optional(),
  recovery: z.object({
    mode: z.enum(['full', 'delta', 'none']),
    recentTurns: z.number().int().nonnegative(),
    sinceTurnId: z.string().max(256).optional(),
    briefDigest: z.string().max(64).optional(),
    bytes: z.number().int().nonnegative()
  }).strict().optional()
}).strict()
export type HarnessContinuationPayload = z.infer<typeof HarnessContinuationPayloadSchema>
