import { z } from 'zod'
import { GraphPlanningDraftStatusSchema } from './graph-planning.js'
/**
 * Durable ownership state for a Graph source Lead. The turn remains logically
 * running while its process-local execution lease is suspended between
 * material Graph events.
 */
export const GraphLeadLifecycleSchema = z.object({
  version: z.literal(1),
  runId: z.string().min(1),
  state: z.enum(['supervising', 'awaiting_user', 'finalizing']),
  lastDeliveredSeq: z.number().int().nonnegative().default(0),
  suspendedAt: z.string().optional(),
  resumedAt: z.string().optional()
}).strict()
export type GraphLeadLifecycle = z.infer<typeof GraphLeadLifecycleSchema>

export const GraphPlanningLifecycleSchema = z.object({
  version: z.literal(1),
  draftId: z.string().min(1),
  reservedRunId: z.string().min(1),
  state: GraphPlanningDraftStatusSchema,
  draftRevision: z.number().int().positive(),
  /** Process shutdown parked execution without changing the durable draft state. */
  suspendedAt: z.string().optional()
}).strict()
export type GraphPlanningLifecycle = z.infer<typeof GraphPlanningLifecycleSchema>

