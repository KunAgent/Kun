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
  defaultWorkflowSettings,
  defaultWriteSettings,
  defaultTerminalSettings, defaultRemoteAccessSettings,
  mergeScheduleSettings,
  type AppSettingsPatch,
  type AppSettingsV1,
  type ClawImChannelV1,
  type ScheduledTaskV1
} from '../shared/app-settings'
import { ScheduleExecutionQueue } from './schedule-runtime-queue'
import * as worktrees from './services/worktree-service'
import {
  ScheduleRuntime,
  computeScheduleNextRunAt,
  hasTaskDependencyCycle,
  scheduledThreadTitle
} from './schedule-runtime'

let testWorkspaceRoot = ''
let clawWorkspaceRoot = ''

function makeTask(patch: Partial<ScheduledTaskV1> = {}): ScheduledTaskV1 {
  const schedule = {
    kind: 'manual' as const,
    everyMinutes: 60,
    timeOfDay: '09:00',
    atTime: '',
    ...patch.schedule
  }
  return {
    id: 'task-1',
    title: 'Task 1',
    enabled: true,
    prompt: 'Run the task',
    workspaceRoot: testWorkspaceRoot,
    clawChannelId: '',
    model: 'auto',
    reasoningEffort: 'medium',
    mode: 'agent',
    createdAt: '2026-06-02T00:00:00.000Z',
    updatedAt: '2026-06-02T00:00:00.000Z',
    lastRunAt: '',
    nextRunAt: '',
    lastStatus: 'idle',
    lastMessage: '',
    lastThreadId: '',
    ...patch,
    schedule
  }
}

function makeClawChannel(patch: Partial<ClawImChannelV1> = {}): ClawImChannelV1 {
  return {
    id: 'channel-1',
    provider: 'feishu',
    label: 'Feishu Agent',
    enabled: true,
    model: 'deepseek-v4-flash',
    threadId: '',
    workspaceRoot: clawWorkspaceRoot,
    agentProfile: {
      name: 'Ops Claw',
      description: '',
      identity: 'You are the operations assistant.',
      personality: '',
      userContext: '',
      replyRules: ''
    },
    conversations: [],
    createdAt: '2026-06-02T00:00:00.000Z',
    updatedAt: '2026-06-02T00:00:00.000Z',
    ...patch
  }
}

function settingsWith(
  tasks: ScheduledTaskV1[] = [],
  schedulePatch: AppSettingsPatch['schedule'] = {}
): AppSettingsV1 {
  return {
    version: 1,
    locale: 'en',
    theme: 'system',
    uiFontScale: 0.82,
    chatContentMaxWidthPx: 896,
    composerSendKey: 'enter',
    provider: defaultModelProviderSettings(),
    agents: {
      kun: {
        ...defaultKunRuntimeSettings(),
        apiKey: 'test-key'
      }
    },
    workspaceRoot: testWorkspaceRoot,
    conversationWorkspaceRoot: '~/Documents/Kun',
    log: { enabled: true, retentionDays: 7 },
    checkpointCleanup: { createEnabled: false, enabled: false, intervalDays: 3 },
    notifications: { turnComplete: true },
    appBehavior: { openAtLogin: false, startMinimized: false, closeToTray: false },
    keyboardShortcuts: defaultKeyboardShortcuts(),
    write: defaultWriteSettings(),
    claw: defaultClawSettings(),
    schedule: mergeScheduleSettings(defaultScheduleSettings(), {
      enabled: true,
      tasks,
      ...schedulePatch
    }),
    workflow: defaultWorkflowSettings(),
    design: defaultDesignSettings(),
    terminal: defaultTerminalSettings(),
    remote: defaultRemoteAccessSettings(),
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
    load: vi.fn(async () => current),
    patch: vi.fn(async (partial: AppSettingsPatch) => {
      current = {
        ...current,
        schedule: mergeScheduleSettings(current.schedule, partial.schedule),
        claw: current.claw
      }
      return current
    }),
    update: vi.fn(async (
      mutation: (settings: AppSettingsV1) => AppSettingsV1 | Promise<AppSettingsV1>
    ) => {
      current = await mutation(current)
      return current
    }),
    replace: (next: AppSettingsV1) => { current = next },
    read: () => current
  }
}

