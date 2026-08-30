import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  defaultClawSettings,
  defaultDesignSettings,
  defaultKeyboardShortcuts,
  defaultKunRuntimeSettings,
  defaultModelProviderSettings,
  defaultScheduleSettings,
  defaultTerminalSettings,
  defaultWorkflowSettings,
  defaultWriteSettings,
  mergeScheduleSettings,
  type AppSettingsPatch,
  type AppSettingsV1,
  type ScheduledTaskV1
} from '../shared/app-settings'
import { ScheduleRuntime } from './schedule-runtime'
let workspaceRoot = ''
function scheduledSendTask(overrides: Partial<ScheduledTaskV1> = {}): ScheduledTaskV1 {
  const base = {
    id: 'scheduled-send-1',
    title: 'Continue investigation',
    enabled: true,
    prompt: 'Continue the existing investigation',
    workspaceRoot,
    sourceThreadId: 'thread-existing',
    clawChannelId: '',
    providerId: 'deepseek',
    model: 'deepseek-v4-flash',
    reasoningEffort: 'high',
    mode: 'agent',
    orchestration: 'direct',
    priority: 0,
    dependsOn: [],
    useWorktree: false,
    scheduledSend: {
      kind: 'thread-send',
      clientRequestId: 'scheduled-send:scheduled-send-1',
      accountId: 'account-a',
      attachmentIds: ['attachment-a', 'attachment-b'],
      attemptCount: 0,
      maxAttempts: 3
    },
    schedule: { kind: 'manual', everyMinutes: 60, timeOfDay: '09:00', atTime: '' },
    createdAt: '2026-08-30T00:00:00.000Z',
    updatedAt: '2026-08-30T00:00:00.000Z',
    lastRunAt: '',
    nextRunAt: '',
    lastStatus: 'idle',
    lastMessage: '',
    lastThreadId: ''
  } as ScheduledTaskV1
  return {
    ...base,
    ...overrides,
    scheduledSend: overrides.scheduledSend ?? base.scheduledSend,
    schedule: overrides.schedule ?? base.schedule
  }
}
function settingsWith(taskOrTasks: ScheduledTaskV1 | ScheduledTaskV1[]): AppSettingsV1 {
  const tasks = Array.isArray(taskOrTasks) ? taskOrTasks : [taskOrTasks]
  return {
    version: 1,
    locale: 'en',
    theme: 'system',
    uiFontScale: 0.82,
    chatContentMaxWidthPx: 896,
    composerSendKey: 'enter',
    provider: defaultModelProviderSettings(),
    agents: { kun: { ...defaultKunRuntimeSettings(), apiKey: 'test-key' } },
    workspaceRoot,
    conversationWorkspaceRoot: '~/Documents/Kun',
    log: { enabled: true, retentionDays: 7 },
    checkpointCleanup: { createEnabled: false, enabled: false, intervalDays: 3 },
    notifications: { turnComplete: true },
    appBehavior: { openAtLogin: false, startMinimized: false, closeToTray: false },
    keyboardShortcuts: defaultKeyboardShortcuts(),
    write: defaultWriteSettings(),
    claw: defaultClawSettings(),
    schedule: mergeScheduleSettings(defaultScheduleSettings(), { enabled: true, tasks }),
    workflow: defaultWorkflowSettings(),
    design: defaultDesignSettings(),
    terminal: defaultTerminalSettings(),
    guiUpdate: { channel: 'stable' },
    codePromptPrefix: '',
    chatWelcomeMessage: '',
    codeAgentPresets: [],
    disabledSkillIds: []
  }
}
function createStore(initial: AppSettingsV1) {
  let current = initial
  return {
    read: () => current,
    load: vi.fn(async () => current),
    patch: vi.fn(async (partial: AppSettingsPatch) => {
      current = {
        ...current,
        schedule: mergeScheduleSettings(current.schedule, partial.schedule)
      }
      return current
    }),
    update: vi.fn(async (
      mutation: (settings: AppSettingsV1) => AppSettingsV1 | Promise<AppSettingsV1>
    ) => {
      current = await mutation(current)
      return current
    })
  }
}
describe('ScheduleRuntime existing-thread scheduled send', () => {
  beforeEach(() => {
    workspaceRoot = mkdtempSync(join(tmpdir(), 'kun-scheduled-send-'))
  })
  afterEach(() => {
    vi.useRealTimers()
    rmSync(workspaceRoot, { recursive: true, force: true })
    workspaceRoot = ''
  })
  it('posts the frozen request snapshot to the existing thread with a retry-stable admission key', async () => {
    const task = scheduledSendTask()
    const settings = settingsWith(task)
    const requests: Array<Record<string, unknown>> = []
    const runtimeRequest = vi.fn(async (
      _settings: AppSettingsV1,
      path: string,
      init: { method?: string; body?: string }
    ) => {
      expect(path).toBe('/v1/threads/thread-existing/turns')
      expect(init.method).toBe('POST')
      requests.push(JSON.parse(init.body ?? '{}'))
      return requests.length === 1
        ? { ok: false, status: 400, body: 'invalid request' }
        : { ok: true, status: 202, body: JSON.stringify({ turnId: 'turn-existing' }) }
    })
    const runtime = new ScheduleRuntime({
      store: createStore(settings) as never,
      runtimeRequest: runtimeRequest as never,
      logError: vi.fn()
    })
    ;(runtime as unknown as { monitorTaskTurn: () => void }).monitorTaskTurn = vi.fn()
    await expect(runtime.runTask(task.id)).resolves.toMatchObject({ ok: false })
    await new Promise((resolve) => setTimeout(resolve, 0))
    await expect(runtime.runTask(task.id)).resolves.toMatchObject({
      ok: true,
      threadId: 'thread-existing',
      turnId: 'turn-existing'
    })
    expect(requests).toHaveLength(2)
    expect(requests[0]).toMatchObject({
      prompt: expect.stringContaining('Continue the existing investigation'),
      providerId: 'deepseek',
      accountId: 'account-a',
      model: 'deepseek-v4-flash',
      reasoningEffort: 'high',
      attachmentIds: ['attachment-a', 'attachment-b']
    })
    expect(requests[0]?.clientRequestId).toEqual(expect.any(String))
    expect(requests[1]?.clientRequestId).toBe(requests[0]?.clientRequestId)
    expect(runtimeRequest.mock.calls.some(([, path]) => path === '/v1/threads')).toBe(false)
  })
  it('automatically retries a transient busy response with the same admission key', async () => {
    vi.useFakeTimers()
    const task = scheduledSendTask()
    const store = createStore(settingsWith(task))
    const requests: Array<Record<string, unknown>> = []
    const runtimeRequest = vi.fn(async (
      _settings: AppSettingsV1,
      path: string,
      init: { body?: string }
    ) => {
      expect(path).toBe('/v1/threads/thread-existing/turns')
      requests.push(JSON.parse(init.body ?? '{}'))
      return requests.length === 1
        ? {
            ok: false,
            status: 409,
            body: JSON.stringify({ code: 'thread_busy', message: 'thread already has an active turn' })
          }
        : { ok: true, status: 202, body: JSON.stringify({ turnId: 'turn-retried' }) }
    })
    const runtime = new ScheduleRuntime({
      store: store as never,
      runtimeRequest: runtimeRequest as never,
      logError: vi.fn()
    })
    ;(runtime as unknown as { waitForAssistantText: () => Promise<string> }).waitForAssistantText =
      vi.fn(async () => 'retried response')
    await expect(runtime.runTask(task.id)).resolves.toMatchObject({ ok: true, queued: true })
    expect(requests).toHaveLength(1)
    await vi.advanceTimersByTimeAsync(1_000)
    await vi.waitFor(() => expect(requests).toHaveLength(2))
    expect(requests[1]?.clientRequestId).toBe(requests[0]?.clientRequestId)
    expect(store.load).toHaveBeenCalled()
    await vi.waitFor(async () => {
      const persisted = (await store.load()).schedule.tasks[0]
      expect(persisted.scheduledSend?.attemptCount).toBe(2)
      expect(persisted.lastStatus).toBe('success')
    })
  })
  it('runs two sends for the same thread FIFO and never overlaps their admissions', async () => {
    const first = scheduledSendTask({
      id: 'send-first',
      prompt: 'first',
      createdAt: '2026-08-30T00:00:00.000Z',
      scheduledSend: {
        kind: 'thread-send',
        clientRequestId: 'scheduled-send:send-first',
        accountId: 'account-a',
        attachmentIds: [],
        attemptCount: 0,
        maxAttempts: 3
      }
    })
    const second = scheduledSendTask({
      id: 'send-second',
      prompt: 'second',
      createdAt: '2026-08-30T00:00:01.000Z',
      scheduledSend: {
        kind: 'thread-send',
        clientRequestId: 'scheduled-send:send-second',
        accountId: 'account-a',
        attachmentIds: [],
        attemptCount: 0,
        maxAttempts: 3
      }
    })
    let releaseFirst!: () => void
    const firstAdmission = new Promise<void>((resolve) => { releaseFirst = resolve })
    const prompts: string[] = []
    let activeAdmissions = 0
    let maxActiveAdmissions = 0
    const runtimeRequest = vi.fn(async (
      _settings: AppSettingsV1,
      path: string,
      init: { body?: string }
    ) => {
      expect(path).toBe('/v1/threads/thread-existing/turns')
      const body = JSON.parse(init.body ?? '{}') as { prompt?: string }
      prompts.push(body.prompt ?? '')
      activeAdmissions += 1
      maxActiveAdmissions = Math.max(maxActiveAdmissions, activeAdmissions)
      if (body.prompt === 'first') await firstAdmission
      activeAdmissions -= 1
      return { ok: true, status: 202, body: JSON.stringify({ turnId: `turn-${body.prompt}` }) }
    })
    const runtime = new ScheduleRuntime({
      store: createStore(settingsWith([first, second])) as never,
      runtimeRequest: runtimeRequest as never,
      logError: vi.fn()
    })
    ;(runtime as unknown as { waitForAssistantText: () => Promise<string> }).waitForAssistantText =
      vi.fn(async () => 'done')
    const firstResult = runtime.runTask(first.id)
    const secondResult = runtime.runTask(second.id)
    await vi.waitFor(() => expect(prompts).toEqual(['first']))
    releaseFirst()
    await expect(firstResult).resolves.toMatchObject({ ok: true, turnId: 'turn-first' })
    await expect(secondResult).resolves.toMatchObject({ ok: true, turnId: 'turn-second' })
    expect(prompts).toEqual(['first', 'second'])
    expect(maxActiveAdmissions).toBe(1)
  })
  it('keeps same-thread FIFO order even when the newer send has higher priority', async () => {
    const first = scheduledSendTask({
      id: 'send-fifo-first',
      prompt: 'fifo first',
      priority: 0,
      createdAt: '2026-08-30T00:00:00.000Z'
    })
    const second = scheduledSendTask({
      id: 'send-fifo-second',
      prompt: 'fifo second',
      priority: 100,
      createdAt: '2026-08-30T00:00:01.000Z',
      scheduledSend: {
        kind: 'thread-send',
        clientRequestId: 'scheduled-send:send-fifo-second',
        accountId: '',
        attachmentIds: [],
        attemptCount: 0,
        maxAttempts: 3
      }
    })
    const prompts: string[] = []
    const runtime = new ScheduleRuntime({
      store: createStore(settingsWith([first, second])) as never,
      runtimeRequest: vi.fn(async (
        _settings: AppSettingsV1,
        _path: string,
        init: { body?: string }
      ) => {
        const body = JSON.parse(init.body ?? '{}') as { prompt?: string }
        prompts.push(body.prompt ?? '')
        return { ok: true, status: 202, body: JSON.stringify({ turnId: `turn-${prompts.length}` }) }
      }) as never,
      logError: vi.fn()
    })
    ;(runtime as unknown as { waitForAssistantText: () => Promise<string> }).waitForAssistantText =
      vi.fn(async () => 'done')
    const queue = (runtime as unknown as {
      queue: { enqueueTask: (task: ScheduledTaskV1, scheduled: boolean) => Promise<void> }
    }).queue
    await Promise.all([
      queue.enqueueTask(first, false),
      queue.enqueueTask(second, false)
    ])
    await vi.waitFor(() => expect(prompts).toHaveLength(2))
    expect(prompts).toEqual(['fifo first', 'fifo second'])
  })
  it('does not immediately run a queued task after it is edited to a future time', async () => {
    vi.useFakeTimers()
    vi.setSystemTime('2026-08-30T00:00:00.000Z')
    const active = scheduledSendTask({ id: 'send-edit-active', prompt: 'edit active' })
    const rescheduled = scheduledSendTask({
      id: 'send-edit-future',
      prompt: 'edit future',
      scheduledSend: {
        kind: 'thread-send',
        clientRequestId: 'scheduled-send:send-edit-future',
        accountId: '',
        attachmentIds: [],
        attemptCount: 0,
        maxAttempts: 3
      }
    })
    let releaseActive!: () => void
    const activeAdmission = new Promise<void>((resolve) => { releaseActive = resolve })
    const prompts: string[] = []
    const runtime = new ScheduleRuntime({
      store: createStore(settingsWith([active, rescheduled])) as never,
      runtimeRequest: vi.fn(async (
        _settings: AppSettingsV1,
        _path: string,
        init: { body?: string }
      ) => {
        const body = JSON.parse(init.body ?? '{}') as { prompt?: string }
        prompts.push(body.prompt ?? '')
        if (body.prompt === 'edit active') await activeAdmission
        return { ok: true, status: 202, body: JSON.stringify({ turnId: `turn-${body.prompt}` }) }
      }) as never,
      logError: vi.fn()
    })
    ;(runtime as unknown as { waitForAssistantText: () => Promise<string> }).waitForAssistantText =
      vi.fn(async () => 'done')
    const activeResult = runtime.runTask(active.id)
    void runtime.runTask(rescheduled.id)
    await vi.waitFor(() => expect(prompts).toEqual(['edit active']))
    await runtime.updateTaskById(rescheduled.id, {
      schedule: {
        kind: 'at',
        atTime: '2026-08-30T00:01:00.000Z'
      }
    })
    releaseActive()
    await expect(activeResult).resolves.toMatchObject({ ok: true })
    await vi.advanceTimersByTimeAsync(1_000)
    expect(prompts).toEqual(['edit active'])
    await runtime.stop()
  })

  it('keeps the existing-thread send snapshot immutable when a generic editor changes payload fields', async () => {
    const task = scheduledSendTask()
    const runtime = new ScheduleRuntime({
      store: createStore(settingsWith(task)) as never,
      runtimeRequest: vi.fn() as never,
      logError: vi.fn()
    })

    await expect(runtime.updateTaskById(task.id, { prompt: 'mutated after scheduling' })).rejects.toThrow(
      'Scheduled send snapshot fields are immutable'
    )
    await expect(runtime.updateTaskById(task.id, { providerId: 'other-provider' })).rejects.toThrow(
      'Scheduled send snapshot fields are immutable'
    )
    await expect(runtime.updateTaskById(task.id, { model: 'other-model' })).rejects.toThrow(
      'Scheduled send snapshot fields are immutable'
    )
    await expect(runtime.updateTaskById(task.id, {
      scheduledSend: { ...task.scheduledSend!, attachmentIds: ['different-attachment'] }
    })).rejects.toThrow('Scheduled send snapshot fields are immutable')

    const persisted = await runtime.listTasks()
    expect(persisted[0]).toMatchObject({
      prompt: task.prompt,
      providerId: task.providerId,
      model: task.model,
      scheduledSend: task.scheduledSend
    })
    await runtime.stop()
  })
  it('removes a cancelled same-thread queued send without a ghost admission', async () => {
    const first = scheduledSendTask({ id: 'send-active', prompt: 'active' })
    const queued = scheduledSendTask({
      id: 'send-cancelled',
      prompt: 'cancelled',
      scheduledSend: {
        kind: 'thread-send',
        clientRequestId: 'scheduled-send:send-cancelled',
        accountId: '',
        attachmentIds: [],
        attemptCount: 0,
        maxAttempts: 3
      }
    })
    let releaseActive!: () => void
    const activeAdmission = new Promise<void>((resolve) => { releaseActive = resolve })
    const prompts: string[] = []
    const runtimeRequest = vi.fn(async (
      _settings: AppSettingsV1,
      _path: string,
      init: { body?: string }
    ) => {
      const body = JSON.parse(init.body ?? '{}') as { prompt?: string }
      prompts.push(body.prompt ?? '')
      if (body.prompt === 'active') await activeAdmission
      return { ok: true, status: 202, body: JSON.stringify({ turnId: `turn-${body.prompt}` }) }
    })
    const runtime = new ScheduleRuntime({
      store: createStore(settingsWith([first, queued])) as never,
      runtimeRequest: runtimeRequest as never,
      logError: vi.fn()
    })
    ;(runtime as unknown as { waitForAssistantText: () => Promise<string> }).waitForAssistantText =
      vi.fn(async () => 'done')
    const activeResult = runtime.runTask(first.id)
    const queuedResult = runtime.runTask(queued.id)
    await vi.waitFor(() => expect(prompts).toEqual(['active']))
    await expect(runtime.deleteTaskById(queued.id)).resolves.toBe(true)
    await expect(queuedResult).resolves.toEqual({
      ok: false,
      message: 'Scheduled task was cancelled.'
    })
    await expect(runtime.status()).resolves.toMatchObject({ queuedTaskIds: [] })
    releaseActive()
    await expect(activeResult).resolves.toMatchObject({ ok: true })
    await new Promise((resolve) => setTimeout(resolve, 0))
    expect(prompts).toEqual(['active'])
  })
  it('does not admit a task deleted after dequeue but before the runtime POST', async () => {
    const task = scheduledSendTask({ id: 'send-delete-race', prompt: 'delete race' })
    const store = createStore(settingsWith(task))
    let releaseLoad!: () => void
    let signalRunningLoad!: () => void
    const runningLoad = new Promise<void>((resolve) => { signalRunningLoad = resolve })
    const loadGate = new Promise<void>((resolve) => { releaseLoad = resolve })
    let gated = false
    store.load.mockImplementation(async () => {
      const current = store.read()
      if (
        !gated &&
        current.schedule.tasks.some((candidate) =>
          candidate.id === task.id && candidate.lastStatus === 'running'
        )
      ) {
        gated = true
        signalRunningLoad()
        await loadGate
      }
      return store.read()
    })
    const runtimeRequest = vi.fn(async () => ({
      ok: true,
      status: 202,
      body: JSON.stringify({ turnId: 'turn-should-not-exist' })
    }))
    const runtime = new ScheduleRuntime({
      store: store as never,
      runtimeRequest: runtimeRequest as never,
      logError: vi.fn()
    })
    ;(runtime as unknown as { waitForAssistantText: () => Promise<string> }).waitForAssistantText =
      vi.fn(async () => 'done')
    const result = runtime.runTask(task.id)
    await runningLoad
    await expect(runtime.deleteTaskById(task.id)).resolves.toBe(true)
    releaseLoad()
    await expect(result).resolves.toMatchObject({ ok: false })
    expect(runtimeRequest).not.toHaveBeenCalled()
    await expect(runtime.status()).resolves.toMatchObject({
      runningTaskIds: [],
      queuedTaskIds: []
    })
    await runtime.stop()
  })
  it('retries a status-0 fetch failure and preserves the original admission key', async () => {
    vi.useFakeTimers()
    const task = scheduledSendTask({ id: 'send-network-retry' })
    const bodies: Array<Record<string, unknown>> = []
    const runtimeRequest = vi.fn(async (
      _settings: AppSettingsV1,
      _path: string,
      init: { body?: string }
    ) => {
      bodies.push(JSON.parse(init.body ?? '{}'))
      return bodies.length === 1
        ? { ok: false, status: 0, body: 'fetch failed: ECONNRESET' }
        : { ok: true, status: 202, body: JSON.stringify({ turnId: 'turn-network-retry' }) }
    })
    const runtime = new ScheduleRuntime({
      store: createStore(settingsWith(task)) as never,
      runtimeRequest: runtimeRequest as never,
      logError: vi.fn()
    })
    ;(runtime as unknown as { waitForAssistantText: () => Promise<string> }).waitForAssistantText =
      vi.fn(async () => 'done')
    await expect(runtime.runTask(task.id)).resolves.toMatchObject({ ok: true, queued: true })
    await vi.advanceTimersByTimeAsync(1_000)
    await vi.waitFor(() => expect(bodies).toHaveLength(2))
    expect(bodies[1]?.clientRequestId).toBe(bodies[0]?.clientRequestId)
  })
  it('keeps independent retry wakeups ordered by their earliest deadline', async () => {
    vi.useFakeTimers()
    vi.setSystemTime('2026-08-30T00:00:00.000Z')
    const early = scheduledSendTask({
      id: 'send-wake-early',
      sourceThreadId: 'thread-early',
      scheduledSend: {
        kind: 'thread-send',
        clientRequestId: 'scheduled-send:send-wake-early',
        accountId: '',
        attachmentIds: [],
        attemptCount: 0,
        maxAttempts: 3
      }
    })
    const later = scheduledSendTask({
      id: 'send-wake-later',
      sourceThreadId: 'thread-later',
      scheduledSend: {
        kind: 'thread-send',
        clientRequestId: 'scheduled-send:send-wake-later',
        accountId: '',
        attachmentIds: [],
        attemptCount: 1,
        maxAttempts: 3
      }
    })
    const counts = new Map<string, number>()
    const runtimeRequest = vi.fn(async (
      _settings: AppSettingsV1,
      _path: string,
      init: { body?: string }
    ) => {
      const body = JSON.parse(init.body ?? '{}') as { clientRequestId?: string }
      const key = body.clientRequestId ?? ''
      const count = (counts.get(key) ?? 0) + 1
      counts.set(key, count)
      return count === 1
        ? { ok: false, status: 503, body: 'temporarily unavailable' }
        : { ok: true, status: 202, body: JSON.stringify({ turnId: `turn-${key}` }) }
    })
    const runtime = new ScheduleRuntime({
      store: createStore(settingsWith([early, later])) as never,
      runtimeRequest: runtimeRequest as never,
      logError: vi.fn()
    })
    ;(runtime as unknown as { waitForAssistantText: () => Promise<string> }).waitForAssistantText =
      vi.fn(async () => 'done')
    await Promise.all([runtime.runTask(early.id), runtime.runTask(later.id)])
    expect(runtimeRequest).toHaveBeenCalledTimes(2)
    await vi.advanceTimersByTimeAsync(999)
    expect(runtimeRequest).toHaveBeenCalledTimes(2)
    await vi.advanceTimersByTimeAsync(1)
    await vi.waitFor(() => expect(runtimeRequest).toHaveBeenCalledTimes(3))
    expect(counts.get('scheduled-send:send-wake-early')).toBe(2)
    expect(counts.get('scheduled-send:send-wake-later')).toBe(1)
    await vi.advanceTimersByTimeAsync(999)
    expect(runtimeRequest).toHaveBeenCalledTimes(3)
    await vi.advanceTimersByTimeAsync(1)
    await vi.waitFor(() => expect(runtimeRequest).toHaveBeenCalledTimes(4))
    expect(counts.get('scheduled-send:send-wake-later')).toBe(2)
  })
  it.each([
    ['missing provider', 400, JSON.stringify({ code: 'provider_not_found', message: 'provider was removed' })],
    ['missing account', 400, JSON.stringify({ code: 'account_not_found', message: 'account was removed' })]
  ])('treats %s as terminal without changing the frozen route', async (_label, status, responseBody) => {
    vi.useFakeTimers()
    const task = scheduledSendTask({ providerId: 'removed-provider' })
    const bodies: Array<Record<string, unknown>> = []
    const runtimeRequest = vi.fn(async (
      _settings: AppSettingsV1,
      path: string,
      init: { body?: string }
    ) => {
      expect(path).toBe('/v1/threads/thread-existing/turns')
      bodies.push(JSON.parse(init.body ?? '{}'))
      return { ok: false, status, body: responseBody }
    })
    const runtime = new ScheduleRuntime({
      store: createStore(settingsWith(task)) as never,
      runtimeRequest: runtimeRequest as never,
      logError: vi.fn()
    })
    await expect(runtime.runTask(task.id)).resolves.toMatchObject({ ok: false })
    await vi.advanceTimersByTimeAsync(30_000)
    expect(bodies).toHaveLength(1)
    expect(bodies[0]).toMatchObject({
      providerId: 'removed-provider',
      accountId: 'account-a',
      model: 'deepseek-v4-flash'
    })
    expect(runtimeRequest.mock.calls.some(([, path]) => path === '/v1/threads')).toBe(false)
  })
  it.each([
    ['sourceThreadId', { sourceThreadId: '' }],
    ['clientRequestId', {
      scheduledSend: {
        kind: 'thread-send',
        clientRequestId: '',
        accountId: '',
        attachmentIds: [],
        attemptCount: 0,
        maxAttempts: 3
      }
    }]
  ])('fails closed when persisted scheduled send %s is empty', async (_field, overrides) => {
    const task = scheduledSendTask(overrides as Partial<ScheduledTaskV1>)
    const runtimeRequest = vi.fn(async () => ({ ok: false, status: 500, body: 'unexpected request' }))
    const runtime = new ScheduleRuntime({
      store: createStore(settingsWith(task)) as never,
      runtimeRequest: runtimeRequest as never,
      logError: vi.fn()
    })
    await expect(runtime.runTask(task.id)).resolves.toMatchObject({ ok: false })
    expect(runtimeRequest).not.toHaveBeenCalled()
  })
  it('recovers interrupted running and queued scheduled sends once after restart', async () => {
    const atSchedule = {
      kind: 'at' as const,
      everyMinutes: 60,
      timeOfDay: '09:00',
      atTime: '2026-08-30T00:00:00.000Z'
    }
    const interrupted = scheduledSendTask({
      id: 'send-interrupted',
      prompt: 'interrupted',
      lastStatus: 'running',
      schedule: atSchedule
    })
    const queued = scheduledSendTask({
      id: 'send-persisted-queued',
      prompt: 'persisted queued',
      lastStatus: 'queued',
      schedule: atSchedule,
      scheduledSend: {
        kind: 'thread-send',
        clientRequestId: 'scheduled-send:send-persisted-queued',
        accountId: '',
        attachmentIds: [],
        attemptCount: 1,
        maxAttempts: 3
      }
    })
    const prompts: string[] = []
    const settings = settingsWith([interrupted, queued])
    const runtimeRequest = vi.fn(async (
      _settings: AppSettingsV1,
      _path: string,
      init: { body?: string }
    ) => {
      const body = JSON.parse(init.body ?? '{}') as { prompt?: string }
      prompts.push(body.prompt ?? '')
      return { ok: true, status: 202, body: JSON.stringify({ turnId: `turn-${prompts.length}` }) }
    })
    const runtime = new ScheduleRuntime({
      store: createStore(settings) as never,
      runtimeRequest: runtimeRequest as never,
      logError: vi.fn()
    })
    ;(runtime as unknown as { waitForAssistantText: () => Promise<string> }).waitForAssistantText =
      vi.fn(async () => 'done')
    await (runtime as unknown as {
      ensureNextRuns: (value: AppSettingsV1) => Promise<void>
    }).ensureNextRuns(settings)
    await (runtime as unknown as {
      queue: { drainQueue: () => Promise<void> }
    }).queue.drainQueue()
    await vi.waitFor(() => expect(prompts).toHaveLength(2))
    expect(prompts).toEqual(['interrupted', 'persisted queued'])
    expect(runtimeRequest).toHaveBeenCalledTimes(2)
  })
  it.each([
    [409, JSON.stringify({ code: 'conflict', message: 'thread is archived: thread-existing' })],
    [404, JSON.stringify({ code: 'not_found', message: 'thread not found: thread-existing' })]
  ])('does not create a replacement thread when the bound thread fails with %s', async (status, body) => {
    vi.useFakeTimers()
    const task = scheduledSendTask()
    const runtimeRequest = vi.fn(async (
      _settings: AppSettingsV1,
      path: string
    ) => {
      expect(path).toBe('/v1/threads/thread-existing/turns')
      return { ok: false, status, body }
    })
    const runtime = new ScheduleRuntime({
      store: createStore(settingsWith(task)) as never,
      runtimeRequest: runtimeRequest as never,
      logError: vi.fn()
    })
    await expect(runtime.runTask(task.id)).resolves.toMatchObject({ ok: false })
    await vi.advanceTimersByTimeAsync(30_000)
    expect(runtimeRequest).toHaveBeenCalledTimes(1)
    expect(runtimeRequest.mock.calls.some(([, path]) => path === '/v1/threads')).toBe(false)
  })
})
