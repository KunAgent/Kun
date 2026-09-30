import { createHash } from 'node:crypto'
import { isDeepStrictEqual } from 'node:util'
import { CreateExecutionTaskSchema, UpdateExecutionTaskSchema, ListExecutionTasksSchema,
  ExecutionTaskSchema, MAX_EXECUTION_TASKS, type ExecutionTask, type ExecutionTaskState } from '../contracts/execution-tasks.js'
import type { ThreadRecord, ThreadTodoItem, ThreadTodoList, ThreadTodoStatus } from '../contracts/threads.js'
import type { ThreadStore } from '../ports/thread-store.js'
import type { RuntimeEventRecorder } from './runtime-event-recorder.js'
import { withThreadStoreMutation } from './thread-mutation-coordinator.js'
import { executionTasksAsTodos, importExecutionTasks, runnableTasks, taskGraph, taskPlanStructureHash } from '../tasks/execution-task-state.js'

export class ExecutionTaskError extends Error {
  constructor(readonly code: string, message: string) { super(message) }
}
export type ExecutionTaskActor = { threadId: string; turnId?: string }
type Options = {
  threadStore: ThreadStore; events: RuntimeEventRecorder; nowIso: () => string; legacyRoot?: string
  projectPlan?: (thread: ThreadRecord, todos: ThreadTodoList) => Promise<void>
}
function fail(code: string, message: string): never { throw new ExecutionTaskError(code, message) }
const hash = (value: unknown): string => createHash('sha256').update(JSON.stringify(value)).digest('hex')
const terminal = (task: ExecutionTask): boolean => ['succeeded', 'failed', 'cancelled'].includes(task.status)

/** One canonical task aggregate. All writes use the manager-owned ThreadStore CAS. */
export class ExecutionTaskService {
  constructor(private readonly options: Options) {}

  /** Host lifecycle reconciliation only; never schedules or resumes an executor. */
  async reconcileAfterTurn(threadId: string): Promise<void> {
    // Explicit Stop notifies while its terminal write still owns this queue.
    // Wait for that commit even when only the parent holds this child's tasks.
    // Release the child barrier before taking the parent mutation queue.
    const thread = await withThreadStoreMutation(this.options.threadStore, threadId,
      () => this.options.threadStore.get(threadId))
    if (!thread || thread.status === 'deleted') return
    if (thread.executionTasks?.tasks.some((task) => task.status === 'running')) await this.list(threadId)
    if (!thread.parentThreadId) return
    const parent = await this.options.threadStore.get(thread.parentThreadId)
    if (parent && parent.status !== 'deleted' && parent.executionTasks?.tasks.some((task) =>
      task.ownerThreadId === threadId && task.status === 'running')) await this.list(parent.id)
  }

  private async mutate<T>(threadId: string, actor: ExecutionTaskActor,
    operation: (state: ExecutionTaskState, thread: ThreadRecord) => Promise<T> | T, project = false): Promise<T> {
    return withThreadStoreMutation(this.options.threadStore, threadId, async () => {
      for (let attempt = 0; attempt < 5; attempt++) {
        const thread = await this.options.threadStore.get(threadId)
        if (!thread || thread.status === 'deleted') fail('not_found', 'Task thread not found.')
        const actingThread = actor.threadId === threadId ? thread : await this.options.threadStore.get(actor.threadId)
        if (!actingThread || actingThread.status === 'deleted' || (actor.threadId !== threadId &&
          (actingThread.parentThreadId !== threadId || actingThread.workspace !== thread.workspace))) {
          fail('forbidden', 'Task scope must be the acting thread or its same-workspace parent.')
        }
        if (actor.turnId && !actingThread.turns.some((turn) => turn.id === actor.turnId && turn.status === 'running')) {
          fail('stale_execution', 'The acting turn is no longer running.')
        }
        const state = structuredClone(thread.executionTasks ?? await importExecutionTasks(thread, this.options.nowIso(), this.options.legacyRoot))
        const before = structuredClone(state)
        for (const task of state.tasks) {
          if (task.status !== 'running') continue
          const owner = task.ownerThreadId === threadId ? thread : await this.options.threadStore.get(task.ownerThreadId)
          if (!task.execution || !owner?.turns.some((turn) => turn.id === task.execution?.turnId && turn.status === 'running')) {
            task.status = 'paused'; task.reason = 'Execution ended; explicit recovery is required.'
            task.revision++; task.updatedAt = this.options.nowIso(); delete task.execution
          }
        }
        const result = await operation(state, thread)
        const changed = !isDeepStrictEqual(before, state)
        if (changed) { state.revision++; state.updatedAt = this.options.nowIso() }
        if (changed || !thread.executionTasks) {
          const next = { ...thread, executionTasks: state, updatedAt: state.updatedAt }
          if (this.options.threadStore.upsertIfRevision) {
            const write = await this.options.threadStore.upsertIfRevision(next, thread.revision ?? 0)
            if (!write.applied) continue
          } else await this.options.threadStore.upsert(next)
        }
        // Re-publish an authoritative snapshot on retries too: a crash between
        // the state commit and event persistence cannot strand the UI forever.
        const todos = executionTasksAsTodos(threadId, state)
        if (changed || !thread.executionTasks || project) await this.options.events.record({ kind: 'todos_updated', threadId, todos })
        // A projection failure never rolls back an accepted task mutation.
        // Retrying the same idempotent request repairs the plan projection.
        const projectedTasks = result && typeof result === 'object'
          ? 'task' in result ? [result.task as ExecutionTask] : 'tasks' in result ? result.tasks as ExecutionTask[] : [] : []
        const projectedIds = new Set(projectedTasks.filter((task) => task.planSource && !task.sourceStale).map((task) => task.id))
        if (project && projectedIds.size) await this.options.projectPlan?.(thread,
          { ...todos, items: todos.items.filter((item) => projectedIds.has(item.id)) })
        return result
      }
      return fail('conflict', 'Thread changed concurrently; read the task and retry.')
    })
  }

