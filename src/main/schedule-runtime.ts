import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http'
import { randomUUID } from 'node:crypto'
import { URL } from 'node:url'
import type {
  AppSettingsV1,
  ClawImChannelV1,
  ScheduleReasoningEffort,
  ScheduleRunMode,
  ScheduleRunResult,
  ScheduleRuntimeStatus,
  ScheduleTaskFromTextResult,
  ScheduledTaskV1
} from '../shared/app-settings'
import {
  DEFAULT_SCHEDULE_MODEL,
  DEFAULT_SCHEDULE_REASONING_EFFORT,
  buildClawRuntimePrompt,
  buildScheduleRuntimePrompt
} from '../shared/app-settings'
import {
  buildScheduledTaskFromDetectedRequest,
  detectClawScheduledTaskRequest
} from './claw-scheduled-task-detector'
import {
  SCHEDULER_INTERVAL_MS,
  TASK_RESPONSE_TIMEOUT_MS,
  asString,
  computeScheduleNextRunAt,
  hasEnabledScheduledTask,
  internalUrl,
  nestedRecord,
  parseJsonObject,
  readRequestBody,
  resolveScheduleModelConfig,
  runPromptViaRuntime,
  summarizeTaskResult,
  waitForAssistantTextViaRuntime,
  writeJson,
  type RunPromptOptions,
  type ScheduleModelConfig,
  type ScheduleRuntimeDeps
} from './schedule-runtime-helpers'
import {
  acquireWorktree,
  findAvailablePoolIndex,
  releaseWorktree
} from './services/worktree-service'

export { computeScheduleNextRunAt } from './schedule-runtime-helpers'

const MAX_CONCURRENT_BACKGROUND_TASKS = 3

export function scheduledThreadTitle(title: string): string {
  const trimmed = title.trim()
  const prefix = '[Scheduled task]'
  const suffix = Array.from(trimmed).slice(0, 4).join('')
  return suffix ? `${prefix} ${suffix}` : prefix
}

export class ScheduleRuntime {
  private readonly deps: ScheduleRuntimeDeps
  private scheduler: ReturnType<typeof setInterval> | null = null
  private server: Server | null = null
  private serverKey = ''
  private runningTaskIds = new Set<string>()
  private queuedTaskIds = new Set<string>()
  private queuedTaskModes = new Map<string, boolean>()
  private worktreeLeases = new Map<string, { projectPath: string; poolIndex: number }>()
  private drainingQueue = false
  private powerSaveBlockerId: number | null = null

