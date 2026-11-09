import { runExternalPlanBuildViaRuntime } from './schedule-runtime-external-plan'
import { runAuditedSchedule } from './schedule-run-audit'
import type {
  AppSettingsV1,
  ClawImChannelV1,
  ScheduleReasoningEffort,
  ScheduleRunResult,
  ScheduledTaskV1
} from '../shared/app-settings'
import {
  buildClawRuntimePrompt,
  buildScheduleRuntimePrompt
} from '../shared/app-settings'
import {
  TASK_RESPONSE_TIMEOUT_MS,
  computeScheduleNextRunAt,
  resolveScheduleModelConfig,
  runPromptViaRuntime,
  summarizeTaskResult,
  waitForAssistantTextViaRuntime,
  type RunPromptOptions,
  type ScheduleModelConfig,
  type ScheduleRuntimeDeps
} from './schedule-runtime-helpers'
import {
  acquireWorktree,
  findAvailablePoolIndex,
  releaseWorktree
} from './services/worktree-service'

const MAX_CONCURRENT_BACKGROUND_TASKS = 3

export function scheduledThreadTitle(title: string): string {
  const trimmed = title.trim()
  const prefix = '[Scheduled task]'
  const suffix = Array.from(trimmed).slice(0, 4).join('')
  return suffix ? `${prefix} ${suffix}` : prefix
}


export class ScheduleExecutionQueue {
  private runningTaskIds = new Set<string>()
  private queuedTaskIds = new Set<string>()
  private queuedTaskModes = new Map<string, boolean>()
  private taskCompletions = new Map<string, {
    resolve: (value: ScheduleRunResult) => void
    reject: (reason: unknown) => void
  }>()
  private worktreeLeases = new Map<string, { projectPath: string; poolIndex: number }>()
  private worktreeProjectLocks = new Map<string, Promise<void>>()
  private waitingWorktreeProjects = new Map<string, string>()
  private drainingQueue = false
  private readonly stopController = new AbortController()
  private readonly activeTasks = new Set<Promise<unknown>>()
  private stopped = false

  constructor(
    private readonly deps: ScheduleRuntimeDeps,
    private readonly onSettingsUpdated: (settings: AppSettingsV1) => void
  ) {}

  private async loadSettings(): Promise<AppSettingsV1> {
    const settings = await this.deps.store.load()
    return this.deps.withModelCredentials
      ? this.deps.withModelCredentials(settings)
      : settings
  }

  private resolveScheduleModelConfig(
    settings: AppSettingsV1,
    input: {
      providerId?: string | null
      model?: string | null
      reasoningEffort?: ScheduleReasoningEffort | string | null
    }
  ): ScheduleModelConfig {
    return resolveScheduleModelConfig(settings, input, settings.schedule.providerId?.trim() || '')
  }

  runningIds(): string[] {
    return [...this.runningTaskIds]
  }

  /** @internal Preserves the runtime's legacy characterization seam. */
  runningSet(): Set<string> {
    return this.runningTaskIds
  }

  queuedIds(): string[] {
    return [...this.queuedTaskIds]
  }

  hasRunning(taskId: string): boolean {
    return this.runningTaskIds.has(taskId)
  }

  hasQueued(taskId: string): boolean {
    return this.queuedTaskIds.has(taskId)
  }

  async stop(): Promise<void> {
    if (this.stopped) return
    this.stopped = true
    this.stopController.abort()
    this.queuedTaskIds.clear()
    this.queuedTaskModes.clear()
    this.waitingWorktreeProjects.clear()
    for (const taskId of [...this.taskCompletions.keys()]) {
      this.resolveTaskCompletion(taskId, { ok: false, message: 'Schedule runtime stopped.' })
    }
    await Promise.allSettled([...this.activeTasks])
    await Promise.allSettled([...this.worktreeLeases.keys()].map((taskId) => this.releaseTaskWorktree(taskId)))
    this.runningTaskIds.clear()
  }

