import { z } from 'zod'

export const kunColabPatchSchema = z.object({
  requireApprovalForAgent: z.boolean().optional(),
  idleAutoStopEnabled: z.boolean().optional(),
  idleAutoStopMinutes: z.number().int().min(1).max(240).optional(),
  lowBalanceReminderEnabled: z.boolean().optional(),
  lowBalanceThresholdCu: z.number().min(1).max(1000).optional(),
  stopSessionsOnQuit: z.boolean().optional()
}).strict()