  constructor(deps: ScheduleRuntimeDeps) {
    this.deps = deps
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

  sync(settings: AppSettingsV1): void {
    this.syncInternalServer(settings)
    this.startScheduler()
    this.syncPowerSaveBlocker(settings)
    void this.ensureNextRuns(settings).then(() => this.drainQueue())
  }

  stop(): void {
    if (this.scheduler) {
      clearInterval(this.scheduler)
      this.scheduler = null
    }
    this.closeInternalServer()
    this.stopPowerSaveBlocker()
  }

  async status(): Promise<ScheduleRuntimeStatus> {
    const settings = await this.deps.store.load()
    return {
      internalServerRunning: this.server !== null,
      internalUrl: internalUrl(settings),
      runningTaskIds: [...this.runningTaskIds],
      queuedTaskIds: [...this.queuedTaskIds],
      powerSaveBlockerActive: this.isPowerSaveBlockerActive()
    }
  }

  async runTask(taskId: string): Promise<ScheduleRunResult> {
    const settings = await this.deps.store.load()
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
    if (dependenciesReady && this.runningTaskIds.size < MAX_CONCURRENT_BACKGROUND_TASKS) {
      return this.runTaskInternal(task, false)
    }
    await this.enqueueTask(task, false)
    return { ok: true, threadId: '', queued: true, message: 'Task queued.' }
  }

  async createScheduledTaskFromText(
    text: string,
    options: {
      workspaceRoot?: string | null
      clawChannelId?: string | null
      providerId?: string | null
      modelHint?: string | null
      reasoningEffort?: ScheduleReasoningEffort | null
      mode?: ScheduleRunMode | null
    } = {}
  ): Promise<ScheduleTaskFromTextResult> {
    const settings = await this.deps.store.load()
    try {
      const clawChannel = this.resolveClawChannel(settings, options.clawChannelId)
      const modelConfig = this.resolveScheduleModelConfig(settings, {
        providerId: options.providerId ?? settings.schedule.providerId,
        model: options.modelHint?.trim() || clawChannel?.model.trim() || settings.schedule.model || DEFAULT_SCHEDULE_MODEL,
        reasoningEffort: options.reasoningEffort ?? DEFAULT_SCHEDULE_REASONING_EFFORT
      })
      const request = await detectClawScheduledTaskRequest(
        settings,
        text,
        modelConfig.model
      )
      if (!request) return { kind: 'noop' }
      const task = buildScheduledTaskFromDetectedRequest({
        request,
        workspaceRoot:
          options.workspaceRoot?.trim() ||
          (clawChannel ? this.resolveClawChannelWorkspaceRoot(settings, clawChannel) : this.resolveDefaultWorkspaceRoot(settings)),
        providerId: modelConfig.providerId,
        model: modelConfig.model,
        reasoningEffort: modelConfig.reasoningEffort,
        mode: options.mode ?? settings.schedule.mode,
        id: randomUUID()
      })
      task.clawChannelId = clawChannel?.id ?? ''
      const saved = await this.deps.store.patch({
        schedule: {
          enabled: true,
          tasks: [...settings.schedule.tasks, task]
        }
      })
      this.sync(saved)
      return {
        kind: 'created',
        taskId: task.id,
        title: task.title,
        scheduleAt: request.scheduleAt,
        confirmationText: request.confirmationText
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      this.deps.logError('schedule-task', 'Failed to create scheduled task from text', { message, text })
      return { kind: 'error', message }
    }
  }

  async listTasks(): Promise<ScheduledTaskV1[]> {
    const settings = await this.deps.store.load()
    return settings.schedule.tasks
  }

  async createTask(task: ScheduledTaskV1): Promise<ScheduledTaskV1> {
    const settings = await this.deps.store.load()
    const saved = await this.deps.store.patch({
      schedule: {
        enabled: true,
        tasks: [...settings.schedule.tasks, task]
      }
    })
    this.sync(saved)
    return saved.schedule.tasks.find((item) => item.id === task.id) ?? task
  }

  async createTaskFromInput(input: {
    title: string
    prompt: string
    workspaceRoot?: string
    providerId?: string
    model?: string
    reasoningEffort?: ScheduleReasoningEffort
    mode?: ScheduleRunMode
    clawChannelId?: string
    enabled?: boolean
    schedule: Partial<ScheduledTaskV1['schedule']> & { kind: ScheduledTaskV1['schedule']['kind'] }
  }): Promise<ScheduledTaskV1> {
    const settings = await this.deps.store.load()
    const clawChannel = this.resolveClawChannel(settings, input.clawChannelId)
    const modelConfig = this.resolveScheduleModelConfig(settings, {
      providerId: input.providerId ?? settings.schedule.providerId,
      model: input.model?.trim() || clawChannel?.model.trim() || settings.schedule.model || DEFAULT_SCHEDULE_MODEL,
      reasoningEffort: input.reasoningEffort ?? DEFAULT_SCHEDULE_REASONING_EFFORT
    })
    const now = new Date().toISOString()
    const task: ScheduledTaskV1 = {
      id: randomUUID(),
      title: input.title.trim() || 'New scheduled task',
      enabled: input.enabled !== false,
      prompt: input.prompt,
      workspaceRoot:
        input.workspaceRoot?.trim() ||
        (clawChannel ? this.resolveClawChannelWorkspaceRoot(settings, clawChannel) : this.resolveDefaultWorkspaceRoot(settings)),
      clawChannelId: clawChannel?.id ?? '',
      providerId: modelConfig.providerId,
      model: modelConfig.model,
      reasoningEffort: modelConfig.reasoningEffort,
      mode: input.mode ?? settings.schedule.mode,
      priority: 0,
      dependsOn: [],
      useWorktree: false,
      schedule: {
        kind: input.schedule.kind,
        everyMinutes: typeof input.schedule.everyMinutes === 'number' ? input.schedule.everyMinutes : 60,
        timeOfDay: input.schedule.timeOfDay?.trim() || '09:00',
        atTime: input.schedule.atTime?.trim() || ''
      },
      createdAt: now,
      updatedAt: now,
      lastRunAt: '',
      nextRunAt: '',
      lastStatus: 'idle',
      lastMessage: '',
      lastThreadId: ''
    }
    const saved = await this.createTask(task)
    await this.ensureNextRuns(await this.deps.store.load())
    return saved
  }

  async updateTaskById(taskId: string, patch: Partial<ScheduledTaskV1>): Promise<ScheduledTaskV1 | null> {
    const settings = await this.deps.store.load()
    const task = settings.schedule.tasks.find((item) => item.id === taskId)
    if (!task) return null
    const now = new Date().toISOString()
    const shouldRecomputeNextRun =
      Object.prototype.hasOwnProperty.call(patch, 'enabled') || patch.schedule !== undefined
    const nextTask: ScheduledTaskV1 = {
      ...task,
      ...patch,
      schedule: patch.schedule ? { ...task.schedule, ...patch.schedule } : task.schedule,
      ...(shouldRecomputeNextRun ? { nextRunAt: '' } : {}),
      updatedAt: now
    }
    const saved = await this.deps.store.patch({
      schedule: {
        tasks: settings.schedule.tasks.map((item) => (item.id === taskId ? nextTask : item))
      }
    })
    this.sync(saved)
    return saved.schedule.tasks.find((item) => item.id === taskId) ?? nextTask
  }

  async deleteTaskById(taskId: string): Promise<boolean> {
    const settings = await this.deps.store.load()
    if (!settings.schedule.tasks.some((item) => item.id === taskId)) return false
    const saved = await this.deps.store.patch({
      schedule: {
        tasks: settings.schedule.tasks.filter((item) => item.id !== taskId)
      }
    })
    this.sync(saved)
    return saved.schedule.tasks.every((item) => item.id !== taskId)
  }

  private startScheduler(): void {
    if (this.scheduler) return
    this.scheduler = setInterval(() => {
      void this.tick()
    }, SCHEDULER_INTERVAL_MS)
    this.scheduler.unref?.()
    void this.tick()
  }

  private async tick(): Promise<void> {
    const settings = await this.deps.store.load()
    if (!settings.schedule.enabled) return
    await this.ensureNextRuns(settings)
    const fresh = await this.deps.store.load()
    const now = Date.now()
    const dueTasks = fresh.schedule.tasks
      .filter((task) => task.enabled && task.schedule.kind !== 'manual')
      .filter((task) => !this.runningTaskIds.has(task.id) && !this.queuedTaskIds.has(task.id))
      .filter((task) => {
        const dueAt = Date.parse(task.nextRunAt)
        return Number.isFinite(dueAt) && dueAt <= now
      })
      .sort((left, right) => (right.priority ?? 0) - (left.priority ?? 0) || left.createdAt.localeCompare(right.createdAt))
    for (const task of dueTasks) {
      await this.enqueueTask(task, true)
    }
  }

  private async ensureNextRuns(settings: AppSettingsV1): Promise<void> {
    if (!settings.schedule.enabled) {
      this.syncPowerSaveBlocker(settings)
      return
    }
    let changed = false
    const now = new Date()
    const tasks = settings.schedule.tasks.map((task) => {
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
    if (!changed) {
      this.syncPowerSaveBlocker(settings)
      return
    }
    const saved = await this.deps.store.patch({ schedule: { ...settings.schedule, tasks } })
    this.syncPowerSaveBlocker(saved)
  }

  private async updateTask(
    taskId: string,
    updater: (task: ScheduledTaskV1, settings: AppSettingsV1) => ScheduledTaskV1
  ): Promise<AppSettingsV1> {
    const settings = await this.deps.store.load()
    const tasks = settings.schedule.tasks.map((task) => task.id === taskId ? updater(task, settings) : task)
    const saved = await this.deps.store.patch({ schedule: { ...settings.schedule, tasks } })
    this.syncPowerSaveBlocker(saved)
    return saved
  }

  private async enqueueTask(task: ScheduledTaskV1, scheduled: boolean): Promise<void> {
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

  private async drainQueue(): Promise<void> {
    if (this.drainingQueue) return
    this.drainingQueue = true
    try {
      while (
        this.runningTaskIds.size < MAX_CONCURRENT_BACKGROUND_TASKS &&
        this.queuedTaskIds.size > 0
      ) {
        const settings = await this.deps.store.load()
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
            continue
          }
          const dependencies = (task.dependsOn ?? [])
            .map((id) => settings.schedule.tasks.find((candidate) => candidate.id === id))
          if (
            hasTaskDependencyCycle(task.id, settings.schedule.tasks) ||
            dependencies.some((dependency) => !dependency || dependency.lastStatus === 'error')
          ) {
            this.queuedTaskIds.delete(task.id)
            this.queuedTaskModes.delete(task.id)
            await this.updateTask(task.id, (current) => ({
              ...current,
              lastStatus: 'error',
              lastMessage: hasTaskDependencyCycle(task.id, settings.schedule.tasks)
                ? 'Task dependencies contain a cycle.'
                : 'A required task is missing or failed.',
              updatedAt: new Date().toISOString()
            }))
            continue
          }
          if (dependencies.every((dependency) => dependency?.lastStatus === 'success')) {
            next = task
            break
          }
        }
        if (!next) break
        const scheduled = this.queuedTaskModes.get(next.id) ?? false
        this.queuedTaskIds.delete(next.id)
        this.queuedTaskModes.delete(next.id)
        void this.runTaskInternal(next, scheduled).finally(() => {
          void this.drainQueue()
        })
      }
    } finally {
      this.drainingQueue = false
    }
  }

  private async runTaskInternal(task: ScheduledTaskV1, scheduled: boolean): Promise<ScheduleRunResult> {
    if (this.runningTaskIds.has(task.id)) {
      return { ok: false, message: 'Task is already running.' }
    }
    if (scheduled && (!task.enabled || task.schedule.kind === 'manual')) {
      return { ok: false, message: 'Task is not scheduled.' }
    }
    if (!task.prompt.trim()) {
      return { ok: false, message: 'Task prompt is empty.' }
    }

    this.runningTaskIds.add(task.id)
    await this.updateTask(task.id, (current) => ({
      ...current,
      lastStatus: 'running',
      lastMessage: 'Running',
      nextRunAt: '',
      updatedAt: new Date().toISOString()
    }))

    try {
      const settings = await this.deps.store.load()
      const clawChannel = this.resolveTaskClawChannel(settings, task)
      let workspaceRoot = this.resolveTaskWorkspaceRoot(settings, task, clawChannel)
      if (task.useWorktree) {
        const projectPath = workspaceRoot
        const poolIndex = await findAvailablePoolIndex({ projectPath })
        if (poolIndex === null) throw new Error('No worktree pool slot is available.')
        const worktree = await acquireWorktree({ projectPath, poolIndex, taskId: task.id })
        workspaceRoot = worktree.path
        this.worktreeLeases.set(task.id, { projectPath, poolIndex })
      }
      const modelConfig = this.resolveScheduleModelConfig(settings, {
        providerId: task.providerId,
        model: task.model,
        reasoningEffort: task.reasoningEffort
      })
      const result = await this.runPrompt(settings, {
        prompt: task.prompt,
        title: scheduledThreadTitle(task.title),
        workspaceRoot,
        model: modelConfig.model,
        ...(modelConfig.providerId ? { providerId: modelConfig.providerId } : {}),
        reasoningEffort: modelConfig.reasoningEffort,
        mode: task.mode,
        clawChannel,
        waitForResult: false,
        responseTimeoutMs: TASK_RESPONSE_TIMEOUT_MS
      })
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
      void this.monitorTaskTurn(task.id, result.threadId, result.turnId ?? '')
      return result
    } catch (error) {
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

  private async monitorTaskTurn(taskId: string, threadId: string, turnId: string): Promise<void> {
    try {
      const settings = await this.deps.store.load()
      const task = settings.schedule.tasks.find((item) => item.id === taskId)
      const text = await this.waitForAssistantText(
        settings,
        threadId,
        turnId,
        TASK_RESPONSE_TIMEOUT_MS,
        task?.workspaceRoot || this.resolveDefaultWorkspaceRoot(settings)
      )
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

  private runPrompt(settings: AppSettingsV1, options: RunPromptOptions): Promise<ScheduleRunResult> {
    const prompt = options.clawChannel
      ? buildClawRuntimePrompt(settings, options.prompt, { channel: options.clawChannel })
      : buildScheduleRuntimePrompt(settings, options.prompt)
    return runPromptViaRuntime(this.deps, settings, {
      prompt,
      title: options.title,
      workspaceRoot: options.workspaceRoot.trim() || this.resolveDefaultWorkspaceRoot(settings),
      model: options.model,
      ...(options.providerId ? { providerId: options.providerId } : {}),
      reasoningEffort: options.reasoningEffort,
      mode: options.mode,
      waitForResult: options.waitForResult,
      responseTimeoutMs: options.responseTimeoutMs
    })
  }

  private waitForAssistantText(
    settings: AppSettingsV1,
    threadId: string,
    turnId: string,
    timeoutMs: number,
    workspaceRoot?: string
  ): Promise<string> {
    void workspaceRoot
    return waitForAssistantTextViaRuntime(this.deps, settings, threadId, turnId, timeoutMs)
  }

  private resolveDefaultWorkspaceRoot(settings: AppSettingsV1): string {
    return settings.schedule.defaultWorkspaceRoot.trim() || settings.workspaceRoot
  }

  private resolveClawChannel(settings: AppSettingsV1, channelId: string | null | undefined): ClawImChannelV1 | null {
    const id = channelId?.trim()
    if (!id) return null
    return settings.claw.channels.find((channel) => channel.id === id) ?? null
  }

  private resolveTaskClawChannel(settings: AppSettingsV1, task: ScheduledTaskV1): ClawImChannelV1 | null {
    return this.resolveClawChannel(settings, task.clawChannelId)
  }

  private resolveClawChannelWorkspaceRoot(settings: AppSettingsV1, channel: ClawImChannelV1): string {
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

  private syncInternalServer(settings: AppSettingsV1): void {
    const internal = settings.schedule.internal
    const key = `${internal.port}`
    if (this.server && this.serverKey === key) return
    this.closeInternalServer()

    const server = createServer((req, res) => {
      void this.handleInternalRequest(req, res)
    })
    server.on('error', (error) => {
      this.deps.logError('schedule-server', 'Schedule internal server failed', {
        message: error instanceof Error ? error.message : String(error)
      })
      if (this.server === server) {
        this.closeInternalServer()
      }
    })
    server.listen(internal.port, '127.0.0.1')
    this.server = server
    this.serverKey = key
  }

  private closeInternalServer(): void {
    if (!this.server) return
    const server = this.server
    this.server = null
    this.serverKey = ''
    server.close()
  }

  private async handleInternalRequest(req: IncomingMessage, res: ServerResponse): Promise<void> {
    try {
      const settings = await this.deps.store.load()
      const url = new URL(req.url ?? '/', 'http://127.0.0.1')
      if (!url.pathname.startsWith('/schedule/internal/')) {
        writeJson(res, 404, { ok: false, message: 'Not found.' })
        return
      }
      if (req.method !== 'POST') {
        writeJson(res, 405, { ok: false, message: 'Method not allowed.' })
        return
      }
      const secret = settings.schedule.internal.secret.trim()
      if (secret) {
        const auth = req.headers.authorization ?? ''
        // 新名字 x-kun-secret 优先;旧名字 x-deepseek-gui-secret 已配置
        // 在外部系统里,属于对外契约,必须长期兼容。
        const rawHeaderSecret = req.headers['x-kun-secret'] ?? req.headers['x-deepseek-gui-secret']
        const headerSecret = Array.isArray(rawHeaderSecret) ? rawHeaderSecret[0] : rawHeaderSecret
        if (auth !== `Bearer ${secret}` && headerSecret !== secret) {
          writeJson(res, 401, { ok: false, message: 'Unauthorized.' })
          return
        }
      }

      if (url.pathname === '/schedule/internal/list') {
        const tasks = await this.listTasks()
        writeJson(res, 200, { ok: true, tasks })
        return
      }

      const body = await readRequestBody(req)
      const payload = parseJsonObject(body)
      if (!payload) {
        writeJson(res, 400, { ok: false, message: 'Expected a JSON object.' })
        return
      }

      if (url.pathname === '/schedule/internal/create') {
        const input = nestedRecord(payload.input)
        if (!input || Object.keys(input).length === 0) {
          writeJson(res, 400, { ok: false, message: 'Missing task input.' })
          return
        }
        const title = asString(input.title)
        const prompt = asString(input.prompt)
        const schedule = nestedRecord(input.schedule)
        const kind = asString(schedule.kind) as ScheduledTaskV1['schedule']['kind']
        if (!prompt || !kind) {
          writeJson(res, 400, { ok: false, message: 'Missing prompt or schedule.kind.' })
          return
        }
        const saved = await this.createTaskFromInput({
          title,
          prompt,
          workspaceRoot: asString(input.workspaceRoot) || undefined,
          clawChannelId: asString(input.clawChannelId) || undefined,
          providerId: asString(input.providerId) || undefined,
          model: asString(input.model) || undefined,
          reasoningEffort: (asString(input.reasoningEffort) as ScheduleReasoningEffort) || undefined,
          mode: (asString(input.mode) as ScheduleRunMode) || undefined,
          enabled: input.enabled === false ? false : true,
          schedule: {
            kind,
            everyMinutes: Number(schedule.everyMinutes),
            timeOfDay: asString(schedule.timeOfDay),
            atTime: asString(schedule.atTime)
          }
        })
        writeJson(res, 200, { ok: true, task: saved })
        return
      }

      if (url.pathname === '/schedule/internal/update') {
        const taskId = asString(payload.taskId)
        const patch = nestedRecord(payload.patch)
        if (!taskId) {
          writeJson(res, 400, { ok: false, message: 'Missing taskId.' })
          return
        }
        const updated = await this.updateTaskById(taskId, patch as Partial<ScheduledTaskV1>)
        if (!updated) {
          writeJson(res, 404, { ok: false, message: 'Task not found.' })
          return
        }
        writeJson(res, 200, { ok: true, task: updated })
        return
      }

      if (url.pathname === '/schedule/internal/delete') {
        const taskId = asString(payload.taskId)
        if (!taskId) {
          writeJson(res, 400, { ok: false, message: 'Missing taskId.' })
          return
        }
        const removed = await this.deleteTaskById(taskId)
        writeJson(res, removed ? 200 : 404, removed ? { ok: true } : { ok: false, message: 'Task not found.' })
        return
      }

      writeJson(res, 404, { ok: false, message: 'Not found.' })
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      this.deps.logError('schedule-server', 'Schedule internal request failed', { message })
      writeJson(res, 500, { ok: false, message: 'Internal server error.' })
    }
  }

  private syncPowerSaveBlocker(settings: AppSettingsV1): void {
    const shouldKeepAwake =
      settings.schedule.keepAwake &&
      settings.schedule.enabled &&
      hasEnabledScheduledTask(settings)
    if (!shouldKeepAwake) {
      this.stopPowerSaveBlocker()
      return
    }
    if (this.isPowerSaveBlockerActive()) return
    const blocker = this.deps.powerSaveBlocker
    if (!blocker) return
    this.powerSaveBlockerId = blocker.start('prevent-app-suspension')
  }

  private stopPowerSaveBlocker(): void {
    const blocker = this.deps.powerSaveBlocker
    const id = this.powerSaveBlockerId
    this.powerSaveBlockerId = null
    if (!blocker || id == null) return
    try {
      if (blocker.isStarted(id)) blocker.stop(id)
    } catch (error) {
      this.deps.logError('schedule-power-save', 'Failed to stop power save blocker', {
        message: error instanceof Error ? error.message : String(error)
      })
    }
  }

  private isPowerSaveBlockerActive(): boolean {
    const blocker = this.deps.powerSaveBlocker
    const id = this.powerSaveBlockerId
    if (!blocker || id == null) return false
    try {
      return blocker.isStarted(id)
    } catch {
      return false
    }
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

export function createScheduleRuntime(deps: ScheduleRuntimeDeps): ScheduleRuntime {
  return new ScheduleRuntime(deps)
}
