import { createHash } from 'node:crypto'
import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { z } from 'zod'
import { ExecutionTaskSchema, ExecutionTaskStateSchema, type ExecutionTask,
  type ExecutionTaskState } from '../contracts/execution-tasks.js'
import type { ThreadRecord, ThreadTodoList } from '../contracts/threads.js'
import { TaskGraph, type TaskState } from './task-graph.js'

export function taskPlanStructureHash(contentHashes: readonly string[]): string {
  return createHash('sha256').update(JSON.stringify(contentHashes)).digest('hex')
}

const LegacyGraph = z.object({ tasks: z.record(z.string(), z.object({
  id: z.string().min(1), title: z.string().min(1),
  state: z.enum(['pending', 'ready', 'running', 'blocked', 'paused', 'succeeded', 'failed', 'cancelled']),
  dependsOn: z.array(z.string()), priority: z.number(), lastError: z.string().optional(),
  attempts: z.number().int().nonnegative().optional(), maxAttempts: z.number().int().positive().optional(),
  nextAttemptAt: z.number().finite().optional(), tokenBudget: z.number().positive().optional(), worktree: z.string().max(4096).optional()
})), concurrency: z.number().positive() })

/** Read-only import. Neither old files nor historical thread.todos are rewritten. */
export async function importExecutionTasks(thread: ThreadRecord, now: string, legacyRoot?: string): Promise<ExecutionTaskState> {
  const tasks: ExecutionTask[] = (thread.todos?.items ?? []).map((todo) => ExecutionTaskSchema.parse({
    id: todo.id, title: todo.content,
    status: todo.status === 'completed' ? 'succeeded' : todo.status === 'in_progress' ? 'paused' : 'pending',
    revision: 0, ownerThreadId: thread.id, legacy: { kind: 'todo', id: todo.id },
    ...(todo.source ? { planSource: { ...todo.source, content: todo.content } } : {}),
    ...(todo.status === 'in_progress' ? { reason: 'Legacy execution requires explicit recovery.' } : {}),
    createdAt: todo.createdAt, updatedAt: now
  }))
  if (legacyRoot) {
    let text: string | undefined
    try { text = await readFile(join(legacyRoot, `${createHash('sha256').update(thread.id).digest('hex')}.json`), 'utf8') }
    catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error }
    if (text !== undefined) {
      const graph = LegacyGraph.parse(JSON.parse(text))
      const ids = new Map(Object.values(graph.tasks).map((task) => [task.id,
        `graph_${createHash('sha256').update(task.id).digest('hex').slice(0, 24)}`]))
      for (const task of Object.values(graph.tasks)) {
        const retryRequiresRecovery = !['succeeded', 'failed', 'cancelled'].includes(task.state) &&
          ((task.attempts ?? 0) > 0 || task.nextAttemptAt !== undefined)
        tasks.push(ExecutionTaskSchema.parse({
        id: ids.get(task.id), title: task.title, revision: 0, ownerThreadId: thread.id,
        status: task.state === 'running' || retryRequiresRecovery ? 'paused' : task.state === 'ready' ? 'pending' : task.state,
        dependsOn: task.dependsOn.map((id) => ids.get(id) ?? `missing_${createHash('sha256').update(id).digest('hex').slice(0, 24)}`),
        priority: Math.max(-1000, Math.min(1000, Math.trunc(task.priority))),
        reason: task.state === 'running' ? 'Legacy execution requires explicit recovery.'
          : retryRequiresRecovery ? 'Historical retry requires explicit recovery; no retry was scheduled.' : task.lastError,
        legacyGraphPolicy: { attempts: task.attempts, maxAttempts: task.maxAttempts, nextAttemptAt: task.nextAttemptAt,
          tokenBudget: task.tokenBudget, worktree: task.worktree, lastError: task.lastError, graphConcurrency: graph.concurrency },
        legacy: { kind: 'task_graph', id: task.id }, createdAt: now, updatedAt: now
      }))
      }
    }
  }
  if (new Set(tasks.map((task) => task.id)).size !== tasks.length) throw new Error('legacy task id collision; migration requires review')
  const state = ExecutionTaskStateSchema.parse({ schemaVersion: 1, revision: 0, tasks, requests: {}, importedAt: now, updatedAt: now })
  taskGraph(state).detectCycle() && (() => { throw new Error('legacy dependency cycle; migration requires review') })()
  return state
}

export function taskGraph(state: ExecutionTaskState): TaskGraph {
  return TaskGraph.fromJSON({ concurrency: Math.max(1, new Set(state.tasks.map((task) => task.ownerThreadId)).size),
    tasks: Object.fromEntries(state.tasks.map((task) => [task.id, {
      id: task.id, title: task.title, dependsOn: task.dependsOn, priority: task.priority,
      state: (task.status === 'waiting' ? 'paused' : task.status) as TaskState, attempts: 0, maxAttempts: 1
    }])) })
}

export function runnableTasks(state: ExecutionTaskState): string[] {
  const graph = taskGraph(state)
  graph.reconcile()
  const busyOwners = new Set(state.tasks.filter((task) => task.status === 'running').map((task) => task.ownerThreadId))
  return state.tasks.filter((task) => !task.sourceStale && task.status === 'pending' && !busyOwners.has(task.ownerThreadId) &&
    graph.get(task.id)?.state === 'ready').sort((a, b) => b.priority - a.priority || a.id.localeCompare(b.id)).map((task) => task.id)
}

/** Compatibility presentation, never a second mutable task store. */
export function executionTasksAsTodos(threadId: string, state: ExecutionTaskState): ThreadTodoList {
  return { threadId, revision: state.revision, updatedAt: state.updatedAt, items: state.tasks.map((task) => {
    return { id: task.id, content: task.title, status: task.status === 'succeeded' ? 'completed' : task.status === 'running' ? 'in_progress' : 'pending',
      taskStatus: task.sourceStale && task.status === 'pending' ? 'blocked' : task.status, taskRevision: task.revision, ownerThreadId: task.ownerThreadId,
      ...(task.reason ? { reason: task.reason } : {}), ...(task.planSource ? { source: task.planSource } : {}),
      createdAt: task.createdAt, updatedAt: task.updatedAt }
  }) }
}

export function cloneExecutionTaskState(state: ExecutionTaskState, threadId: string, now: string): ExecutionTaskState {
  return { ...state, revision: 0, requests: {}, updatedAt: now, tasks: state.tasks.map((task) => ({
    ...task, revision: 0, ownerThreadId: threadId, execution: undefined,
    ...(task.status === 'running' ? { status: 'paused' as const, reason: 'Forked task requires explicit recovery.' } : {})
  })) }
}