  async runTask(taskId: string): Promise<ScheduleRunResult> {
    if (this.stopped) return { ok: false, message: 'Schedule runtime stopped.' }
    const settings = await this.loadSettings()
    const task = settings.schedule.tasks.find((item) => item.id === taskId)
    if (!task) return { ok: false, message: 'Task not found.' }
    if (!task.prompt.trim()) return { ok: false, message: 'Task prompt is empty.' }
    if (this.runningTaskIds.has(task.id) || this.queuedTaskIds.has(task.id)) {
      return { ok: false, message: 'Task is already queued or running.' }
    }
    const dependencies = (task.dependsOn ?? [])
      .map((id) => settings.schedule.tasks.find((candidate) => candidate.id === id))
    if (dependencies.some((dependency) => !dependency || dependency.lastStatus === 'error')) {
      return { ok: false, message: 'A required task is missing or failed.' }
    }
    if (hasTaskDependencyCycle(task.id, settings.schedule.tasks)) {
      return { ok: false, message: 'Task dependencies contain a cycle.' }
    }
    // Always go through the queue+drain path. The earlier two-step check —
    // `size < MAX` followed by an awaited store.load() — let two concurrent
    // IPC callers both pass the cap check before either of them had
    // incremented runningTaskIds, briefly running 4+ tasks at once. drainQueue
    // owns the cap synchronously (it is serialized via drainingQueue), so
    // routing every immediate-run through it eliminates the race.
    const dependenciesReady = dependencies.every((dependency) => dependency?.lastStatus === 'success')
    const completion = this.createTaskCompletion(task.id)
    await this.enqueueTask(task, false)
    if (!dependenciesReady) {
      // Dependency tasks have not all finished yet — the queue will pick this
      // task up later when they complete. Return the queued ack now; the
      // completion deferred stays parked.
      return { ok: true, threadId: '', queued: true, message: 'Task queued.' }
    }
    return completion
  }

  private createTaskCompletion(taskId: string): Promise<ScheduleRunResult> {
    // If a completion is already parked for this task (e.g. someone else is
    // about to run it), return that one. Otherwise create a fresh deferred.
    const existing = this.taskCompletions.get(taskId)
    if (existing) {
      return new Promise<ScheduleRunResult>((resolve, reject) => {
        const prevResolve = existing.resolve
        const prevReject = existing.reject
        existing.resolve = (value) => {
          prevResolve(value)
          resolve(value)
        }
        existing.reject = (reason) => {
          prevReject(reason)
          reject(reason)
        }
      })
    }
    let resolveFn: (value: ScheduleRunResult) => void = () => undefined
    let rejectFn: (reason: unknown) => void = () => undefined
    const promise = new Promise<ScheduleRunResult>((resolve, reject) => {
      resolveFn = resolve
      rejectFn = reject
    })
    this.taskCompletions.set(taskId, { resolve: resolveFn, reject: rejectFn })
    return promise
  }

  private resolveTaskCompletion(taskId: string, value: ScheduleRunResult): void {
    const deferred = this.taskCompletions.get(taskId)
    if (!deferred) return
    this.taskCompletions.delete(taskId)
    deferred.resolve(value)
  }


  discardQueued(taskIds: ReadonlySet<string>): void {
    for (const id of taskIds) {
      if (this.runningTaskIds.has(id) || !this.queuedTaskIds.delete(id)) continue
      this.queuedTaskModes.delete(id)
      this.waitingWorktreeProjects.delete(id)
      this.resolveTaskCompletion(id, { ok: false, message: 'Task was deleted before it started.' })
    }
  }

