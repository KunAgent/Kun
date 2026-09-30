import { z } from 'zod'

const modelRouteSchema = z.object({
  providerId: z.string().trim().min(1).max(128),
  model: z.string().trim().min(1).max(512)
}).strict()

export const adeCollaborationMutationSchema = z.object({
  expectedRevision: z.string().regex(/^ade-collaboration-v1:[a-f0-9]{64}$/),
  value: z.object({
    enabled: z.boolean(),
    managerModel: modelRouteSchema.optional(),
    managerMayApprove: z.boolean(),
    allowUnattendedFullAccess: z.boolean(),
    limits: z.object({
      softWorkers: z.number().int().min(1).max(16),
      hardWorkers: z.number().int().min(1).max(32)
    }).strict(),
    budget: z.object({
      softTokens: z.number().int().positive().max(Number.MAX_SAFE_INTEGER).optional(),
      hardTokens: z.number().int().positive().max(Number.MAX_SAFE_INTEGER).optional()
    }).strict().optional(),
    hibernation: z.object({
      enabled: z.boolean(),
      idleMinutes: z.number().int().min(1).max(1_440)
    }).strict(),
    stall: z.object({
      structuredMinutes: z.number().int().min(1).max(240),
      terminalMinutes: z.number().int().min(1).max(480)
    }).strict()
  }).strict().superRefine((value, context) => {
    if (value.limits.softWorkers > value.limits.hardWorkers) {
      context.addIssue({ code: 'custom', path: ['limits'], message: 'Suggested workers exceed the active limit.' })
    }
    if (value.budget?.softTokens !== undefined && value.budget.hardTokens !== undefined &&
      value.budget.softTokens > value.budget.hardTokens) {
      context.addIssue({ code: 'custom', path: ['budget'], message: 'Soft budget exceeds the hard budget.' })
    }
  })
}).strict()
