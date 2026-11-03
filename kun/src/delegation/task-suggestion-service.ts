import { randomUUID } from 'node:crypto'
import {
  SuggestTasksInputSchema,
  TaskSuggestionIntentSchema,
  isFinalTaskRowState,
  type TaskSuggestionAction,
  type TaskSuggestionIntent,
  type TaskSuggestionRoute,
  type TaskSuggestionTask
} from '../contracts/task-suggestions.js'
import type { RuntimeEvent } from '../contracts/events.js'
import type { TaskSuggestionStore } from './task-suggestion-store.js'
import { classifyTaskLaunchError, type TaskLaunchProgress, type TaskSuggestionLauncher } from './task-suggestion-launcher.js'
import {
  applyTaskChanges, deriveCardState, resetForRetry, startableTasks, tasksFromSuggestion
} from './task-suggestion-rows.js'

/** Scan cadence while some card counts down or some row is still starting/running. */
export const TASK_SUGGESTION_SCAN_MS = 1_000
const MAX_REQUEST_IDS = 64

/**
 * Read on every decision so Settings changes apply without a restart.
 * `autoStartMs` 0 keeps cards waiting for the user (the default).
 */
export type TaskSuggestionPolicy = { autoStartMs: number; worktree: boolean; inheritContext: boolean }
export const DEFAULT_TASK_SUGGESTION_POLICY: TaskSuggestionPolicy = { autoStartMs: 0, worktree: true, inheritContext: false }

export type TaskSuggestionServiceOptions = {
  store: TaskSuggestionStore
  policy?: () => TaskSuggestionPolicy
  onUpdated?(intent: TaskSuggestionIntent): void | Promise<void>
  now?: () => number
  newId?: () => string
}

export type TaskSuggestionProposal = {
  source: TaskSuggestionIntent['source']
  workspace: string
  route: TaskSuggestionRoute
  input: unknown
}

export class TaskSuggestionConflictError extends Error {
  readonly code = 'TASK_SUGGESTION_REVISION_CONFLICT'
  constructor(readonly currentRevision: number) {
    super(`Suggestion card changed; reload revision ${currentRevision}`)
    this.name = 'TaskSuggestionConflictError'
  }
}

type Mutation = (intent: TaskSuggestionIntent) => TaskSuggestionIntent | null

export class TaskSuggestionService {
  private launcher?: TaskSuggestionLauncher
  private readonly launches = new Map<string, Promise<void>>()
  /** Task thread id → card row, so turn events resolve without a store read per event. */
  private readonly taskThreads = new Map<string, { intentId: string; taskId: string }>()
  private timer?: ReturnType<typeof setTimeout>
  private running = false
  private readonly now: () => number
  private readonly newId: () => string

  constructor(private readonly options: TaskSuggestionServiceOptions) {
    this.now = options.now ?? Date.now
    this.newId = options.newId ?? (() => `tsg_${randomUUID().replace(/-/g, '').slice(0, 20)}`)
  }

  /** Late-bound: thread and turn services exist only after the agent composition. */
  attach(launcher: TaskSuggestionLauncher): void { this.launcher = launcher }

  /** Suggesting-turn defaults, or why this thread cannot own a card. */
  describeSource(threadId: string, turnId: string): ReturnType<TaskSuggestionLauncher['describeSource']> {
    return this.launcher ? this.launcher.describeSource(threadId, turnId)
      : Promise.resolve({ refused: 'Task sessions are unavailable in this runtime.' })
  }

  get(intentId: string): Promise<TaskSuggestionIntent | null> { return this.options.store.get(intentId) }
  list(threadId?: string): Promise<TaskSuggestionIntent[]> { return this.options.store.list(threadId) }

  private policy(): TaskSuggestionPolicy { return this.options.policy?.() ?? DEFAULT_TASK_SUGGESTION_POLICY }
  private iso(offsetMs = 0): string { return new Date(this.now() + offsetMs).toISOString() }

  async propose(proposal: TaskSuggestionProposal): Promise<TaskSuggestionIntent> {
    const input = SuggestTasksInputSchema.parse(proposal.input)
    const policy = this.policy()
    const now = this.iso()
    const countdown = policy.autoStartMs > 0
    const intent = TaskSuggestionIntentSchema.parse({
      intentId: this.newId(), revision: 1, source: proposal.source,
      state: countdown ? 'countdown' : 'suggested', workspace: proposal.workspace,
      ...(input.reason ? { reason: input.reason } : {}),
      ...(countdown ? { deadline: this.iso(policy.autoStartMs) } : {}),
      tasks: tasksFromSuggestion(input, { route: proposal.route, worktree: policy.worktree, inheritContext: policy.inheritContext }),
      requestIds: [], createdAt: now, updatedAt: now
    })
    await this.options.store.transaction((file) => { file.intents.push(intent) })
    await this.publish(intent)
    if (countdown) this.schedule(0)
    return intent
  }