  async ensureNextRuns(_settings: AppSettingsV1): Promise<void> {
    if (this.stopped) return
    const now = new Date()
    const saved = await this.deps.store.update((current) => {
      if (!current.schedule.enabled) return current
      let changed = false
      const tasks = current.schedule.tasks.map((task) => {
        const wasRunning = task.lastStatus === 'running' && !this.runningTaskIds.has(task.id)
        const wasQueued = task.lastStatus === 'queued' && !this.queuedTaskIds.has(task.id)
        if (wasQueued && task.enabled && task.schedule.kind !== 'manual') {
          this.queuedTaskIds.add(task.id)
          this.queuedTaskModes.set(task.id, true)
          return task
        }
        const wasInterrupted = wasRunning || wasQueued
        if (!task.enabled || task.schedule.kind === 'manual' || this.runningTaskIds.has(task.id)) {
          if (!wasInterrupted) return task
          changed = true
          return {
            ...task,
            ...(task.schedule.kind === 'at' ? { enabled: false } : {}),
            nextRunAt: task.schedule.kind === 'at' ? '' : task.nextRunAt,
            lastStatus: 'error' as const,
            lastMessage: 'Task was interrupted before completion.',
            updatedAt: now.toISOString()
          }
        }
        if (task.nextRunAt && !wasInterrupted) return task
        changed = true
        return {
          ...task,
          nextRunAt: computeScheduleNextRunAt(task, now),
          ...(wasInterrupted
            ? {
                lastStatus: 'error' as const,
                lastMessage: 'Task was interrupted before completion.',
                updatedAt: now.toISOString()
              }
            : {})
        }
      })
      if (!changed) return current
      return { ...current, schedule: { ...current.schedule, tasks } }
    })
    this.onSettingsUpdated(saved)
  }

  private async updateTask(
    taskId: string,
    updater: (task: ScheduledTaskV1, settings: AppSettingsV1) => ScheduledTaskV1
  ): Promise<AppSettingsV1> {
    const saved = await this.deps.store.update((current) => {
      const tasks = current.schedule.tasks.map((task) =>
        task.id === taskId ? updater(task, current) : task
      )
      return { ...current, schedule: { ...current.schedule, tasks } }
    })
    this.onSettingsUpdated(saved)
    return saved
  }

  async enqueueTask(task: ScheduledTaskV1, scheduled: boolean): Promise<void> {
    if (this.stopped) return
    this.queuedTaskIds.add(task.id)
    this.queuedTaskModes.set(task.id, scheduled)
    await this.updateTask(task.id, (current) => ({
      ...current,
      lastStatus: 'queued',
      lastMessage: 'Queued',
      updatedAt: new Date().toISOString()
    }))
    void this.drainQueue()
  }

