import { HarnessGatewayBindingSchema } from './harness-gateway-binding.js'
import { z } from 'zod'
import { HarnessCredentialModeSchema, HarnessIdSchema } from './harness.js'

export const ThreadExecutionRouteSchema = z.object({
  model: z.string().min(1).max(512),
  providerId: z.string().min(1).max(128).optional(),
  harnessId: HarnessIdSchema.optional(),
  credentialMode: HarnessCredentialModeSchema.optional(),
  gatewayBinding: HarnessGatewayBindingSchema.optional()
}).strict()
export type ThreadExecutionRoute = z.infer<typeof ThreadExecutionRouteSchema>

const Origin = z.enum(['global', 'project', 'task'])
export const ThreadExecutionConfigSchema = z.object({
  version: z.literal(1),
  revision: z.string().regex(/^[a-f0-9]{64}$/),
  projectKey: z.string().min(1).max(4_096).optional(),
  route: ThreadExecutionRouteSchema,
  collaborationEnabled: z.boolean(),
  managerModel: z.object({
    providerId: z.string().min(1).max(128), model: z.string().min(1).max(512)
  }).strict().optional(),
  limits: z.object({
    softWorkers: z.number().int().min(1).max(16),
    hardWorkers: z.number().int().min(1).max(32)
  }).strict(),
  budget: z.object({
    softTokens: z.number().int().positive().optional(),
    hardTokens: z.number().int().positive().optional()
  }).strict().optional(),
  isolation: z.enum(['worktree', 'local', 'directory']),
  origins: z.object({
    route: Origin,
    collaborationEnabled: Origin,
    managerModel: Origin,
    limits: Origin,
    budget: Origin,
    isolation: Origin
  }).strict(),
  resolvedAt: z.string().datetime()
}).strict()
export type ThreadExecutionConfig = z.infer<typeof ThreadExecutionConfigSchema>

export const TaskExecutionConfigFieldSchema = z.enum([
  'route', 'collaborationEnabled', 'managerModel', 'limits', 'budget'
])
export const TaskExecutionConfigSetSchema = ThreadExecutionConfigSchema.pick({
  route: true, collaborationEnabled: true, managerModel: true,
  limits: true, budget: true
}).partial().strict()
export const TaskExecutionConfigMutationSchema = z.object({
  expectedRevision: z.string().regex(/^task-config-v1:[a-f0-9]{64}$/),
  set: TaskExecutionConfigSetSchema.optional(),
  unset: z.array(TaskExecutionConfigFieldSchema).max(5).optional()
}).strict().superRefine((value, ctx) => {
  const set = new Set(Object.keys(value.set ?? {}))
  const unset = value.unset ?? []
  if (!set.size && !unset.length) {
    ctx.addIssue({ code: 'custom', path: ['set'], message: 'set or unset is required' })
  }
  if (new Set(unset).size !== unset.length || unset.some((key) => set.has(key))) {
    ctx.addIssue({ code: 'custom', path: ['unset'], message: 'fields may be changed only once' })
  }
})
export type TaskExecutionConfigMutation = z.infer<typeof TaskExecutionConfigMutationSchema>

const Editable = z.object({ allowed: z.boolean(), reason: z.string().max(128).optional() }).strict()
export const TaskExecutionConfigResponseSchema = z.object({
  current: ThreadExecutionConfigSchema,
  pending: ThreadExecutionConfigSchema.optional(),
  inherited: ThreadExecutionConfigSchema,
  revision: z.string().regex(/^task-config-v1:[a-f0-9]{64}$/),
  editable: z.object({
    route: Editable,
    collaborationEnabled: Editable,
    managerModel: Editable,
    limits: Editable,
    budget: Editable,
    isolation: Editable
  }).strict()
}).strict()
export type TaskExecutionConfigResponse = z.infer<typeof TaskExecutionConfigResponseSchema>