  async list(threadId: string, raw: unknown = {}, actor: ExecutionTaskActor = { threadId }) {
    const query = ListExecutionTasksSchema.parse(raw)
    const state = await this.mutate(threadId, actor, (state) => state)
      const runnable = runnableTasks(state)
      let offset = 0
      if (query.cursor) {
        const match = /^(\d+):(\d+)$/.exec(query.cursor)
        if (!match || Number(match[1]) !== state.revision) fail('conflict', 'Task list changed; restart pagination.')
        offset = Number(match[2])
      }
      const tasks = state.tasks.filter((task) => (actor.threadId === threadId || task.ownerThreadId === actor.threadId) &&
        (!query.status || task.status === query.status) &&
        (!query.runnable || runnable.includes(task.id)))
      const page = tasks.slice(offset, offset + query.limit)
      return { tasks: page, revision: state.revision,
        runnable: runnable.filter((id) => page.some((task) => task.id === id)),
        ...(tasks.length > offset + query.limit ? { nextCursor: `${state.revision}:${offset + query.limit}` } : {}) }
  }

  async get(threadId: string, id: string, actor: ExecutionTaskActor = { threadId }) {
    return this.mutate(threadId, actor, (state) => {
      const task = this.require(state, id)
      if (actor.threadId !== threadId && task.ownerThreadId !== actor.threadId) fail('forbidden', 'This task belongs to another owner.')
      return task
    })
  }

  async create(threadId: string, raw: unknown, actor: ExecutionTaskActor = { threadId }) {
    const input = CreateExecutionTaskSchema.parse(raw)
    if (actor.threadId !== threadId) fail('forbidden', 'Only the parent can create shared tasks.')
    return this.mutate(threadId, actor, async (state, thread) => {
      const key = `create:${input.clientRequestId}`, fingerprint = hash(input)
      const replay = this.replay(state, key, fingerprint)
      if (replay) return { task: replay, replayed: true }
      if (state.tasks.length >= MAX_EXECUTION_TASKS) fail('limit', `This thread already has ${MAX_EXECUTION_TASKS} execution tasks.`)
      const now = this.options.nowIso()
      const { clientRequestId: _request, ...fields } = input
      const task = ExecutionTaskSchema.parse({ ...fields,
        id: `task_${hash([threadId, input.clientRequestId]).slice(0, 32)}`, status: 'pending', revision: 0,
        ownerThreadId: input.ownerThreadId ?? threadId, createdAt: now, updatedAt: now })
      if (state.tasks.some((existing) => existing.id === task.id)) {
        fail('conflict', 'Task identity already exists; use a different clientRequestId.')
      }
      await this.validateOwner(thread, task.ownerThreadId)
      this.validateDependencies(state, task)
      state.tasks.push(task)
      this.record(state, key, fingerprint, task)
      return { task, replayed: false }
    }, true)
  }