  async drainQueue(): Promise<void> {
    if (this.drainingQueue || this.stopped) return
    this.drainingQueue = true
    try {
      while (
        !this.stopped &&
        this.runningTaskIds.size < MAX_CONCURRENT_BACKGROUND_TASKS &&
        this.queuedTaskIds.size > 0
      ) {
        const settings = await this.loadSettings()
        const queued = settings.schedule.tasks
          .filter((task) => this.queuedTaskIds.has(task.id))
          .sort((left, right) => (right.priority ?? 0) - (left.priority ?? 0) || left.createdAt.localeCompare(right.createdAt))
        let next: ScheduledTaskV1 | undefined
        for (const task of queued) {
          if (!task.enabled) {
            this.queuedTaskIds.delete(task.id)
            this.queuedTaskModes.delete(task.id)
            await this.updateTask(task.id, (current) => ({
              ...current,
              lastStatus: 'idle',
              lastMessage: 'Paused',
              updatedAt: new Date().toISOString()
            }))
            this.resolveTaskCompletion(task.id, { ok: false, message: 'Task is paused.' })
            continue
          }
          if (!task.prompt.trim()) {
            this.queuedTaskIds.delete(task.id)
            this.queuedTaskModes.delete(task.id)
            await this.updateTask(task.id, (current) => ({
              ...current,
              lastStatus: 'error',
              lastMessage: 'Task prompt is empty.',
              updatedAt: new Date().toISOString()
            }))
            this.resolveTaskCompletion(task.id, { ok: false, message: 'Task prompt is empty.' })
            continue
          }
          const dependencies = (task.dependsOn ?? [])
            .map((id) => settings.schedule.tasks.find((candidate) => candidate.id === id))
          if (
            hasTaskDependencyCycle(task.id, settings.schedule.tasks) ||
            dependencies.some((dependency) => !dependency || dependency.lastStatus === 'error')
          ) {
            const cycleMessage = hasTaskDependencyCycle(task.id, settings.schedule.tasks)
              ? 'Task dependencies contain a cycle.'
              : 'A required task is missing or failed.'
            this.queuedTaskIds.delete(task.id)
            this.queuedTaskModes.delete(task.id)
            await this.updateTask(task.id, (current) => ({
              ...current,
              lastStatus: 'error',
              lastMessage: cycleMessage,
              updatedAt: new Date().toISOString()
            }))
            this.resolveTaskCompletion(task.id, { ok: false, message: cycleMessage })
            continue
          }
          if (this.waitingWorktreeProjects.has(task.id)) continue
          if (dependencies.every((dependency) => dependency?.lastStatus === 'success')) {
            next = task
            break
          }
        }
        if (!next) break
        // A previous candidate may have awaited a store write while deletion
        // removed this id. Never launch a candidate from that stale snapshot.
        if (!this.queuedTaskIds.has(next.id)) continue
        const scheduled = this.queuedTaskModes.get(next.id) ?? false
        const dequeued = next
        this.queuedTaskIds.delete(dequeued.id)
        this.queuedTaskModes.delete(dequeued.id)
        // Synchronously reserve the running slot BEFORE awaiting anything so
        // the next iteration of this drain loop (and a re-entrant drainQueue
        // call) sees the updated size. runTaskInternal also defends against
        // double-running, but reserving here is what makes the size check at
        // the top of the loop correct under back-to-back drains.
        this.runningTaskIds.add(dequeued.id)
        const task = this.runTaskInternal(dequeued, scheduled, { slotReserved: true })
        this.trackTask(task)
        void task
          .then((result) => {
            this.resolveTaskCompletion(dequeued.id, result)
          })
          .catch((error) => {
            const message = error instanceof Error ? error.message : String(error)
            this.resolveTaskCompletion(dequeued.id, { ok: false, message })
          })
          .finally(() => {
            void this.drainQueue()
          })
      }
    } finally {
      this.drainingQueue = false
    }
  }