  async act(intentId: string, action: TaskSuggestionAction): Promise<TaskSuggestionIntent> {
    let launchIds: string[] = []
    const updated = await this.mutate(intentId, (intent) => {
      if (intent.requestIds.includes(action.requestId)) return null
      if (intent.revision !== action.expectedRevision) throw new TaskSuggestionConflictError(intent.revision)
      const next = structuredClone(intent)
      next.requestIds = [...next.requestIds, action.requestId].slice(-MAX_REQUEST_IDS)
      const row = (): TaskSuggestionTask => {
        const found = next.tasks.find((task) => task.id === action.taskId)
        if (!found) throw new Error(`Task not found: ${action.taskId ?? '(none)'}`)
        return found
      }
      switch (action.action) {
        case 'start': {
          const rows = startableTasks(next, action.taskIds)
          if (!rows.length) throw new Error('No task in this card can start in its current state')
          for (const task of rows) task.state = 'starting'
          launchIds = rows.map((task) => task.id)
          delete next.deadline
          break
        }
        case 'pause':
          if (next.state !== 'countdown') throw new Error(`Cannot pause a ${next.state} card`)
          next.state = 'paused'
          delete next.deadline
          break
        case 'resume': {
          if (next.state !== 'paused') throw new Error(`Cannot resume a ${next.state} card`)
          const delay = this.policy().autoStartMs
          next.state = delay > 0 ? 'countdown' : 'suggested'
          if (delay > 0) next.deadline = this.iso(delay)
          break
        }
        case 'update': {
          const task = row()
          if (task.state !== 'suggested' && task.state !== 'start_failed') throw new Error(`Cannot edit a ${task.state} task`)
          if (!action.changes) throw new Error('update needs changes')
          next.tasks[next.tasks.indexOf(task)] = applyTaskChanges(task, action.changes)
          // Every edit restarts the no-response window for the new choice.
          if (next.state === 'countdown') next.deadline = this.iso(this.policy().autoStartMs)
          break
        }
        case 'ignore': {
          const wanted = action.taskIds?.length ? new Set(action.taskIds) : undefined
          const rows = next.tasks.filter((task) => (task.state === 'suggested' || task.state === 'start_failed') &&
            (!wanted || wanted.has(task.id)))
          if (!rows.length) throw new Error('No task in this card can be ignored in its current state')
          for (const task of rows) task.state = 'ignored'
          break
        }
        case 'retry': {
          const task = row()
          if (task.state !== 'start_failed') throw new Error(`Cannot retry a ${task.state} task`)
          next.tasks[next.tasks.indexOf(task)] = resetForRetry(action.changes ? applyTaskChanges(task, action.changes) : task)
          launchIds = [task.id]
          break
        }
        case 'continue_here': {
          const task = row()
          if (task.state !== 'suggested' && task.state !== 'start_failed') throw new Error(`Cannot continue a ${task.state} task here`)
          task.state = 'here'
          break
        }
        case 'acknowledge': {
          const wanted = action.taskIds?.length ? new Set(action.taskIds) : undefined
          for (const task of next.tasks) if (task.result && (!wanted || wanted.has(task.id))) task.reportAcknowledged = true
          break
        }
      }
      return next
    })
    for (const taskId of launchIds) this.launch(intentId, taskId)
    return updated
  }

  /** Startup: resume interrupted launches and settle rows whose turn finished while the runtime was down. */
  async start(): Promise<void> {
    this.running = true
    const intents = await this.options.store.list()
    for (const intent of intents) {
      for (const task of intent.tasks) {
        if (task.threadId && !isFinalTaskRowState(task.state)) this.taskThreads.set(task.threadId, { intentId: intent.intentId, taskId: task.id })
        if (task.state === 'starting') this.launch(intent.intentId, task.id)
        if (task.state === 'running') void this.settleIfDone(intent.intentId, task.id)
      }
    }
    this.schedule(0)
  }

  stop(): void {
    this.running = false
    if (this.timer) clearTimeout(this.timer)
    this.timer = undefined
  }

  /** Event observer: a task session's first turn settled. */
  observe(event: RuntimeEvent): void {
    if (event.kind !== 'turn_completed' && event.kind !== 'turn_failed' && event.kind !== 'turn_aborted') return
    const key = this.taskThreads.get(event.threadId)
    if (key) void this.settleIfDone(key.intentId, key.taskId)
  }

  /** Waits for in-flight launches; tests and shutdown use it. */
  async idle(): Promise<void> {
    while (this.launches.size) await Promise.allSettled([...this.launches.values()])
  }

  private launch(intentId: string, taskId: string): void {
    const key = `${intentId}:${taskId}`
    if (this.launches.has(key)) return
    const run = this.runLaunch(intentId, taskId).catch((error) => {
      console.warn('[kun] task suggestion launch failed:', error instanceof Error ? error.message : error)
    }).finally(() => { this.launches.delete(key) })
    this.launches.set(key, run)
  }

