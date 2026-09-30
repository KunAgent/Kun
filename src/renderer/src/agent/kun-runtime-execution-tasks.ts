import { kunThreadTaskPath } from '@shared/kun-endpoints'
import { runtimeErrorToError } from '@shared/runtime-error'
import type { AgentProvider } from './provider-types'
import type { ThreadTodoList } from './types'
import { rendererRuntimeClient } from './runtime-client'
import { readRuntimeError } from './kun-runtime-services'

export async function updateExecutionTask(threadId: string, taskId: string,
  patch: Parameters<NonNullable<AgentProvider['updateThreadExecutionTask']>>[2],
  getTodos: (threadId: string) => Promise<ThreadTodoList | null>
): Promise<ThreadTodoList> {
    const response = await rendererRuntimeClient.runtimeRequest(kunThreadTaskPath(threadId, taskId), 'PATCH', JSON.stringify({
      ...patch, status: patch.status === 'completed' ? 'succeeded' : patch.status === 'in_progress' ? 'running' : 'pending',
      ...(patch.status === 'completed' ? { evidence: [{ summary: 'Marked complete by the user in the task controls.' }] } : {})
    }))
    if (!response.ok) throw runtimeErrorToError(readRuntimeError(response.body, 'failed to update execution task'))
    const todos = await getTodos(threadId)
    if (!todos) throw runtimeErrorToError({ code: 'unknown', message: 'execution task projection is unavailable' })
    return todos
}
