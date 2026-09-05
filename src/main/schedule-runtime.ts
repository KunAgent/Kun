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
  type PowerSaveControllerLike,
  type RunPromptOptions,
  type ScheduleModelConfig,
  type ScheduleRuntimeDeps
} from './schedule-runtime-helpers'
import {
  acquireWorktree,
  findAvailablePoolIndex,
  releaseWorktree
} from './services/worktree-service'
import { PowerSaveController } from './power-save-controller'

export { computeScheduleNextRunAt } from './schedule-runtime-helpers'

import {
  ScheduleExecutionQueue,
  hasTaskDependencyCycle,
  scheduledThreadTitle
} from './schedule-runtime-queue'
import { boundThreadTasksForStatus } from './schedule-runtime-status'

export {
  hasTaskDependencyCycle,
  scheduledThreadTitle
} from './schedule-runtime-queue'
export class ScheduleRuntime {
  private readonly deps: ScheduleRuntimeDeps
  private scheduler: ReturnType<typeof setInterval> | null = null
  private server: Server | null = null
  private serverKey = ''
  private readonly queue: ScheduleExecutionQueue
  private readonly powerSaveController: PowerSaveControllerLike | null
  private keepAwakeHeld = false
  private stopped = false
  private stopPromise: Promise<void> | null = null
  private readonly statusListeners = new Set<(status: ScheduleRuntimeStatus) => void>()

  constructor(deps: ScheduleRuntimeDeps) {
    this.deps = deps
    this.queue = new ScheduleExecutionQueue(deps, (settings) => {
      this.syncPowerSaveBlocker(settings)
      void this.emitStatus()
    })
    this.powerSaveController =
      deps.powerSaveController ??
      (deps.powerSaveBlocker ? new PowerSaveController(deps.powerSaveBlocker) : null)
  }

  /** @internal Compatibility seams used by the existing runtime characterization tests. */
  private get runningTaskIds(): Set<string> {
    return this.queue.runningSet()
  }

  private get ensureNextRuns(): ScheduleExecutionQueue['ensureNextRuns'] {
    return this.queue.ensureNextRuns.bind(this.queue)
  }

  private get runPrompt(): ScheduleExecutionQueue['runPrompt'] {
    return this.queue.runPrompt.bind(this.queue)
  }

  private get runTaskInternal(): ScheduleExecutionQueue['runTaskInternal'] {
    return this.queue.runTaskInternal.bind(this.queue)
  }

  private set runTaskInternal(value: ScheduleExecutionQueue['runTaskInternal']) {
    this.queue.runTaskInternal = value
  }

  private get monitorTaskTurn(): ScheduleExecutionQueue['monitorTaskTurn'] {
    return this.queue.monitorTaskTurn.bind(this.queue)
  }

  private set monitorTaskTurn(value: ScheduleExecutionQueue['monitorTaskTurn']) {
    this.queue.monitorTaskTurn = value
  }

  private get waitForAssistantText(): ScheduleExecutionQueue['waitForAssistantText'] {
    return this.queue.waitForAssistantText.bind(this.queue)
  }

  private set waitForAssistantText(value: ScheduleExecutionQueue['waitForAssistantText']) {
    this.queue.waitForAssistantText = value
  }

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

  sync(settings: AppSettingsV1): void {
    if (this.stopped) return
    this.syncInternalServer(settings)
    this.startScheduler()
    this.syncPowerSaveBlocker(settings)
    void this.queue.ensureNextRuns(settings).then(() => this.queue.drainQueue())
  }

  stop(): Promise<void> {
    if (this.stopPromise) return this.stopPromise
    this.stopped = true
    if (this.scheduler) {
      clearInterval(this.scheduler)
      this.scheduler = null
    }
    this.closeInternalServer()
    this.releasePowerSave()
    this.stopPromise = this.queue.stop()
    return this.stopPromise
  }

  subscribeStatus(listener: (status: ScheduleRuntimeStatus) => void): () => void {
    this.statusListeners.add(listener)
    void this.status().then(listener)
    return () => this.statusListeners.delete(listener)
  }

  private async emitStatus(): Promise<void> {
    if (this.statusListeners.size === 0) return
    const status = await this.status()
    for (const listener of this.statusListeners) listener(status)
  }

  async status(): Promise<ScheduleRuntimeStatus> {
    const settings = await this.loadSettings()
    const runningTaskIds = this.queue.runningIds()
    const queuedTaskIds = this.queue.queuedIds()
    return {
      internalServerRunning: this.server !== null,
      internalUrl: internalUrl(settings),
      runningTaskIds,
      queuedTaskIds,
      boundThreadTasks: boundThreadTasksForStatus(settings.schedule.tasks, runningTaskIds, queuedTaskIds),
      powerSaveBlockerActive: this.isPowerSaveBlockerActive()
    }
  }


