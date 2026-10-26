import { z } from 'zod'

/** Shared request enum kept independent of turn/item schemas to avoid cycles. */
export const TurnReasoningEffortSchema = z.enum([
  'auto',
  'off',
  'low',
  'medium',
  'high',
  'xhigh',
  'max'
])
export type TurnReasoningEffort = z.infer<typeof TurnReasoningEffortSchema>