  async runTaskInternal(
    task: ScheduledTaskV1,
    scheduled: boolean,
    options: { slotReserved?: boolean } = {}
  ): Promise<ScheduleRunResult> {
    if (this.stopped) return { ok: false, message: 'Schedule runtime stopped.' }
    const { slotReserved = false } = options
    if (!slotReserved && this.runningTaskIds.has(task.id)) {
      return { ok: false, message: 'Task is already running.' }
    }
    if (scheduled && (!task.enabled || task.schedule.kind === 'manual')) {
      if (slotReserved) this.runningTaskIds.delete(task.id)
      return { ok: false, message: 'Task is not scheduled.' }
    }
    if (!task.prompt.trim()) {
      if (slotReserved) this.runningTaskIds.delete(task.id)
      return { ok: false, message: 'Task prompt is empty.' }
    }

    if (!slotReserved) this.runningTaskIds.add(task.id)
    await this.updateTask(task.id, (current) => ({
      ...current,
      lastStatus: 'running',
      lastMessage: 'Running',
      nextRunAt: '',
      updatedAt: new Date().toISOString()
    }))

    try {
      const settings = await this.loadSettings()
      const clawChannel = this.resolveTaskClawChannel(settings, task)
      let workspaceRoot = this.resolveTaskWorkspaceRoot(settings, task, clawChannel)
      if (!task.useWorktree && task.harness) {
        const harness = task.harness
        // Handed-off plan build: the Agent gets its own conversation and task worktree.
        const handoff = await runAuditedSchedule(this.deps, settings, task.id, (clientRequestId) =>
          runExternalPlanBuildViaRuntime(this.deps, settings, {
            harness, prompt: task.prompt, title: task.title, displayText: scheduledThreadTitle(task.title),
            workspaceRoot, clientRequestId, signal: this.stopController.signal
          }))
        return await this.settleStartedTask(task, handoff)
      }
      if (task.useWorktree) {
        const projectPath = workspaceRoot
        const acquiredPath = await this.withWorktreeProject(projectPath, async () => {
          this.stopController.signal.throwIfAborted()
          const poolIndex = await findAvailablePoolIndex({ projectPath })
          if (poolIndex === null) {
            // Only a lease from this project can free a slot for this task.
            // Park it until release completes; completion drains must not
            // repeatedly retry the same exhausted pool.
            const hasOtherWorktreeTasks = [...this.worktreeLeases.values()]
              .some((lease) => lease.projectPath === projectPath)
            if (hasOtherWorktreeTasks) {
              this.waitingWorktreeProjects.set(task.id, projectPath)
              this.runningTaskIds.delete(task.id)
              await this.updateTask(task.id, (current) => ({
                ...current,
                lastStatus: 'queued',
                lastMessage: 'Waiting for a free worktree slot.',
                updatedAt: new Date().toISOString()
              }))
              this.queuedTaskIds.add(task.id)
              this.queuedTaskModes.set(task.id, scheduled)
              return null
            }
            throw new Error('No worktree pool slot is available.')
          }
          const worktree = await acquireWorktree({ projectPath, poolIndex, taskId: task.id })
          this.worktreeLeases.set(task.id, { projectPath, poolIndex })
          return worktree.path
        })
        if (acquiredPath === null) return { ok: true, threadId: '', queued: true, message: 'Task re-queued: no worktree slot available.' }
        workspaceRoot = acquiredPath
      }
      const modelConfig = this.resolveScheduleModelConfig(settings, {
        providerId: task.providerId,
        model: task.model,
        reasoningEffort: task.reasoningEffort
      })
      const result = await runAuditedSchedule(this.deps, settings, task.id, (clientRequestId) => this.runPrompt(settings, {
        clientRequestId,
        prompt: task.prompt,
        title: scheduledThreadTitle(task.title),
        workspaceRoot,
        ...(task.sourceThreadId ? { threadId: task.sourceThreadId } : {}),
        model: modelConfig.model,
        ...(modelConfig.providerId ? { providerId: modelConfig.providerId } : {}),
        reasoningEffort: modelConfig.reasoningEffort,
        mode: task.mode,
        orchestration: task.orchestration ?? 'direct',
        clawChannel,
        waitForResult: false,
        responseTimeoutMs: TASK_RESPONSE_TIMEOUT_MS,
        signal: this.stopController.signal
      }))
      return await this.settleStartedTask(task, result)
    } catch (error) {
      if (this.stopped) return { ok: false, message: 'Schedule runtime stopped.' }
      const message = error instanceof Error ? error.message : String(error)
      const finishedAt = new Date()
      await this.updateTask(task.id, (current) => ({
        ...current,
        lastRunAt: finishedAt.toISOString(),
        nextRunAt: computeScheduleNextRunAt(current, finishedAt),
        lastStatus: 'error',
        lastMessage: message,
        updatedAt: finishedAt.toISOString()
      }))
      this.runningTaskIds.delete(task.id)
      await this.releaseTaskWorktree(task.id)
      void this.drainQueue()
      return { ok: false, message }
    }
  }

