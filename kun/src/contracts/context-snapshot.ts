import { z } from 'zod'
import { RuntimeEventBase } from './runtime-event-base.js'

export const RequestContextTokenBreakdownSchema = z.object({
  tools: z.number().int().nonnegative(),
  system: z.number().int().nonnegative(),
  skills: z.number().int().nonnegative(),
  messages: z.number().int().nonnegative(),
  other: z.number().int().nonnegative()
})
export type RequestContextTokenBreakdown = z.infer<typeof RequestContextTokenBreakdownSchema>

export const ContextSnapshotEvent = RuntimeEventBase.extend({
  kind: z.literal('context_snapshot'),
  model: z.string().min(1),
  providerId: z.string().min(1).optional(),
  stepIndex: z.number().int().nonnegative(),
  contextWindowTokens: z.number().int().positive(),
  maxInputTokens: z.number().int().positive().optional(),
  softThresholdTokens: z.number().int().positive(),
  hardThresholdTokens: z.number().int().positive(),
  estimatedInputTokens: z.number().int().nonnegative(),
  breakdown: RequestContextTokenBreakdownSchema,
  toolCount: z.number().int().nonnegative(),
  activeSkillIds: z.array(z.string().min(1)),
  contextManagement: z.enum(['kun-managed', 'sdk-managed']).optional(),
  nativeHistory: z.enum(['known', 'unknown', 'none']).optional(),
  /** `agent`: the Agent measured its own request; Kun cannot split it, so `breakdown.messages` holds it all. */
  occupancySource: z.enum(['estimate', 'agent']).optional()
})
export type ContextSnapshotEvent = z.infer<typeof ContextSnapshotEvent>
