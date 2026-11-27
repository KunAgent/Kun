import { createHash } from 'node:crypto'
import { realpath } from 'node:fs/promises'
import type { RemoteTodoItem, RemoteTodoProgress, ThreadTodoSnapshot } from '@kun/remote-protocol'
import type { ThreadRecord } from '../../contracts/threads.js'
import { policyHash } from '../../domain/remote-policy-revision.js'
import { isTerminalRunStatus } from '../../graph/graph-run-store-support.js'
import type { ServerRuntime } from '../../server/routes/server-runtime.js'
import { executionTasksAsTodos } from '../../tasks/execution-task-state.js'
import { requireCode } from '../code/access.js'

export function threadTodoProgress(thread: Pick<ThreadRecord, 'id' | 'executionTasks' | 'todos'>): RemoteTodoProgress | undefined {
  const list = thread.executionTasks
    ? executionTasksAsTodos(thread.id, thread.executionTasks)
    : thread.todos
  if (!list || list.items.length === 0) return undefined
  const active = list.items.filter((item) => item.taskStatus !== 'cancelled')
  const scoped = active.length > 0 ? active : list.items
  const completed = scoped.filter((item) => item.status === 'completed').length
  const blocked = list.items.filter((item) => item.taskStatus === 'blocked' || item.taskStatus === 'failed').length
  const inProgress = list.items.find((item) => item.status === 'in_progress')
  return {
    completed,
    total: scoped.length,
    ...(blocked > 0 ? { blocked } : {}),
    ...(inProgress ? { inProgressText: inProgress.content.slice(0, 160) } : {})
  }
}

export async function threadTodoSnapshot(runtime: ServerRuntime, thread: ThreadRecord): Promise<ThreadTodoSnapshot> {
  const list = thread.executionTasks
    ? executionTasksAsTodos(thread.id, thread.executionTasks)
    : thread.todos
  const tasksById = new Map((thread.executionTasks?.tasks ?? []).map((task) => [task.id, task]))
  const ownerIds = [...new Set(
    (list?.items ?? [])
      .map((item) => item.ownerThreadId)
      .filter((ownerId): ownerId is string => Boolean(ownerId && ownerId !== thread.id))
  )]
  const ownerLabels = new Map<string, string>()
  await Promise.all(ownerIds.map(async (ownerId) => {
    const meta = await runtime.threadService.getMetadata(ownerId).catch(() => null)
    if (meta?.title?.trim()) ownerLabels.set(ownerId, meta.title.trim().slice(0, 80))
  }))

  const planPaths = new Set<string>()
  const items: RemoteTodoItem[] = (list?.items ?? []).map((item) => {
    const task = tasksById.get(item.id)
    if (item.source?.kind === 'plan') planPaths.add(item.source.relativePath)
    return {
      id: item.id,
      content: item.content,
      status: item.status,
      ...(item.taskStatus ? { taskStatus: item.taskStatus } : {}),
      ...(item.taskRevision !== undefined ? { taskRevision: item.taskRevision } : {}),
      ...(item.ownerThreadId ? { ownerThreadId: item.ownerThreadId } : {}),
      ...(item.ownerThreadId && ownerLabels.has(item.ownerThreadId)
        ? { ownerLabel: ownerLabels.get(item.ownerThreadId) }
        : {}),
      ...(task && task.dependsOn.length > 0 ? { dependsOn: [...task.dependsOn] } : {}),
      ...(task?.acceptance ? { acceptance: task.acceptance } : {}),
      ...(item.reason ? { reason: item.reason } : {}),
      ...(task && task.evidence.length > 0
        ? { evidence: task.evidence.map((entry) => ({ summary: entry.summary, ...(entry.reference ? { reference: entry.reference } : {}) })) }
        : {}),
      ...(item.source?.kind === 'plan'
        ? {
            source: {
              kind: 'plan' as const,
              planId: item.source.planId,
              relativePath: item.source.relativePath,
              ordinal: item.source.ordinal
            }
          }
        : {}),
      createdAt: item.createdAt,
      updatedAt: item.updatedAt
    }
  })

  const runs = runtime.graph
    ? await runtime.graph.store.list({ threadId: thread.id }).catch(() => [])
    : []
  const outlineOnly = runs.some((run) => !isTerminalRunStatus(run.status))
  const planPath = planPaths.size === 1 ? [...planPaths][0] : undefined
  let projectId: string | undefined
  try {
    projectId = createHash('sha256').update(await realpath(thread.workspace)).digest('hex')
  } catch { /* workspace no longer resolves */ }

  return {
    threadId: thread.id,
    revision: policyHash('todo-v1', [
      thread.executionTasks?.revision ?? thread.todos?.revision ?? null,
      outlineOnly,
      planPath ?? null,
      items
    ]),
    outlineOnly,
    ...(planPath ? { planPath } : {}),
    ...(projectId ? { projectId } : {}),
    items,
    ...(list?.updatedAt ? { updatedAt: list.updatedAt } : {})
  }
}

export class RemoteTodos {
  constructor(private runtime: ServerRuntime) {}

  async get(threadId: string): Promise<ThreadTodoSnapshot> {
    const thread = await requireCode(this.runtime, threadId)
    return threadTodoSnapshot(this.runtime, thread)
  }
}
