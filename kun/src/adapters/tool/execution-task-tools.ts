import { z } from 'zod'
import { CreateExecutionTaskSchema, UpdateExecutionTaskSchema, ListExecutionTasksSchema } from '../../contracts/execution-tasks.js'
import { ExecutionTaskError, type ExecutionTaskService } from '../../services/execution-task-service.js'
import { LocalToolHost, type LocalTool } from './local-tool-host.js'

export const EXECUTION_TASK_TOOL_NAMES = ['task_create', 'task_update', 'task_get', 'task_list'] as const
const scope = z.string().trim().min(1).max(256).optional()
const id = z.string().trim().min(1).max(256)
const definitions = [
  { name: 'task_create', schema: CreateExecutionTaskSchema.extend({ scopeThreadId: scope }),
    description: 'Create one durable execution task. Use a stable clientRequestId to retry safely. Dependencies must already exist. This records a plan step; it does not start an agent, job, goal or background schedule.' },
  { name: 'task_update', schema: UpdateExecutionTaskSchema.extend({ id, scopeThreadId: scope }),
    description: 'Atomically update one execution task using its expectedRevision from task_get/task_list. Reuse clientRequestId only for identical retries. Only an active owning turn can mark running. Success requires acceptance evidence; waiting, blocked, paused and failed require a reason. Cancelling this planning record never cancels a RoomTask, job or process; use their execution controls first.' },
  { name: 'task_get', schema: z.object({ id, scopeThreadId: scope }).strict(),
    description: 'Read one canonical execution task and revision. A delegated worker may use scopeThreadId for its parent thread and inspect only its assigned tasks.' },
  { name: 'task_list', schema: ListExecutionTasksSchema.extend({ scopeThreadId: scope }),
    description: 'List canonical execution tasks with filtering and revision-bound pagination. runnable selects dependency-ready work without starting it. Inspect this after resume; interrupted legacy tasks require explicit recovery. Goals and cross-conversation commitments remain separate.' }
] as const

export function buildExecutionTaskLocalTools(service: ExecutionTaskService): LocalTool[] {
  return definitions.map((definition) => {
    const inputSchema = z.toJSONSchema(definition.schema, { io: 'input', target: 'draft-07', reused: 'inline' }) as Record<string, unknown>
    delete inputSchema.$schema
    return LocalToolHost.defineTool({ name: definition.name, description: definition.description, inputSchema,
      policy: 'auto', toolKind: 'tool_call',
      ...(['task_get', 'task_list'].includes(definition.name) ? { sideEffect: 'read-only' as const } : {}),
      execute: async (raw, context) => {
        try {
          const parsed = definition.schema.parse(raw) as Record<string, unknown>
          const { scopeThreadId, id: taskId, ...args } = parsed
          const threadId = typeof scopeThreadId === 'string' ? scopeThreadId : context.threadId
          const actor = { threadId: context.threadId, turnId: context.turnId }
          const output = definition.name === 'task_create' ? await service.create(threadId, args, actor)
            : definition.name === 'task_update' ? await service.update(threadId, taskId as string, args, actor)
              : definition.name === 'task_get' ? await service.get(threadId, taskId as string, actor)
                : await service.list(threadId, args, actor)
          return { output }
        } catch (error) {
          return { isError: true, output: { code: error instanceof ExecutionTaskError ? error.code : 'invalid_task_request',
            error: error instanceof Error ? error.message : String(error) } }
        }
      }
    })
  })
}