  async monitorTaskTurn(taskId: string, threadId: string, turnId: string): Promise<void> {
    try {
      const settings = await this.loadSettings()
      const task = settings.schedule.tasks.find((item) => item.id === taskId)
      const text = await this.waitForAssistantText(
        settings,
        threadId,
        turnId,
        TASK_RESPONSE_TIMEOUT_MS,
        task?.workspaceRoot || this.resolveDefaultWorkspaceRoot(settings),
        this.stopController.signal
      )
      if (this.stopped) return
      const finishedAt = new Date()
      await this.updateTask(taskId, (current) => ({
        ...current,
        ...(current.schedule.kind === 'at' ? { enabled: false } : {}),
        nextRunAt: current.schedule.kind === 'at' ? '' : computeScheduleNextRunAt(current, finishedAt),
        lastStatus: 'success',
        lastMessage: summarizeTaskResult(text),
        lastThreadId: threadId,
        updatedAt: finishedAt.toISOString()
      }))
    } catch (error) {
      if (this.stopped) return
      const message = error instanceof Error ? error.message : String(error)
      const finishedAt = new Date()
      await this.updateTask(taskId, (current) => ({
        ...current,
        ...(current.schedule.kind === 'at' ? { enabled: false } : {}),
        nextRunAt: current.schedule.kind === 'at' ? '' : computeScheduleNextRunAt(current, finishedAt),
        lastStatus: 'error',
        lastMessage: message,
        lastThreadId: threadId || current.lastThreadId,
        updatedAt: finishedAt.toISOString()
      }))
      this.deps.logError('schedule-task', 'Scheduled task failed', { message, taskId, threadId })
    } finally {
      this.runningTaskIds.delete(taskId)
      await this.releaseTaskWorktree(taskId)
      void this.drainQueue()
    }
  }

  // Selection, acquisition and release share a project lock; other projects
  // can progress while an asynchronous worktree operation is still pending.
  private async withWorktreeProject<T>(projectPath: string, operation: () => Promise<T>): Promise<T> {
    const previous = this.worktreeProjectLocks.get(projectPath) ?? Promise.resolve()
    let unlock!: () => void
    const tail = new Promise<void>((resolve) => { unlock = resolve })
    this.worktreeProjectLocks.set(projectPath, tail)
    await previous
    try {
      return await operation()
    } finally {
      unlock()
      if (this.worktreeProjectLocks.get(projectPath) === tail) this.worktreeProjectLocks.delete(projectPath)
    }
  }

  private async releaseTaskWorktree(taskId: string): Promise<void> {
    const lease = this.worktreeLeases.get(taskId)
    if (!lease) return
    await this.withWorktreeProject(lease.projectPath, async () => {
      if (this.worktreeLeases.get(taskId) !== lease) return
      await releaseWorktree(lease).catch((error) => {
        this.deps.logError('schedule-worktree', 'Failed to release task worktree', {
          taskId,
          message: error instanceof Error ? error.message : String(error)
        })
      })
      this.worktreeLeases.delete(taskId)
      for (const [id, projectPath] of this.waitingWorktreeProjects) {
        if (projectPath === lease.projectPath) this.waitingWorktreeProjects.delete(id)
      }
    })
  }

  /** Record a started (or refused) run and hand the turn to the monitor. */
  private async settleStartedTask(task: ScheduledTaskV1, result: ScheduleRunResult): Promise<ScheduleRunResult> {
    if (this.stopped) return { ok: false, message: 'Schedule runtime stopped.' }
    if (!result.ok) {
      const finishedAt = new Date()
      await this.updateTask(task.id, (current) => ({
        ...current,
        ...(current.schedule.kind === 'at' ? { enabled: false } : {}),
        lastRunAt: finishedAt.toISOString(),
        nextRunAt: current.schedule.kind === 'at' ? '' : computeScheduleNextRunAt(current, finishedAt),
        lastStatus: 'error',
        lastMessage: result.message,
        updatedAt: finishedAt.toISOString()
      }))
      this.runningTaskIds.delete(task.id)
      await this.releaseTaskWorktree(task.id)
      void this.drainQueue()
      return result
    }

    const startedAt = new Date()
    await this.updateTask(task.id, (current) => ({
      ...current,
      lastRunAt: startedAt.toISOString(),
      nextRunAt: '',
      lastStatus: 'running',
      lastMessage: result.message ?? 'Started',
      lastThreadId: result.threadId,
      updatedAt: startedAt.toISOString()
    }))
    this.trackTask(Promise.resolve(this.monitorTaskTurn(task.id, result.threadId, result.turnId ?? '')))
    return result
  }