  async update(threadId: string, id: string, raw: unknown, actor: ExecutionTaskActor = { threadId }) {
    const input = UpdateExecutionTaskSchema.parse(raw)
    return this.mutate(threadId, actor, async (state, thread) => {
      const key = `update:${input.clientRequestId}`, fingerprint = hash([id, input])
      const current = this.require(state, id)
      if (actor.threadId !== threadId && (current.ownerThreadId !== actor.threadId || input.ownerThreadId && input.ownerThreadId !== actor.threadId)) {
        fail('forbidden', 'A worker may only update its own assigned tasks.')
      }
      const replay = this.replay(state, key, fingerprint)
      if (replay) return { task: replay, replayed: true }
      if (current.revision !== input.expectedRevision) fail('conflict', `Task changed; current revision is ${current.revision}.`)
      const { clientRequestId: _request, expectedRevision: _revision, ...patch } = input
      const task = ExecutionTaskSchema.parse({ ...current, ...patch, revision: current.revision + 1, updatedAt: this.options.nowIso() })
      if (terminal(current) && task.status !== current.status) fail('invalid_transition', 'A terminal task cannot be reopened; create a follow-up task.')
      await this.validateOwner(thread, task.ownerThreadId)
      this.validateDependencies(state, task)
      if (['waiting', 'blocked', 'paused', 'failed'].includes(task.status) && !task.reason?.trim()) {
        fail('reason_required', 'Waiting, blocked, paused and failed tasks require a reason.')
      }
      if (task.status === 'succeeded' && !task.evidence.length) fail('evidence_required', 'Completion requires acceptance evidence.')
      if (task.sourceStale && ['running', 'succeeded'].includes(task.status)) fail('plan_changed', 'This step was removed from its plan; reconcile the plan or cancel the task before proceeding.')
      if (task.status === 'succeeded' && !task.dependsOn.every((dep) => state.tasks.find((candidate) => candidate.id === dep)?.status === 'succeeded')) {
        fail('dependency_blocked', 'All dependencies must succeed before this task can succeed.')
      }
      if (task.status === 'running') {
        if (!actor.turnId || task.ownerThreadId !== actor.threadId) fail('forbidden', 'Only an active owning turn can mark a task running.')
        if (state.tasks.some((other) => other.id !== id && other.ownerThreadId === task.ownerThreadId && other.status === 'running')) {
          fail('conflict', 'This owner already has a running task.')
        }
        if (!task.dependsOn.every((dep) => state.tasks.find((candidate) => candidate.id === dep)?.status === 'succeeded')) {
          fail('dependency_blocked', 'All dependencies must succeed before this task can run.')
        }
        task.execution = { threadId: actor.threadId, turnId: actor.turnId }
      }
      if (current.status === 'running' && (!actor.turnId || current.execution?.threadId !== actor.threadId || current.execution.turnId !== actor.turnId)) {
        fail('execution_active', 'Use the execution controls to stop the active turn before changing its task state.')
      }
      if (task.status !== 'running') delete task.execution
      if (!task.sourceStale && ['pending', 'running', 'succeeded', 'cancelled'].includes(task.status) && input.reason === undefined) delete task.reason
      state.tasks[state.tasks.findIndex((candidate) => candidate.id === id)] = task
      this.record(state, key, fingerprint, task)
      return { task, replayed: false }
    }, true)
  }

  /** Narrow compatibility for existing user-operated board controls; never a whole-list replacement. */
  async patchStatuses(threadId: string, ids: readonly string[], from: ThreadTodoStatus, to: ThreadTodoStatus): Promise<void> {
    if (to === 'in_progress') fail('execution_active', 'Running state is owned by an active execution turn.')
    await this.list(threadId)
    await this.mutate(threadId, { threadId }, (state) => {
      const projected = executionTasksAsTodos(threadId, state)
      const selected = [...new Set(ids)].map((id) => this.require(state, id))
      if (!selected.length) fail('invalid_task_request', 'At least one task is required.')
      const fingerprint = hash([[...new Set(ids)].sort(), from, to])
      const receiptKey = (id: string) => `compat-status:${fingerprint}:${id}`
      if (selected.every((task) => state.requests[receiptKey(task.id)]?.revision === task.revision &&
        state.requests[receiptKey(task.id)]?.fingerprint === fingerprint &&
        task.status === (to === 'completed' ? 'succeeded' : 'pending'))) return { tasks: selected }
      for (const task of selected) {
        if (projected.items.find((item) => item.id === task.id)?.status !== from) fail('conflict', 'stale todo status; refresh execution tasks')
        if (task.status === 'running') fail('execution_active', 'Stop the active execution before changing its task state.')
        const next = to === 'completed' ? 'succeeded' : 'pending'
        if (task.sourceStale && next === 'succeeded') fail('plan_changed', 'This step was removed from its plan; reconcile it before completion.')
        if (terminal(task) && task.status !== next) fail('invalid_transition', 'Create a follow-up instead of reopening a terminal task.')
        task.status = next; task.revision++; task.updatedAt = this.options.nowIso()
        if (!task.sourceStale) delete task.reason
        if (to === 'completed') task.evidence = [{ summary: 'Marked complete by the user in the task controls.' }]
        this.record(state, receiptKey(task.id), fingerprint, task)
      }
      if (selected.some((task) => task.status === 'succeeded' && task.dependsOn.some((id) => this.require(state, id).status !== 'succeeded'))) {
        fail('dependency_blocked', 'All dependencies must succeed before these tasks can succeed.')
      }
      return { tasks: selected }
    }, true)
  }

