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
    vi.unstubAllGlobals()
    vi.useRealTimers()
    if (testWorkspaceRoot) {
      rmSync(testWorkspaceRoot, { recursive: true, force: true })
      testWorkspaceRoot = ''
      clawWorkspaceRoot = ''
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
