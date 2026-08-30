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
const DEFAULT_SCHEDULED_SEND_MAX_ATTEMPTS = 3
const SCHEDULED_SEND_RETRY_DELAY_MS = 1_000
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
  private drainingQueue = false
  private readonly stopController = new AbortController()
  private readonly activeTasks = new Set<Promise<unknown>>()
  private wakeTimer: ReturnType<typeof setTimeout> | null = null
  private wakeAt = 0
  private readonly cancelledTaskIds = new Set<string>()
  private readonly admittedTaskIds = new Set<string>()
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
  hasAdmitted(taskId: string): boolean {
    return this.admittedTaskIds.has(taskId)
  }
  markQueuedScheduled(taskId: string): void {
    if (this.queuedTaskIds.has(taskId)) this.queuedTaskModes.set(taskId, true)
  }
  cancelTask(taskId: string): void {
    this.cancelledTaskIds.add(taskId)
    const wasQueued = this.queuedTaskIds.delete(taskId)
    this.queuedTaskModes.delete(taskId)
    if (wasQueued) {
      this.resolveTaskCompletion(taskId, { ok: false, message: 'Scheduled task was cancelled.' })
      void this.drainQueue()
    }
  }
  async stop(): Promise<void> {
    if (this.stopped) return
    this.stopped = true
    this.stopController.abort()
    if (this.wakeTimer) clearTimeout(this.wakeTimer)
    this.wakeTimer = null
    this.queuedTaskIds.clear()
    this.queuedTaskModes.clear()
    for (const taskId of [...this.taskCompletions.keys()]) {
      this.resolveTaskCompletion(taskId, { ok: false, message: 'Schedule runtime stopped.' })
    }
    await Promise.allSettled([...this.activeTasks])
    await Promise.allSettled([...this.worktreeLeases.keys()].map((taskId) => this.releaseTaskWorktree(taskId)))
    this.runningTaskIds.clear()
    this.admittedTaskIds.clear()
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
    const dependenciesReady = dependencies.every((dependency) => dependency?.lastStatus === 'success')
    const completion = this.createTaskCompletion(task.id)
    await this.enqueueTask(task, false)
    if (!dependenciesReady) {
      return { ok: true, threadId: '', queued: true, message: 'Task queued.' }
    }
    return completion
  }
  private createTaskCompletion(taskId: string): Promise<ScheduleRunResult> {
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
        if (wasInterrupted && task.scheduledSend?.kind === 'thread-send' && task.enabled && task.schedule.kind !== 'manual' && task.scheduledSend.attemptCount < task.scheduledSend.maxAttempts) {
          changed = true; this.queuedTaskIds.add(task.id); this.queuedTaskModes.set(task.id, true)
          return { ...task, lastStatus: 'queued' as const, lastMessage: 'Resuming scheduled send after interruption.', nextRunAt: now.toISOString(), updatedAt: now.toISOString() }
        }
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
        const claimedThreadIds = new Set<string>()
        for (const task of queued) {
          const scheduledSendThreadId = task.scheduledSend?.kind === 'thread-send' ? task.sourceThreadId?.trim() || '' : ''
          if (scheduledSendThreadId) {
            const hasEarlierQueuedTask = queued.some((candidate) => candidate.id !== task.id && this.queuedTaskIds.has(candidate.id) && candidate.scheduledSend?.kind === 'thread-send' && candidate.sourceThreadId?.trim() === scheduledSendThreadId && (candidate.createdAt < task.createdAt || (candidate.createdAt === task.createdAt && candidate.id < task.id)))
            if (hasEarlierQueuedTask) continue
          }
          if (task.scheduledSend?.kind === 'thread-send' && task.sourceThreadId) {
            const threadHasRunningSend = settings.schedule.tasks.some((candidate) => candidate.id !== task.id && this.runningTaskIds.has(candidate.id) && candidate.scheduledSend?.kind === 'thread-send' && candidate.sourceThreadId === task.sourceThreadId)
            if (threadHasRunningSend) continue
          }
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
          if (scheduledSendThreadId) {
            if (claimedThreadIds.has(scheduledSendThreadId)) continue
            claimedThreadIds.add(scheduledSendThreadId)
          }
          if (task.scheduledSend?.kind === 'thread-send' && (this.queuedTaskModes.get(task.id) === true || task.scheduledSend.attemptCount > 0) && task.nextRunAt && Date.parse(task.nextRunAt) > Date.now()) continue
          if (dependencies.every((dependency) => dependency?.lastStatus === 'success')) {
            next = task
            break
          }
        }
        if (!next) {
          const nextWakeAt = queued.filter((task) => task.scheduledSend?.kind === 'thread-send' && task.nextRunAt).map((task) => Date.parse(task.nextRunAt)).filter((at) => Number.isFinite(at) && at > Date.now()).sort((left, right) => left - right)[0]
          if (nextWakeAt) this.scheduleDrainAt(nextWakeAt)
          break
        }
        const scheduled = this.queuedTaskModes.get(next.id) ?? false
        const dequeued = next
        this.queuedTaskIds.delete(dequeued.id)
        this.queuedTaskModes.delete(dequeued.id)
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
    const scheduledSendAttempt = task.scheduledSend?.kind === 'thread-send'
      ? task.scheduledSend.attemptCount + 1
      : 0
    if (
      task.scheduledSend?.kind === 'thread-send' &&
      scheduledSendAttempt > task.scheduledSend.maxAttempts
    ) {
      if (slotReserved) this.runningTaskIds.delete(task.id)
      await this.updateTask(task.id, (current) => ({
        ...current,
        enabled: current.schedule.kind === 'at' ? false : current.enabled,
        nextRunAt: current.schedule.kind === 'at' ? '' : current.nextRunAt,
        lastStatus: 'error',
        lastMessage: 'Scheduled send retry limit reached.',
        updatedAt: new Date().toISOString()
      }))
      return { ok: false, message: 'Scheduled send retry limit reached.' }
    }
    await this.updateTask(task.id, (current) => ({
      ...current,
      lastStatus: 'running',
      lastMessage: 'Running',
      nextRunAt: '',
      ...(current.scheduledSend?.kind === 'thread-send'
        ? { scheduledSend: { ...current.scheduledSend, attemptCount: scheduledSendAttempt, reconciliationPending: true } }
        : {}),
      updatedAt: new Date().toISOString()
    }))
    try {
      const settings = await this.loadSettings()
      const persistedTask = settings.schedule.tasks.find((candidate) => candidate.id === task.id)
      if (!persistedTask || this.cancelledTaskIds.has(task.id)) { this.runningTaskIds.delete(task.id); return { ok: false, message: 'Scheduled task was removed before admission.' } }
      if (task.scheduledSend?.kind === 'thread-send' && !persistedTask.enabled) {
        this.runningTaskIds.delete(task.id)
        await this.updateTask(task.id, (current) => ({ ...current, lastStatus: 'idle', lastMessage: 'Scheduled send was paused before admission.', updatedAt: new Date().toISOString() }))
        return { ok: false, message: 'Scheduled send was paused before admission.' }
      }
      if (task.scheduledSend?.kind === 'thread-send' && (!task.sourceThreadId?.trim() || !task.scheduledSend.clientRequestId.trim() || !task.providerId?.trim() || !task.model.trim())) {
        this.runningTaskIds.delete(task.id)
        await this.updateTask(task.id, (current) => ({ ...current, enabled: false, lastStatus: 'error', lastMessage: 'Scheduled send snapshot is invalid; no message was sent.', updatedAt: new Date().toISOString() }))
        return { ok: false, message: 'Scheduled send snapshot is invalid.' }
      }
      const clawChannel = this.resolveTaskClawChannel(settings, task)
      let workspaceRoot = this.resolveTaskWorkspaceRoot(settings, task, clawChannel)
      if (task.useWorktree) {
        const projectPath = workspaceRoot
        const poolIndex = await findAvailablePoolIndex({ projectPath })
        if (poolIndex === null) {
          const hasOtherWorktreeTasks = [...this.runningTaskIds].some((id) => {
            if (id === task.id) return false
            return this.worktreeLeases.has(id)
          })
          if (hasOtherWorktreeTasks) {
            this.runningTaskIds.delete(task.id)
            await this.updateTask(task.id, (current) => ({
              ...current,
              lastStatus: 'queued',
              lastMessage: 'Waiting for a free worktree slot.',
              updatedAt: new Date().toISOString()
            }))
            this.queuedTaskIds.add(task.id)
            this.queuedTaskModes.set(task.id, scheduled)
            setTimeout(() => { void this.drainQueue() }, 250).unref?.()
            return { ok: true, threadId: '', queued: true, message: 'Task re-queued: no worktree slot available.' }
          }
          throw new Error('No worktree pool slot is available.')
        }
        const worktree = await acquireWorktree({ projectPath, poolIndex, taskId: task.id })
        workspaceRoot = worktree.path
        this.worktreeLeases.set(task.id, { projectPath, poolIndex })
      }
      const modelConfig = task.scheduledSend?.kind === 'thread-send'
        ? { providerId: task.providerId?.trim() ?? '', model: task.model, reasoningEffort: task.reasoningEffort }
        : this.resolveScheduleModelConfig(settings, {
            providerId: task.providerId,
            model: task.model,
            reasoningEffort: task.reasoningEffort
          })
      const result = await this.runPrompt(settings, {
        prompt: task.prompt,
        preservePrompt: task.scheduledSend?.kind === 'thread-send',
        title: scheduledThreadTitle(task.title),
        workspaceRoot,
        ...(task.sourceThreadId ? { threadId: task.sourceThreadId } : {}),
        model: modelConfig.model,
        ...(modelConfig.providerId ? { providerId: modelConfig.providerId } : {}),
        reasoningEffort: modelConfig.reasoningEffort,
        ...(task.scheduledSend?.kind === 'thread-send'
          ? {
              accountId: task.scheduledSend.accountId,
              attachmentIds: task.scheduledSend.attachmentIds,
              clientRequestId: task.scheduledSend.clientRequestId
            }
          : {}),
        mode: task.mode,
        orchestration: task.orchestration ?? 'direct',
        clawChannel,
        waitForResult: false,
        responseTimeoutMs: TASK_RESPONSE_TIMEOUT_MS,
        signal: this.stopController.signal
      })
      if (this.stopped) return { ok: false, message: 'Schedule runtime stopped.' }
      if (!result.ok) {
        if (task.scheduledSend?.kind === 'thread-send' && isRetryableScheduledSendResult(result, scheduledSendAttempt, task.scheduledSend.maxAttempts)) {
          const retryAt = new Date(Date.now() + retryDelayMs(scheduledSendAttempt))
          this.runningTaskIds.delete(task.id)
          await this.updateTask(task.id, (current) => ({ ...current, lastStatus: 'queued', lastMessage: `Retrying scheduled send (${scheduledSendAttempt}/${current.scheduledSend?.maxAttempts ?? DEFAULT_SCHEDULED_SEND_MAX_ATTEMPTS}).`, nextRunAt: retryAt.toISOString(), updatedAt: new Date().toISOString() }))
          this.queuedTaskIds.add(task.id)
          this.queuedTaskModes.set(task.id, scheduled)
          this.scheduleDrainAt(retryAt.getTime())
          return { ok: true, threadId: '', queued: true, message: 'Scheduled send queued for retry.' }
        }
        const finishedAt = new Date()
        await this.updateTask(task.id, (current) => ({
          ...current,
          ...(current.schedule.kind === 'at' ? { enabled: false } : {}),
          ...(current.scheduledSend?.kind === 'thread-send' ? { scheduledSend: { ...current.scheduledSend, reconciliationPending: false } } : {}),
          lastRunAt: finishedAt.toISOString(),
          nextRunAt: current.schedule.kind === 'at' ? '' : computeScheduleNextRunAt(current, finishedAt),
          lastStatus: 'error',
          lastMessage: result.message,
          updatedAt: finishedAt.toISOString()
        }))
        this.runningTaskIds.delete(task.id)
        this.admittedTaskIds.delete(task.id)
        await this.releaseTaskWorktree(task.id)
        void this.drainQueue()
        return result
      }
      const startedAt = new Date()
      this.admittedTaskIds.add(task.id)
      await this.updateTask(task.id, (current) => ({
        ...current,
        lastRunAt: startedAt.toISOString(),
        nextRunAt: '',
        lastStatus: 'running',
        lastMessage: result.message ?? 'Started',
        lastThreadId: result.threadId,
        ...(current.scheduledSend?.kind === 'thread-send' ? { scheduledSend: { ...current.scheduledSend, reconciliationPending: false } } : {}),
        updatedAt: startedAt.toISOString()
      }))
      this.trackTask(Promise.resolve(this.monitorTaskTurn(task.id, result.threadId, result.turnId ?? '')))
      return result
    } catch (error) {
      if (this.stopped) return { ok: false, message: 'Schedule runtime stopped.' }
      const message = error instanceof Error ? error.message : String(error)
      if (task.scheduledSend?.kind === 'thread-send' && scheduledSendAttempt < task.scheduledSend.maxAttempts && isRetryableScheduledSendError(error)) {
        const delay = retryDelayMs(scheduledSendAttempt)
        this.runningTaskIds.delete(task.id)
        await this.updateTask(task.id, (current) => ({ ...current, lastStatus: 'queued', lastMessage: `Retrying scheduled send (${scheduledSendAttempt}/${current.scheduledSend?.maxAttempts ?? DEFAULT_SCHEDULED_SEND_MAX_ATTEMPTS}).`, nextRunAt: new Date(Date.now() + delay).toISOString(), updatedAt: new Date().toISOString() }))
        this.queuedTaskIds.add(task.id)
        this.queuedTaskModes.set(task.id, scheduled)
        this.scheduleDrainAt(Date.now() + delay)
        return { ok: true, threadId: '', queued: true, message: 'Scheduled send queued for retry.' }
      }
      const finishedAt = new Date()
      await this.updateTask(task.id, (current) => ({
        ...current,
        lastRunAt: finishedAt.toISOString(),
        ...(current.scheduledSend?.kind === 'thread-send' ? { scheduledSend: { ...current.scheduledSend, reconciliationPending: false } } : {}),
        ...(current.schedule.kind === 'at'
          ? { enabled: false, nextRunAt: '' }
          : { nextRunAt: computeScheduleNextRunAt(current, finishedAt) }),
        lastStatus: 'error',
        lastMessage: message,
        updatedAt: finishedAt.toISOString()
      }))
      this.runningTaskIds.delete(task.id)
      this.admittedTaskIds.delete(task.id)
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
        ...(current.schedule.kind === 'at' || !current.enabled ? { enabled: false, nextRunAt: '' } : { nextRunAt: computeScheduleNextRunAt(current, finishedAt) }),
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
        ...(current.schedule.kind === 'at' || !current.enabled ? { enabled: false, nextRunAt: '' } : { nextRunAt: computeScheduleNextRunAt(current, finishedAt) }),
        lastStatus: 'error',
        lastMessage: message,
        lastThreadId: threadId || current.lastThreadId,
        updatedAt: finishedAt.toISOString()
      }))
      this.deps.logError('schedule-task', 'Scheduled task failed', { message, taskId, threadId })
    } finally {
      this.runningTaskIds.delete(taskId)
      this.admittedTaskIds.delete(taskId)
      await this.releaseTaskWorktree(taskId)
      void this.drainQueue()
    }
  }
  private async releaseTaskWorktree(taskId: string): Promise<void> {
    const lease = this.worktreeLeases.get(taskId)
    if (!lease) return
    this.worktreeLeases.delete(taskId)
    await releaseWorktree(lease).catch((error) => {
      this.deps.logError('schedule-worktree', 'Failed to release task worktree', {
        taskId,
        message: error instanceof Error ? error.message : String(error)
      })
    })
  }
  runPrompt(settings: AppSettingsV1, options: RunPromptOptions): Promise<ScheduleRunResult> {
    const prompt = options.preservePrompt
      ? options.prompt
      : options.clawChannel
      ? buildClawRuntimePrompt(settings, options.prompt, { channel: options.clawChannel })
      : buildScheduleRuntimePrompt(settings, options.prompt)
    return runPromptViaRuntime(this.deps, settings, {
      prompt,
      title: options.title,
      workspaceRoot: options.workspaceRoot.trim() || this.resolveDefaultWorkspaceRoot(settings),
      ...(options.threadId ? { threadId: options.threadId } : {}),
      model: options.model,
      ...(options.providerId ? { providerId: options.providerId } : {}),
      reasoningEffort: options.reasoningEffort,
      ...(options.accountId ? { accountId: options.accountId } : {}),
      ...(options.attachmentIds?.length ? { attachmentIds: options.attachmentIds } : {}),
      ...(options.clientRequestId ? { clientRequestId: options.clientRequestId } : {}),
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
  private scheduleDrainAt(at: number): void {
    if (this.stopped) return
    if (this.wakeTimer && this.wakeAt <= at) return
    if (this.wakeTimer) clearTimeout(this.wakeTimer)
    this.wakeAt = at
    this.wakeTimer = setTimeout(() => {
      this.wakeTimer = null
      this.wakeAt = 0
      void this.drainQueue()
    }, Math.max(0, at - Date.now()))
    this.wakeTimer.unref?.()
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
function retryDelayMs(attempt: number): number { return Math.min(SCHEDULED_SEND_RETRY_DELAY_MS * 2 ** Math.max(0, attempt - 1), 30_000) }
function isRetryableScheduledSendResult(
  result: Extract<ScheduleRunResult, { ok: false }>,
  attempt: number,
  maxAttempts: number
): boolean {
  if (attempt >= maxAttempts) return false
  if (result.status === 409 && /thread_busy|active turn|thread already/i.test(result.message)) return true
  if (result.status === 408 || result.status === 425 || result.status === 429) return true
  if (result.status === 0 && (result.code === 'fetch_failed' || result.code === 'runtime_offline' || result.code === 'runtime_request_failed')) return true
  return typeof result.status === 'number' && result.status >= 500
}
function isRetryableScheduledSendError(error: unknown): boolean {
  if (!(error instanceof Error)) return false
  return /fetch failed|econnrefused|econnreset|socket|timed out|timeout|network|connect/.test(`${error.name} ${error.message}`.toLowerCase())
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
    visiting.delete(id); visited.add(id)
    return false
  }
  return visit(taskId) }