  /** Import saved plan structure; checkboxes never overwrite existing task state. */
  async importPlan(threadId: string, items: ThreadTodoItem[], plan: { planId: string; relativePath: string }) {
    return this.mutate(threadId, { threadId }, (state) => {
      const used = new Set<string>()
      const documentHash = taskPlanStructureHash(items.map((item) => item.source?.contentHash ?? ''))
      for (const item of items) {
        if (!item.source) continue
        const source = { ...item.source, documentHash, content: item.content }
        const candidates = state.tasks.filter((task) => !used.has(task.id) && task.planSource?.planId === source.planId &&
          task.planSource.relativePath === source.relativePath && task.planSource.contentHash === source.contentHash)
        const existing = candidates.find((task) => task.planSource?.ordinal === source.ordinal) ?? candidates[0]
        if (existing) {
          used.add(existing.id)
          if (existing.sourceStale) {
            delete existing.sourceStale
            if (existing.reason === 'Plan step removed; reconcile or cancel this task.') delete existing.reason
            existing.revision++; existing.updatedAt = this.options.nowIso()
          }
          if (!isDeepStrictEqual(existing.planSource, source)) { existing.planSource = source; existing.revision++; existing.updatedAt = this.options.nowIso() }
          continue
        }
        const id = `task_plan_${hash([threadId, source]).slice(0, 32)}`
        state.tasks.push(ExecutionTaskSchema.parse({ id, title: item.content, status: item.status === 'completed' ? 'succeeded' : 'pending',
          revision: 0, ownerThreadId: threadId, planSource: source,
          evidence: item.status === 'completed' ? [{ summary: 'Imported checked item from the saved plan.' }] : [],
          createdAt: item.createdAt, updatedAt: this.options.nowIso() }))
        used.add(id)
      }
      const planSources = new Set([JSON.stringify([plan.planId, plan.relativePath])])
      for (const task of state.tasks) {
        if (!task.planSource || used.has(task.id) || terminal(task) || task.sourceStale ||
          !planSources.has(JSON.stringify([task.planSource.planId, task.planSource.relativePath]))) continue
        task.sourceStale = true; task.reason ??= 'Plan step removed; reconcile or cancel this task.'
        task.revision++; task.updatedAt = this.options.nowIso()
      }
      if (state.tasks.length > MAX_EXECUTION_TASKS) fail('limit', `Plan import would exceed ${MAX_EXECUTION_TASKS} execution tasks.`)
      if (new Set(state.tasks.map((task) => task.id)).size !== state.tasks.length) fail('conflict', 'Plan task identity conflicts with an existing task.')
      // mutate stamps the aggregate after this callback; return the canonical
      // projection again in the caller when a revision-bearing result is needed.
      return state.tasks
    }, true)
  }

  private require(state: ExecutionTaskState, id: string): ExecutionTask {
    return state.tasks.find((task) => task.id === id) ?? fail('not_found', 'Execution task not found.')
  }
  private replay(state: ExecutionTaskState, key: string, fingerprint: string): ExecutionTask | undefined {
    const receipt = state.requests[key]
    if (!receipt) return undefined
    if (receipt.fingerprint !== fingerprint) fail('conflict', 'Idempotency key was already used with different arguments.')
    return this.require(state, receipt.taskId)
  }
  private record(state: ExecutionTaskState, key: string, fingerprint: string, task: ExecutionTask): void {
    state.requests[key] = { fingerprint, taskId: task.id, revision: task.revision }
  }
  private async validateOwner(thread: ThreadRecord, owner: string): Promise<void> {
    if (owner === thread.id) return
    const child = await this.options.threadStore.get(owner)
    if (!child || child.status === 'deleted' || child.parentThreadId !== thread.id || child.workspace !== thread.workspace) {
      fail('forbidden', 'Task owner must be this thread or its existing same-workspace child.')
    }
  }
  private validateDependencies(state: ExecutionTaskState, task: ExecutionTask): void {
    if (new Set(task.dependsOn).size !== task.dependsOn.length || task.dependsOn.some((id) => id === task.id || !state.tasks.some((item) => item.id === id))) {
      fail('invalid_dependency', 'Dependencies must be unique, existing tasks in this thread and cannot include the task itself.')
    }
    taskGraph({ ...state, tasks: [...state.tasks.filter((item) => item.id !== task.id), task] })
  }
}
