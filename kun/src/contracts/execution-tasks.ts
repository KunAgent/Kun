import { z } from 'zod'

const Id = z.string().trim().min(1).max(256)
export const MAX_EXECUTION_TASKS = 2000
export const ExecutionTaskStatusSchema = z.enum([
  'pending', 'running', 'waiting', 'blocked', 'paused', 'succeeded', 'failed', 'cancelled'
])
export const ExecutionTaskPlanSourceSchema = z.object({
  kind: z.literal('plan'), planId: Id, relativePath: z.string().min(1),
  ordinal: z.number().int().nonnegative(), contentHash: z.string().min(1),
  documentHash: z.string().min(1).optional(),
  content: z.string().max(1000).optional()
})
export const ExecutionTaskEvidenceSchema = z.object({
  summary: z.string().trim().min(1).max(2000), reference: z.string().min(1).max(4096).optional()
}).strict()
export const ExecutionTaskSchema = z.object({
  id: Id, title: z.string().trim().min(1).max(1000),
  status: ExecutionTaskStatusSchema, revision: z.number().int().nonnegative(),
  ownerThreadId: Id, dependsOn: z.array(Id).max(200).default([]),
  priority: z.number().int().min(-1000).max(1000).default(0),
  acceptance: z.string().trim().max(4000).default(''),
  reason: z.string().trim().max(2000).optional(),
  evidence: z.array(ExecutionTaskEvidenceSchema).max(20).default([]),
  execution: z.object({ threadId: Id, turnId: Id }).strict().optional(),
  planSource: ExecutionTaskPlanSourceSchema.optional(),
  sourceStale: z.boolean().optional(),
  legacy: z.object({ kind: z.enum(['todo', 'task_graph']), id: Id }).strict().optional(),
  legacyGraphPolicy: z.object({
    attempts: z.number().int().nonnegative().optional(), maxAttempts: z.number().int().positive().optional(),
    nextAttemptAt: z.number().finite().optional(), tokenBudget: z.number().positive().optional(),
    worktree: z.string().max(4096).optional(), lastError: z.string().max(8000).optional(), graphConcurrency: z.number().positive()
  }).strict().optional(),
  createdAt: z.string(), updatedAt: z.string()
}).strict()
export type ExecutionTask = z.infer<typeof ExecutionTaskSchema>
export type ExecutionTaskStatus = z.infer<typeof ExecutionTaskStatusSchema>

/** Canonical metadata, persisted by the existing manager-owned ThreadStore. */
export const ExecutionTaskStateSchema = z.object({
  schemaVersion: z.literal(1), revision: z.number().int().nonnegative(),
  tasks: z.array(ExecutionTaskSchema).max(MAX_EXECUTION_TASKS),
  requests: z.record(z.string(), z.object({
    fingerprint: z.string(), taskId: Id, revision: z.number().int().nonnegative()
  }).strict()).default({}),
  importedAt: z.string(), updatedAt: z.string()
}).strict()
export type ExecutionTaskState = z.infer<typeof ExecutionTaskStateSchema>

export const CreateExecutionTaskSchema = z.object({
  clientRequestId: Id,
  title: ExecutionTaskSchema.shape.title,
  acceptance: ExecutionTaskSchema.shape.acceptance.optional(),
  dependsOn: ExecutionTaskSchema.shape.dependsOn.optional(),
  priority: ExecutionTaskSchema.shape.priority.optional(),
  ownerThreadId: Id.optional()
}).strict()
export const UpdateExecutionTaskSchema = z.object({
  clientRequestId: Id, expectedRevision: z.number().int().nonnegative(),
  title: ExecutionTaskSchema.shape.title.optional(),
  acceptance: ExecutionTaskSchema.shape.acceptance.unwrap().optional(),
  dependsOn: ExecutionTaskSchema.shape.dependsOn.unwrap().optional(),
  priority: ExecutionTaskSchema.shape.priority.unwrap().optional(),
  ownerThreadId: Id.optional(), status: ExecutionTaskStatusSchema.optional(),
  reason: ExecutionTaskSchema.shape.reason, evidence: ExecutionTaskSchema.shape.evidence.unwrap().optional()
}).strict()
export const ListExecutionTasksSchema = z.object({
  status: ExecutionTaskStatusSchema.optional(), runnable: z.boolean().optional(),
  cursor: z.string().optional(), limit: z.number().int().min(1).max(100).default(30)
}).strict()
export type CreateExecutionTask = z.infer<typeof CreateExecutionTaskSchema>
export type UpdateExecutionTask = z.infer<typeof UpdateExecutionTaskSchema>
