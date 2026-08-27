import { z } from 'zod'

export const ThreadRetentionPolicySchema = z.object({
  keepLastTurns: z.number().int().positive().max(100_000).optional(),
  keepDays: z.number().int().positive().max(36_500).optional(),
  /** Explicit completed-turn boundary; overrides keepLastTurns/keepDays. */
  throughTurnId: z.string().trim().min(1).optional(),
  archiveBeforePrune: z.boolean().default(true)
}).refine(
  (policy) =>
    policy.keepLastTurns !== undefined ||
    policy.keepDays !== undefined ||
    policy.throughTurnId !== undefined,
  { message: 'keepLastTurns, keepDays, or throughTurnId is required' }
)

export type ThreadRetentionPolicy = z.infer<typeof ThreadRetentionPolicySchema>