  runPrompt(settings: AppSettingsV1, options: RunPromptOptions): Promise<ScheduleRunResult> {
    const prompt = options.clawChannel
      ? buildClawRuntimePrompt(settings, options.prompt, { channel: options.clawChannel })
      : buildScheduleRuntimePrompt(settings, options.prompt)
    return runPromptViaRuntime(this.deps, settings, {
      prompt,
      title: options.title,
      workspaceRoot: options.workspaceRoot.trim() || this.resolveDefaultWorkspaceRoot(settings),
      ...(options.threadId ? { threadId: options.threadId } : {}),
      model: options.model,
      ...(options.clientRequestId ? { clientRequestId: options.clientRequestId } : {}),
      ...(options.providerId ? { providerId: options.providerId } : {}),
      reasoningEffort: options.reasoningEffort,
      mode: options.mode,
      orchestration: options.orchestration ?? 'direct',
      waitForResult: options.waitForResult,
      responseTimeoutMs: options.responseTimeoutMs,
      ...(options.signal ? { signal: options.signal } : {})
    })
  }

  waitForAssistantText(
    settings: AppSettingsV1,
    threadId: string,
    turnId: string,
    timeoutMs: number,
    workspaceRoot?: string,
    signal?: AbortSignal
  ): Promise<string> {
    void workspaceRoot
    return waitForAssistantTextViaRuntime(this.deps, settings, threadId, turnId, timeoutMs, signal)
  }

  private trackTask<T>(task: Promise<T>): Promise<T> {
    this.activeTasks.add(task)
    void task.then(
      () => this.activeTasks.delete(task),
      () => this.activeTasks.delete(task)
    )
    return task
  }

  resolveDefaultWorkspaceRoot(settings: AppSettingsV1): string {
    return settings.schedule.defaultWorkspaceRoot.trim() || settings.workspaceRoot
  }

  resolveClawChannel(settings: AppSettingsV1, channelId: string | null | undefined): ClawImChannelV1 | null {
    const id = channelId?.trim()
    if (!id) return null
    return settings.claw.channels.find((channel) => channel.id === id) ?? null
  }

  private resolveTaskClawChannel(settings: AppSettingsV1, task: ScheduledTaskV1): ClawImChannelV1 | null {
    return this.resolveClawChannel(settings, task.clawChannelId)
  }

  resolveClawChannelWorkspaceRoot(settings: AppSettingsV1, channel: ClawImChannelV1): string {
    return channel.workspaceRoot.trim() || settings.claw.im.workspaceRoot.trim() || this.resolveDefaultWorkspaceRoot(settings)
  }

  private resolveTaskWorkspaceRoot(
    settings: AppSettingsV1,
    task: ScheduledTaskV1,
    channel: ClawImChannelV1 | null
  ): string {
    return task.workspaceRoot.trim() ||
      (channel ? this.resolveClawChannelWorkspaceRoot(settings, channel) : this.resolveDefaultWorkspaceRoot(settings))
  }

}

export function hasTaskDependencyCycle(taskId: string, tasks: readonly ScheduledTaskV1[]): boolean {
  const dependencies = new Map(tasks.map((task) => [task.id, task.dependsOn ?? []]))
  const visiting = new Set<string>()
  const visited = new Set<string>()
  const visit = (id: string): boolean => {
    if (visiting.has(id)) return true
    if (visited.has(id)) return false
    visiting.add(id)
    for (const dependency of dependencies.get(id) ?? []) {
      if (visit(dependency)) return true
    }
    visiting.delete(id)
    visited.add(id)
    return false
  }
  return visit(taskId)
}
