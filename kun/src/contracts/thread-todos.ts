import { z } from 'zod'
import { ExecutionTaskStatusSchema, MAX_EXECUTION_TASKS } from './execution-tasks.js'

export const ThreadTodoStatus = z.enum(['pending', 'in_progress', 'completed'])
export type ThreadTodoStatus = z.infer<typeof ThreadTodoStatus>

export const ThreadTodoSourceSchema = z.object({
  kind: z.literal('plan'),
  planId: z.string().min(1),
  relativePath: z.string().min(1),
  ordinal: z.number().int().nonnegative(),
  contentHash: z.string().min(1),
  documentHash: z.string().min(1).optional(),
  content: z.string().max(1000).optional()
})
export type ThreadTodoSource = z.infer<typeof ThreadTodoSourceSchema>

export const MAX_THREAD_TODO_CONTENT_CHARS = 1_000
export const MAX_THREAD_TODOS = 200

export const ThreadTodoItemSchema = z.object({
  id: z.string().min(1),
  content: z.string().trim().min(1).max(MAX_THREAD_TODO_CONTENT_CHARS),
  status: ThreadTodoStatus,
  source: ThreadTodoSourceSchema.optional(),
  taskStatus: ExecutionTaskStatusSchema.optional(),
  taskRevision: z.number().int().nonnegative().optional(),
  ownerThreadId: z.string().optional(),
  reason: z.string().optional(),
  createdAt: z.string(),
  updatedAt: z.string()
})
export type ThreadTodoItem = z.infer<typeof ThreadTodoItemSchema>

export const ThreadTodoListSchema = z.object({
  threadId: z.string().min(1),
  revision: z.number().int().nonnegative().optional(),
  items: z.array(ThreadTodoItemSchema).max(MAX_EXECUTION_TASKS),
  updatedAt: z.string()
}).superRefine((value, ctx) => {
  if (value.revision === undefined && value.items.length > MAX_THREAD_TODOS) {
    ctx.addIssue({ code: 'custom', path: ['items'], message: 'legacy todo lists contain at most 200 items' })
  }
  const inProgressCount = value.items.filter((item) => item.status === 'in_progress').length
  if (value.revision === undefined && inProgressCount > 1) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['items'],
      message: 'at most one todo can be in_progress'
    })
  }
})
export type ThreadTodoList = z.infer<typeof ThreadTodoListSchema>
