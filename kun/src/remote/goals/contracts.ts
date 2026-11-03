import { z } from 'zod'
const Id = z.string().regex(/^[a-zA-Z0-9_-]{1,128}$/)
const Thread = { threadId: Id }
const Goal = { ...Thread, expectedRevision: z.string().regex(/^goal-v1:[a-f0-9]{64}$/) }
export const GoalParamSchemas = {
  'goal.get': z.object(Thread).strict(),
  'goal.update': z.object({ ...Goal, objective: z.string().min(1).max(4000).optional(),
    status: z.enum(['active', 'paused', 'complete']).optional(),
    tokenBudget: z.number().int().positive().nullable().optional() }).strict().refine((p) =>
      p.objective !== undefined || p.status !== undefined || p.tokenBudget !== undefined),
  'goal.clear': z.object(Goal).strict()
} as const