  async runTask(taskId: string): Promise<ScheduleRunResult> {
    return this.queue.runTask(taskId)
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
    const settings = await this.loadSettings()
    try {
      const clawChannel = this.queue.resolveClawChannel(settings, options.clawChannelId)
      const modelConfig = this.resolveScheduleModelConfig(settings, {
        providerId: options.providerId ?? settings.schedule.providerId,
        model: options.modelHint?.trim() || clawChannel?.model.trim() || settings.schedule.model || DEFAULT_SCHEDULE_MODEL,
        reasoningEffort: options.reasoningEffort ?? DEFAULT_SCHEDULE_REASONING_EFFORT
      })
      const request = await detectClawScheduledTaskRequest(
        settings,
        text,
        modelConfig.model,
        new Date(),
        modelConfig.providerId
      )
      if (!request) return { kind: 'noop' }
      const task = buildScheduledTaskFromDetectedRequest({
        request,
        workspaceRoot:
          options.workspaceRoot?.trim() ||
          (clawChannel ? this.queue.resolveClawChannelWorkspaceRoot(settings, clawChannel) : this.queue.resolveDefaultWorkspaceRoot(settings)),
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
    const settings = await this.loadSettings()
    return settings.schedule.tasks
  }

  async createTask(task: ScheduledTaskV1): Promise<ScheduledTaskV1> {
    const saved = await this.deps.store.update((current) => ({
      ...current,
      schedule: {
        ...current.schedule,
        enabled: true,
        keepAwake: true,
        tasks: [...current.schedule.tasks, task]
      }
    }))
    this.sync(saved)
    return saved.schedule.tasks.find((item) => item.id === task.id) ?? task
  }

  async createTaskFromInput(input: {
    title: string
    prompt: string
    workspaceRoot?: string
    sourcePlanId?: string
    sourceThreadId?: string
    providerId?: string
    model?: string
    reasoningEffort?: ScheduleReasoningEffort
    mode?: ScheduleRunMode
    orchestration?: 'direct' | 'graph'
    clawChannelId?: string
    enabled?: boolean
    schedule: Partial<ScheduledTaskV1['schedule']> & { kind: ScheduledTaskV1['schedule']['kind'] }
  }): Promise<ScheduledTaskV1> {
    const settings = await this.loadSettings()
    const clawChannel = this.queue.resolveClawChannel(settings, input.clawChannelId)
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
        (clawChannel ? this.queue.resolveClawChannelWorkspaceRoot(settings, clawChannel) : this.queue.resolveDefaultWorkspaceRoot(settings)),
      sourcePlanId: input.sourcePlanId?.trim() || '',
      sourceThreadId: input.sourceThreadId?.trim() || '',
      clawChannelId: clawChannel?.id ?? '',
      providerId: modelConfig.providerId,
      model: modelConfig.model,
      reasoningEffort: modelConfig.reasoningEffort,
      mode: input.mode ?? settings.schedule.mode,
      orchestration: input.orchestration ?? 'direct',
      priority: 0,
      dependsOn: [],
      useWorktree: false,
      schedule: {
        kind: input.schedule.kind,
        everyMinutes: typeof input.schedule.everyMinutes === 'number' ? input.schedule.everyMinutes : 60,
        timeOfDay: input.schedule.timeOfDay?.trim() || '09:00',
        atTime: input.schedule.atTime?.trim() || '',
        ...(input.schedule.timeZone?.trim() ? { timeZone: input.schedule.timeZone.trim() } : {})
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
    await this.queue.ensureNextRuns(await this.loadSettings())
    return saved
  }

  async updateTaskById(
    taskId: string,
    patch: Omit<Partial<ScheduledTaskV1>, 'schedule'> & { schedule?: Partial<ScheduledTaskV1['schedule']> }
  ): Promise<ScheduledTaskV1 | null> {
    const settings = await this.loadSettings()
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
    if (shouldRecomputeNextRun) await this.queue.ensureNextRuns(await this.loadSettings())
    const latest = await this.loadSettings()
    return latest.schedule.tasks.find((item) => item.id === taskId) ?? nextTask
  }

  async deleteTaskById(taskId: string): Promise<boolean> {
    const settings = await this.loadSettings()
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
    if (this.stopped) return
    const settings = await this.loadSettings()
    if (!settings.schedule.enabled) return
    await this.queue.ensureNextRuns(settings)
    const fresh = await this.loadSettings()
    const now = Date.now()
    const dueTasks = fresh.schedule.tasks
      .filter((task) => task.enabled && task.schedule.kind !== 'manual')
      .filter((task) => !this.queue.hasRunning(task.id) && !this.queue.hasQueued(task.id))
      .filter((task) => {
        const dueAt = Date.parse(task.nextRunAt)
        return Number.isFinite(dueAt) && dueAt <= now
      })
      .sort((left, right) => (right.priority ?? 0) - (left.priority ?? 0) || left.createdAt.localeCompare(right.createdAt))
    for (const task of dueTasks) {
      await this.queue.enqueueTask(task, true)
    }
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
      const settings = await this.loadSettings()
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
    if (shouldKeepAwake) this.acquirePowerSave()
    else this.releasePowerSave()
  }

  private acquirePowerSave(): void {
    if (this.keepAwakeHeld || !this.powerSaveController) return
    this.keepAwakeHeld = this.powerSaveController.acquire()
  }

  private releasePowerSave(): void {
    if (!this.keepAwakeHeld || !this.powerSaveController) return
    this.powerSaveController.release()
    this.keepAwakeHeld = false
  }

  private isPowerSaveBlockerActive(): boolean {
    return this.powerSaveController?.isActive() ?? false
  }
}


export function createScheduleRuntime(deps: ScheduleRuntimeDeps): ScheduleRuntime {
  return new ScheduleRuntime(deps)
}