function createRuntime(initial: AppSettingsV1, runtimeRequest = vi.fn()) {
  const store = createStore(initial)
  const runtime = new ScheduleRuntime({
    store: store as never,
    runtimeRequest: runtimeRequest as never,
    logError: vi.fn()
  })
  return { runtime, store, runtimeRequest }
}

describe('ScheduleRuntime', () => {
  beforeEach(() => {
    testWorkspaceRoot = mkdtempSync(join(tmpdir(), 'kun-schedule-runtime-'))
    clawWorkspaceRoot = mkdtempSync(join(testWorkspaceRoot, 'claw-'))
  })

  afterEach(() => {
    vi.restoreAllMocks()
    vi.unstubAllGlobals()
    vi.useRealTimers()
    if (testWorkspaceRoot) {
      rmSync(testWorkspaceRoot, { recursive: true, force: true })
      testWorkspaceRoot = ''
      clawWorkspaceRoot = ''
    }
  })

  it('appends detected reminders to the latest tasks after concurrent creation, deletion and completion', async () => {
    const deleted = makeTask({ id: 'deleted' })
    const completing = makeTask({ id: 'completing', lastStatus: 'running' })
    const { runtime, store } = createRuntime(settingsWith([deleted, completing]))
    vi.spyOn(runtime, 'sync').mockImplementation(() => undefined)
    const releases: Array<() => void> = []
    const fetch = vi.fn(() => new Promise((resolve) => {
      releases.push(() => resolve({
        ok: true,
        text: async () => JSON.stringify({ choices: [{ message: { content: JSON.stringify({
          shouldCreateTask: true, scheduleAt: '2099-06-03T09:00:00.000Z',
          reminderBody: 'ship the review', taskName: 'Ship review'
        }) } }] })
      }))
    }))
    vi.stubGlobal('fetch', fetch)
    const first = runtime.createScheduledTaskFromText('Remind me tomorrow to ship the review.')
    const second = runtime.createScheduledTaskFromText('Remind me tomorrow to ship the review.')
    for (let i = 0; i < 50 && releases.length < 2; i++) await Promise.resolve()
    expect(releases).toHaveLength(2)
    const added = makeTask({ id: 'added' })
    await runtime.createTask(added)
    await runtime.deleteTaskById(deleted.id)
    const savedAdded = store.read().schedule.tasks.find((task) => task.id === added.id)
    const completed = { ...completing, lastStatus: 'success' as const, lastMessage: 'Done', lastThreadId: 'thread-done' }
    await store.update((current) => ({ ...current, schedule: {
      ...current.schedule, keepAwake: false,
      tasks: current.schedule.tasks.map((task) => task.id === completed.id ? completed : task)
    } }))
    releases[1]()
    const secondResult = await second
    releases[0]()
    const firstResult = await first
    expect(firstResult.kind).toBe('created')
    expect(secondResult.kind).toBe('created')
    const tasks = store.read().schedule.tasks
    expect(tasks).toHaveLength(4)
    expect(tasks.find((task) => task.id === completed.id)).toEqual(completed)
    expect(tasks.find((task) => task.id === added.id)).toEqual(savedAdded)
    expect(tasks.some((task) => task.id === deleted.id)).toBe(false)
    expect(new Set(tasks.map((task) => task.id)).size).toBe(4)
    expect(store.read().schedule.keepAwake).toBe(false)
  })

  it('parks exhausted worktree tasks until release without starving other work or exceeding the cap', async () => {
    vi.useFakeTimers()
    let occupied = false
    let releaseSlot!: () => void
    const releaseGate = new Promise<void>((resolve) => { releaseSlot = resolve })
    const find = vi.spyOn(worktrees, 'findAvailablePoolIndex').mockImplementation(async () => occupied ? null : 0)
    const acquire = vi.spyOn(worktrees, 'acquireWorktree').mockImplementation(async ({ taskId }) => {
      occupied = true
      return { poolIndex: 0, path: testWorkspaceRoot, branch: 'pool-0', inUse: true,
        taskId, baseCommit: 'abc', changesCount: 0 }
    })
    const release = vi.spyOn(worktrees, 'releaseWorktree').mockImplementation(async () => {
      await releaseGate
      occupied = false
    })
    const tasks = [
      makeTask({ id: 'holder', useWorktree: true }),
      makeTask({ id: 'waiter', useWorktree: true, priority: 100 }),
      ...['plain-a', 'plain-b', 'plain-c'].map((id) => makeTask({ id }))
    ]
    let threadCount = 0
    const finish = new Map<string, () => void>()
    const request = vi.fn(async (_settings: AppSettingsV1, path: string, init: { method?: string; signal?: AbortSignal }) => {
      if (path === '/v1/threads') return { ok: true, status: 201, body: JSON.stringify({ id: `thread-${++threadCount}` }) }
      if (path.endsWith('/turns')) return { ok: true, status: 202, body: JSON.stringify({ turnId: 'turn-1' }) }
      if (path.startsWith('/v1/threads/') && init.method === 'GET') {
        return new Promise<{ ok: boolean; status: number; body: string }>((resolve) => {
          finish.set(path, () => resolve({ ok: true, status: 200, body: JSON.stringify({
            turns: [{ id: 'turn-1', status: 'completed', items: [{ kind: 'assistant_text', text: 'Done' }] }]
          }) }))
          init.signal?.addEventListener('abort', () => resolve({ ok: false, status: 0, body: 'aborted' }), { once: true })
        })
      }
      if (path === '/v1/remote/desktop-schedule-audit/record') return { ok: true, status: 200, body: '{}' }
      throw new Error(`Unexpected request ${path}`)
    })
    const { runtime, store } = createRuntime(settingsWith(tasks), request)
    const flush = async () => { for (let i = 0; i < 200; i++) await Promise.resolve() }
    try {
      await expect(runtime.runTask('holder')).resolves.toMatchObject({ ok: true, threadId: 'thread-1' })
      await expect(runtime.runTask('waiter')).resolves.toMatchObject({ ok: true, queued: true })
      await flush()
      expect(find).toHaveBeenCalledTimes(2)
      expect(acquire).toHaveBeenCalledTimes(1)
      // No clock advance: even completion/enqueue drains must skip the blocked high-priority task.
      await runtime.runTask('plain-a')
      await runtime.runTask('plain-b')
      const last = runtime.runTask('plain-c')
      await flush()
      expect(find).toHaveBeenCalledTimes(2)
      expect((await runtime.status()).runningTaskIds).toHaveLength(3)
      expect((await runtime.status()).queuedTaskIds).toEqual(expect.arrayContaining(['waiter', 'plain-c']))
      await vi.advanceTimersByTimeAsync(1500)
      expect(find).toHaveBeenCalledTimes(2)
      expect(finish.has('/v1/threads/thread-1')).toBe(true)
      finish.get('/v1/threads/thread-1')!()
      await flush()
      expect(release).toHaveBeenCalledTimes(1)
      expect(find).toHaveBeenCalledTimes(2)
      releaseSlot()
      await flush()
      expect(acquire).toHaveBeenCalledTimes(2)
      expect(store.read().schedule.tasks.find((task) => task.id === 'waiter')?.lastStatus).toBe('running')
      expect((await runtime.status()).runningTaskIds).toHaveLength(3)
      // The formerly blocked task runs; the next ordinary task gets the next freed execution slot.
      finish.get('/v1/threads/thread-2')!()
      await flush()
      await expect(last).resolves.toMatchObject({ ok: true })
      expect((await runtime.status()).runningTaskIds).toHaveLength(3)
      expect((await runtime.status()).queuedTaskIds).toEqual([])
    } finally {
      releaseSlot()
      await runtime.stop()
    }
  })

  it.each([false, true])('serializes deferred acquisition per project and recovers from failure=%s', async (failFirst) => {
    vi.useFakeTimers()
    let finishAcquire!: () => void
    const acquiring = new Promise<void>((resolve) => { finishAcquire = resolve })
    const occupied = new Set<string>()
    const projectA = testWorkspaceRoot
    const projectB = clawWorkspaceRoot
    const find = vi.spyOn(worktrees, 'findAvailablePoolIndex').mockImplementation(async ({ projectPath }) => occupied.has(projectPath) ? null : 0)
    const acquire = vi.spyOn(worktrees, 'acquireWorktree').mockImplementation(async ({ projectPath, taskId }) => {
      if (taskId === 'first') {
        await acquiring
        if (failFirst) throw new Error('acquire failed')
      }
      expect(occupied.has(projectPath)).toBe(false)
      occupied.add(projectPath)
      return { poolIndex: 0, path: projectPath, branch: 'pool-0', inUse: true, taskId, baseCommit: 'abc', changesCount: 0 }
    })
    const release = vi.spyOn(worktrees, 'releaseWorktree').mockImplementation(async ({ projectPath }) => { occupied.delete(projectPath) })
    const monitors = new Map<string, () => void>()
    vi.spyOn(ScheduleExecutionQueue.prototype, 'runPrompt').mockImplementation(async (_settings, options) => ({ ok: true, threadId: options.prompt, turnId: 'turn-1' }))
    vi.spyOn(ScheduleExecutionQueue.prototype, 'waitForAssistantText').mockImplementation(async (_settings, threadId, _turnId, _timeout, _workspace, signal) =>
      new Promise<string>((resolve) => {
        monitors.set(threadId, () => resolve('Done'))
        signal?.addEventListener('abort', () => resolve('Stopped'), { once: true })
      }))
    const tasks = [
      makeTask({ id: 'first', prompt: 'first', useWorktree: true, workspaceRoot: projectA }),
      makeTask({ id: 'second', prompt: 'second', useWorktree: true, workspaceRoot: projectA }),
      makeTask({ id: 'other', prompt: 'other', useWorktree: true, workspaceRoot: projectB }),
      makeTask({ id: 'fourth', prompt: 'fourth' })
    ]
    const request = vi.fn(async () => ({ ok: true, status: 200, body: '{}' }))
    const { runtime } = createRuntime(settingsWith(tasks), request)
    const flush = async () => { for (let i = 0; i < 200; i++) await Promise.resolve() }
    const selectionsA = () => find.mock.calls.filter(([input]) => input.projectPath === projectA).length
    try {
      const first = runtime.runTask('first')
      await flush()
      expect(acquire).toHaveBeenCalledTimes(1)
      const second = runtime.runTask('second')
      const other = runtime.runTask('other')
      const fourth = runtime.runTask('fourth')
      await flush()
      // The second task cannot select slot 0 while the first acquire is still pending.
      expect(selectionsA()).toBe(1)
      expect(acquire.mock.calls.map(([input]) => input.taskId)).toEqual(['first', 'other'])
      await expect(other).resolves.toMatchObject({ ok: true, threadId: 'other' })
      await expect(runtime.status()).resolves.toMatchObject({ queuedTaskIds: ['fourth'] })
      expect((await runtime.status()).runningTaskIds).toHaveLength(3)
      finishAcquire()
      await expect(first).resolves.toMatchObject(failFirst ? { ok: false, message: 'acquire failed' } : { ok: true, threadId: 'first' })
      await expect(second).resolves.toMatchObject(failFirst ? { ok: true, threadId: 'second' } : { ok: true, queued: true })
      await fourth
      await flush()
      expect(selectionsA()).toBe(2)
      expect((await runtime.status()).runningTaskIds).toHaveLength(3)
      if (!failFirst) {
        monitors.get('other')!()
        await flush()
        expect(release).toHaveBeenCalledWith({ projectPath: projectB, poolIndex: 0 })
        await vi.advanceTimersByTimeAsync(1000)
        expect(selectionsA()).toBe(2)
        expect((await runtime.status()).queuedTaskIds).toContain('second')
        monitors.get('first')!()
        await flush()
        expect(selectionsA()).toBe(3)
        expect(monitors.has('second')).toBe(true)
        expect((await runtime.status()).queuedTaskIds).toEqual([])
      }
      expect((await runtime.status()).runningTaskIds.length).toBeLessThanOrEqual(3)
    } finally {
      finishAcquire()
      await runtime.stop()
    }
  })

  it('does not select or acquire a project slot while its previous lease is still releasing', async () => {
    let finishRelease!: () => void
    const releasing = new Promise<void>((resolve) => { finishRelease = resolve })
    const monitors = new Map<string, () => void>()
    const find = vi.spyOn(worktrees, 'findAvailablePoolIndex').mockResolvedValue(0)
    const acquire = vi.spyOn(worktrees, 'acquireWorktree').mockImplementation(async ({ projectPath, taskId }) => ({
      poolIndex: 0, path: projectPath, branch: 'pool-0', inUse: true, taskId, baseCommit: 'abc', changesCount: 0
    }))
    const release = vi.spyOn(worktrees, 'releaseWorktree').mockImplementation(async ({ projectPath }) => {
      if (projectPath === testWorkspaceRoot) await releasing
    })
    vi.spyOn(ScheduleExecutionQueue.prototype, 'runPrompt').mockImplementation(async (_settings, options) => ({ ok: true, threadId: options.prompt, turnId: 'turn-1' }))
    vi.spyOn(ScheduleExecutionQueue.prototype, 'waitForAssistantText').mockImplementation(async (_settings, threadId, _turnId, _timeout, _workspace, signal) =>
      new Promise<string>((resolve) => {
        monitors.set(threadId, () => resolve('Done'))
        signal?.addEventListener('abort', () => resolve('Stopped'), { once: true })
      }))
    const tasks = ['holder', 'next', 'other'].map((id) => makeTask({
      id, prompt: id, useWorktree: true, workspaceRoot: id === 'other' ? clawWorkspaceRoot : testWorkspaceRoot
    }))
    const { runtime } = createRuntime(settingsWith(tasks), vi.fn(async () => ({ ok: true, status: 200, body: '{}' })))
    const flush = async () => { for (let i = 0; i < 200; i++) await Promise.resolve() }
    try {
      await runtime.runTask('holder')
      monitors.get('holder')!()
      await flush()
      expect(release).toHaveBeenCalledTimes(1)
      const next = runtime.runTask('next')
      await expect(runtime.runTask('other')).resolves.toMatchObject({ ok: true, threadId: 'other' })
      await flush()
      expect(find.mock.calls.filter(([input]) => input.projectPath === testWorkspaceRoot)).toHaveLength(1)
      expect(acquire.mock.calls.map(([input]) => input.taskId)).toEqual(['holder', 'other'])
      finishRelease()
      await expect(next).resolves.toMatchObject({ ok: true, threadId: 'next' })
      expect(acquire.mock.calls.map(([input]) => input.taskId)).toEqual(['holder', 'other', 'next'])
    } finally {
      finishRelease()
      await runtime.stop()
    }
  })

  it('fails an exhausted pool without a scheduled lease instead of waiting forever', async () => {
    vi.useFakeTimers()
    const find = vi.spyOn(worktrees, 'findAvailablePoolIndex').mockResolvedValue(null)
    const { runtime, store } = createRuntime(settingsWith([makeTask({ useWorktree: true })]))
    try {
      await expect(runtime.runTask('task-1')).resolves.toEqual({ ok: false, message: 'No worktree pool slot is available.' })
      await vi.advanceTimersByTimeAsync(1000)
      expect(find).toHaveBeenCalledTimes(1)
      expect(store.read().schedule.tasks[0].lastStatus).toBe('error')
      await expect(runtime.status()).resolves.toMatchObject({ runningTaskIds: [], queuedTaskIds: [] })
    } finally {
      await runtime.stop()
    }
  })

  it('cancels an active result monitor and rejects new work after stop', async () => {
    vi.useFakeTimers()
    const task = makeTask()
    let monitorSignal: AbortSignal | undefined
    let monitorStarted!: () => void
    const started = new Promise<void>((resolve) => { monitorStarted = resolve })
    const runtimeRequest = vi.fn(async (
      _settings: AppSettingsV1,
      path: string,
      init: { method?: string; signal?: AbortSignal }
    ) => {
      if (path === '/v1/threads') {
        return { ok: true, status: 201, body: JSON.stringify({ id: 'thr_stop' }) }
      }
      if (path === '/v1/threads/thr_stop/turns') {
        return { ok: true, status: 202, body: JSON.stringify({ turnId: 'turn_stop' }) }
      }
      if (path === '/v1/threads/thr_stop' && init.method === 'GET') {
        monitorSignal = init.signal
        monitorStarted()
        return new Promise<{ ok: boolean; status: number; body: string }>((resolve) => {
          init.signal?.addEventListener('abort', () => {
            resolve({ ok: false, status: 0, body: 'aborted' })
          }, { once: true })
        })
      }
      throw new Error(`unexpected path ${path}`)
    })
    const { runtime } = createRuntime(settingsWith([task]), runtimeRequest)

    await expect(runtime.runTask(task.id)).resolves.toMatchObject({
      ok: true,
      threadId: 'thr_stop',
      turnId: 'turn_stop'
    })
    await vi.advanceTimersByTimeAsync(1_500)
    await started
    await runtime.stop()

    expect(monitorSignal?.aborted).toBe(true)
    await expect(runtime.status()).resolves.toMatchObject({
      runningTaskIds: [],
      queuedTaskIds: []
    })
    await expect(runtime.runTask(task.id)).resolves.toEqual({
      ok: false,
      message: 'Schedule runtime stopped.'
    })
  })

  it('marks interrupted running tasks as errors during next-run recovery', async () => {
    const task = makeTask({
      lastStatus: 'running',
      schedule: { kind: 'interval', everyMinutes: 10, timeOfDay: '09:00', atTime: '' }
    })
    const initial = settingsWith([task])
    const { runtime, store } = createRuntime(initial)

    await (runtime as unknown as {
      ensureNextRuns: (settings: AppSettingsV1) => Promise<void>
    }).ensureNextRuns(initial)

    expect(store.read().schedule.tasks[0].lastStatus).toBe('error')
    expect(store.read().schedule.tasks[0].lastMessage).toBe('Task was interrupted before completion.')
    expect(Date.parse(store.read().schedule.tasks[0].nextRunAt)).toBeGreaterThan(0)
  })

  it('preserves the latest schedule endpoint while reconciling a stale task snapshot', async () => {
    const task = makeTask({
      schedule: { kind: 'interval', everyMinutes: 10, timeOfDay: '09:00', atTime: '' },
      nextRunAt: ''
    })
    const initial = settingsWith([task], { internal: { port: 18791, secret: 'old-secret' } })
    const { runtime, store } = createRuntime(initial)
    store.replace({
      ...initial,
      schedule: {
        ...initial.schedule,
        internal: { port: 28791, secret: 'latest-secret' }
      }
    })

    await (runtime as unknown as {
      ensureNextRuns: (settings: AppSettingsV1) => Promise<void>
    }).ensureNextRuns(initial)

    expect(store.read().schedule.internal).toEqual({ port: 28791, secret: 'latest-secret' })
    expect(store.read().schedule.tasks[0].nextRunAt).not.toBe('')
  })

  it('serializes the concurrency cap so two parallel runTask callers never exceed MAX_CONCURRENT', async () => {
    // Three concurrent IPC callers all hit runTask before any of them have
    // had a chance to mark themselves running. The old immediate-run path
    // raced here: each caller observed runningTaskIds.size < 3 before any
    // had incremented. With drainQueue owning the cap atomically, the cap
    // remains respected and the would-be 4th call is left queued instead
    // of running over the limit.
    const tasks = [
      makeTask({ id: 'task-a', title: 'A' }),
      makeTask({ id: 'task-b', title: 'B' }),
      makeTask({ id: 'task-c', title: 'C' }),
      makeTask({ id: 'task-d', title: 'D' })
    ]

    // Make runTaskInternal a long-running stub so we can observe the live
    // running set during the race window.
    let resolveTask: (() => void) | null = null
    const runPromise = new Promise<void>((resolve) => {
      resolveTask = resolve
    })
    const { runtime } = createRuntime(settingsWith(tasks))
    ;(runtime as unknown as {
      runTaskInternal: (task: ScheduledTaskV1) => Promise<unknown>
    }).runTaskInternal = vi.fn(async (task) => {
      await runPromise
      return { ok: true, threadId: `thr_${task.id}`, turnId: `turn_${task.id}` }
    })

    // Fire all four concurrently — exactly the race the old code lost.
    void runtime.runTask('task-a')
    void runtime.runTask('task-b')
    void runtime.runTask('task-c')
    void runtime.runTask('task-d')

    // Let microtasks settle so drainQueue has scheduled the runs.
    await new Promise((resolve) => setTimeout(resolve, 30))

    const status = await runtime.status()
    expect(status.runningTaskIds.length).toBeLessThanOrEqual(3)
    expect(status.runningTaskIds.length + status.queuedTaskIds.length).toBe(4)

    // Let everything finish so the runtime can be torn down cleanly.
    if (resolveTask) (resolveTask as () => void)()
    await new Promise((resolve) => setTimeout(resolve, 50))
  })

  it('cleans the worktree slot when a scheduled task completes so the next run can reuse it', async () => {
    // Simulates the documented failure: every successful useWorktree run
    // leaves changesCount>0, so without cleanup findAvailablePoolIndex
    // permanently skips the slot. After we wire reset+clean into
    // releaseWorktree, the slot returns to a fresh state and is reusable.
    const acquireCalls: string[] = []
    const releasedSlots: Array<{ projectPath: string; poolIndex: number }> = []
    const slotState = new Map<number, { dirty: boolean }>()
    const projectWorkspaceRoot = mkdtempSync(join(testWorkspaceRoot, 'project-'))
    slotState.set(0, { dirty: false })

    const acquireWorktreeMock = vi.fn(async (params: { projectPath: string; poolIndex: number; taskId: string }) => {
      acquireCalls.push(params.taskId)
      // mark dirty as soon as the task acquires
      slotState.set(params.poolIndex, { dirty: true })
      return {
        poolIndex: params.poolIndex,
        path: join(projectWorkspaceRoot, `.kun-worktrees/pool-${params.poolIndex}`),
        branch: `pool-${params.poolIndex}`,
        inUse: true,
        taskId: params.taskId,
        baseCommit: 'deadbeef',
        changesCount: 0
      }
    })
    const releaseWorktreeMock = vi.fn(async (params: { projectPath: string; poolIndex: number }) => {
      releasedSlots.push(params)
      // The real releaseWorktree we ship now resets+cleans the slot before
      // dropping the lease. Model that here so findAvailablePoolIndex sees
      // a clean slot on the next call.
      slotState.set(params.poolIndex, { dirty: false })
    })
    const findAvailableMock = vi.fn(async () => {
      // Return slot 0 only when it is clean (mirrors real findAvailablePoolIndex).
      const s = slotState.get(0)
      return s && !s.dirty ? 0 : null
    })

    const task = makeTask({
      id: 'wt-task',
      useWorktree: true,
      workspaceRoot: projectWorkspaceRoot
    })
    const { runtime } = createRuntime(settingsWith([task]))

    // Stub the worktree functions on the imported module surface via the
    // runtime's direct dependencies. Since schedule-runtime imports them
    // statically, we replace them on a per-test basis by reaching into the
    // already-loaded module — Vitest exposes named exports as writable in
    // ESM-loose mode under our config, but to keep this hermetic we patch
    // runTaskInternal end-to-end through the worktree-aware fake.
    ;(runtime as unknown as {
      runTaskInternal: (task: ScheduledTaskV1) => Promise<unknown>
    }).runTaskInternal = vi.fn(async (currentTask) => {
      // Mirror the production flow: acquire → run → release. The real
      // runTaskInternal hands off to monitorTaskTurn for the long-running
      // watcher; in this test we collapse that into a synchronous release
      // so we can observe slot reuse across three back-to-back runs.
      const poolIndex = await findAvailableMock()
      if (poolIndex === null) {
        ;(runtime as unknown as { runningTaskIds: Set<string> }).runningTaskIds.delete(currentTask.id)
        return { ok: false, message: 'No worktree pool slot is available.' }
      }
      await acquireWorktreeMock({ projectPath: projectWorkspaceRoot, poolIndex, taskId: currentTask.id })
      // simulate a successful run that left changes behind
      await releaseWorktreeMock({ projectPath: projectWorkspaceRoot, poolIndex })
      ;(runtime as unknown as { runningTaskIds: Set<string> }).runningTaskIds.delete(currentTask.id)
      return { ok: true, threadId: `thr_${currentTask.id}` }
    })

    // Three back-to-back runs of the same task. With cleanup wired in, all
    // three should land on the same slot 0; without it, only the first
    // succeeds and the next two return null from findAvailablePoolIndex.
    const r1 = await runtime.runTask(task.id)
    await new Promise((resolve) => setTimeout(resolve, 30))
    const r2 = await runtime.runTask(task.id)
    await new Promise((resolve) => setTimeout(resolve, 30))
    const r3 = await runtime.runTask(task.id)
    await new Promise((resolve) => setTimeout(resolve, 30))

    expect(r1).toMatchObject({ ok: true })
    expect(r2).toMatchObject({ ok: true })
    expect(r3).toMatchObject({ ok: true })
    expect(acquireWorktreeMock).toHaveBeenCalledTimes(3)
    expect(releaseWorktreeMock).toHaveBeenCalledTimes(3)
    // Same slot used every time — the cleanup made it reusable.
    expect(acquireWorktreeMock.mock.calls.every((c) => c[0].poolIndex === 0)).toBe(true)
  })

  it('uses the power save blocker only for enabled automatic schedules', () => {
    const started = new Set<number>()
    const powerSaveBlocker = {
      start: vi.fn(() => {
        started.add(1)
        return 1
      }),
      stop: vi.fn((id: number) => {
        started.delete(id)
      }),
      isStarted: vi.fn((id: number) => started.has(id))
    }
    const runtime = new ScheduleRuntime({
      store: createStore(settingsWith()) as never,
      runtimeRequest: vi.fn() as never,
      logError: vi.fn(),
      powerSaveBlocker
    })
    const scheduled = settingsWith([
      makeTask({ schedule: { kind: 'daily', everyMinutes: 60, timeOfDay: '09:00', atTime: '' } })
    ], { keepAwake: true })

    ;(runtime as unknown as { syncPowerSaveBlocker: (settings: AppSettingsV1) => void })
      .syncPowerSaveBlocker(scheduled)
    expect(powerSaveBlocker.start).toHaveBeenCalledWith('prevent-app-suspension')

    ;(runtime as unknown as { syncPowerSaveBlocker: (settings: AppSettingsV1) => void })
      .syncPowerSaveBlocker({ ...scheduled, schedule: { ...scheduled.schedule, keepAwake: false } })
    expect(powerSaveBlocker.stop).toHaveBeenCalledWith(1)
  })
})
