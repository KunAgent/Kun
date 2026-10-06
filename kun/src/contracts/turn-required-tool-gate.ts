import { z } from 'zod'

/**
 * Durable state for a hard named-tool gate. It is deliberately optional so
 * legacy turns remain valid, while an interrupted Graph creation turn cannot
 * restart its bounded retry window after a runtime restart.
 */
export const RequiredToolGateSchema = z.object({
  toolName: z.string().min(1).max(256),
  attempt: z.number().int().positive(),
  maxAttempts: z.number().int().positive(),
  phase: z.enum(['preparing', 'retrying', 'succeeded', 'failed']),
  lastError: z.string().min(1).max(2_048).optional()
}).strict()
export type RequiredToolGate = z.infer<typeof RequiredToolGateSchema>