  private async runLaunch(intentId: string, taskId: string): Promise<void> {
    const intent = await this.get(intentId)
    const task = intent?.tasks.find((entry) => entry.id === taskId)
    if (!intent || !task || task.state !== 'starting') return
    const launcher = this.launcher
    if (!launcher) {
      await this.patchTask(intentId, taskId, { state: 'start_failed',
        failure: { code: 'runtime', message: 'Task sessions are unavailable in this runtime.' } })
      return
    }
    const persist = async (progress: TaskLaunchProgress): Promise<void> => {
      if (progress.threadId) this.taskThreads.set(progress.threadId, { intentId, taskId })
      await this.patchTask(intentId, taskId, progress)
    }
    try {
      const outcome = await launcher.launch(intent, task, persist)
      this.taskThreads.set(outcome.threadId, { intentId, taskId })
      await this.patchTask(intentId, taskId, { ...outcome, state: 'running', startedAt: this.iso() })
      // A very short turn may settle before the row recorded its turn id.
      await this.settleIfDone(intentId, taskId, { missingIsFailure: false })
    } catch (error) {
      await this.patchTask(intentId, taskId, { state: 'start_failed', failure: classifyTaskLaunchError(error) })
    }
  }

  private async settleIfDone(intentId: string, taskId: string, options = { missingIsFailure: true }): Promise<void> {
    const intent = await this.get(intentId)
    const task = intent?.tasks.find((entry) => entry.id === taskId)
    if (!task || task.state !== 'running' || !this.launcher) return
    const inspection = await this.launcher.inspect(task)
    if (inspection.status === 'missing') {
      if (!options.missingIsFailure) return
      await this.patchTask(intentId, taskId, { state: 'failed', settledAt: this.iso(),
        result: { turnStatus: 'failed', error: 'The task session or its first turn no longer exists.' } })
    } else if ('result' in inspection) {
      const state = inspection.status === 'completed' ? 'done' : inspection.status === 'aborted' ? 'cancelled' : 'failed'
      await this.patchTask(intentId, taskId, { state, settledAt: this.iso(), result: inspection.result })
    } else return
    if (task.threadId) this.taskThreads.delete(task.threadId)
  }

  private async patchTask(intentId: string, taskId: string, patch: Partial<TaskSuggestionTask>): Promise<void> {
    await this.mutate(intentId, (intent) => {
      const next = structuredClone(intent)
      const task = next.tasks.find((entry) => entry.id === taskId)
      if (!task) return null
      Object.assign(task, patch)
      if (patch.state && patch.state !== 'start_failed') delete task.failure
      return next
    }).catch((error) => {
      if (!/not found/i.test(String(error))) throw error
    })
  }

  /** One serialized read-modify-write; null keeps the card unchanged. */
  private async mutate(intentId: string, change: Mutation): Promise<TaskSuggestionIntent> {
    let result: TaskSuggestionIntent | undefined
    let changed = false
    await this.options.store.transaction((file) => {
      const index = file.intents.findIndex((entry) => entry.intentId === intentId)
      if (index < 0) throw new Error(`Suggestion card not found: ${intentId}`)
      const current = file.intents[index]!
      const next = change(current)
      if (!next) { result = current; return }
      next.state = deriveCardState(next)
      if (next.state !== 'countdown') delete next.deadline
      next.revision = current.revision + 1
      next.updatedAt = this.iso()
      file.intents[index] = TaskSuggestionIntentSchema.parse(next)
      result = file.intents[index]
      changed = true
    })
    if (changed && result) await this.publish(result)
    if (result?.state === 'countdown') this.schedule(0)
    return result!
  }

  private async publish(intent: TaskSuggestionIntent): Promise<void> {
    try { await this.options.onUpdated?.(intent) } catch (error) {
      console.warn('[kun] task suggestion event failed:', error instanceof Error ? error.message : error)
    }
  }

  private schedule(delayMs: number): void {
    if (!this.running || this.timer) return
    this.timer = setTimeout(() => {
      this.timer = undefined
      void this.tick().catch((error) => console.warn('[kun] task suggestion scan failed:', error))
    }, delayMs)
    this.timer.unref?.()
  }

  /** Starts every countdown card whose no-response window ran out. */
  private async tick(): Promise<void> {
    const due = (await this.options.store.list()).filter((intent) => intent.state === 'countdown')
    let waiting = false
    for (const intent of due) {
      if (!intent.deadline || Date.parse(intent.deadline) > this.now()) { waiting = true; continue }
      if (this.policy().autoStartMs <= 0) {
        await this.mutate(intent.intentId, (current) => current.state === 'countdown'
          ? { ...structuredClone(current), state: 'suggested' } : null)
        continue
      }
      let launchIds: string[] = []
      await this.mutate(intent.intentId, (current) => {
        if (current.state !== 'countdown') return null
        const next = structuredClone(current)
        const rows = startableTasks(next)
        for (const task of rows) task.state = 'starting'
        launchIds = rows.map((task) => task.id)
        next.autoStarted = true
        return next
      })
      for (const taskId of launchIds) this.launch(intent.intentId, taskId)
    }
    if (waiting) this.schedule(TASK_SUGGESTION_SCAN_MS)
  }
}
