import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  defaultClawSettings,
  defaultDesignSettings,
  defaultKeyboardShortcuts,
  defaultKunRuntimeSettings,
  defaultModelProviderSettings,
  defaultScheduleSettings,
  defaultWorkflowSettings,
  defaultWriteSettings,
  defaultTerminalSettings,
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
    workspaceRoot: '/tmp/workspace',
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
    workspaceRoot: '/tmp/claw-workspace',
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
    provider: defaultModelProviderSettings(),
    agents: {
      kun: {
        ...defaultKunRuntimeSettings(),
        apiKey: 'test-key'
      }
    },
    workspaceRoot: '/tmp/workspace',
    conversationWorkspaceRoot: '~/Documents/Kun',
    log: { enabled: true, retentionDays: 7 },
    checkpointCleanup: { enabled: false, intervalDays: 3 },
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
    guiUpdate: { channel: 'stable' },
    codePromptPrefix: '',
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
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('computes nextRunAt for supported schedule kinds', () => {
    const from = new Date('2026-06-02T00:00:00.000Z')

    expect(computeScheduleNextRunAt(makeTask(), from)).toBe('')
    expect(computeScheduleNextRunAt(makeTask({
      schedule: { kind: 'interval', everyMinutes: 15, timeOfDay: '09:00', atTime: '' }
    }), from)).toBe('2026-06-02T00:15:00.000Z')
    expect(computeScheduleNextRunAt(makeTask({
      schedule: {
        kind: 'at',
        everyMinutes: 60,
        timeOfDay: '09:00',
        atTime: '2026-06-03T09:00:00.000+08:00'
      }
    }), from)).toBe('2026-06-03T09:00:00.000+08:00')
  })

  it('builds compact Scheduled task thread titles from task names', () => {
    expect(scheduledThreadTitle('每日A股行情盘')).toBe('[Scheduled task] 每日A股')
    expect(scheduledThreadTitle('Task 1')).toBe('[Scheduled task] Task')
    expect(scheduledThreadTitle('   ')).toBe('[Scheduled task]')
  })

  it('queues a task until its dependencies complete', async () => {
    const dependency = makeTask({ id: 'dependency', lastStatus: 'idle' })
    const task = makeTask({ id: 'dependent', dependsOn: [dependency.id], priority: 10 })
    const { runtime, store } = createRuntime(settingsWith([dependency, task]))

    await expect(runtime.runTask(task.id)).resolves.toMatchObject({
      ok: true,
      queued: true
    })
    await expect(runtime.status()).resolves.toMatchObject({ queuedTaskIds: [task.id] })
    expect(store.read().schedule.tasks.find((item) => item.id === task.id)?.lastStatus).toBe('queued')
  })

  it('restores scheduled queued tasks into the in-memory queue after restart', async () => {
    const task = makeTask({
      id: 'queued-scheduled',
      lastStatus: 'queued',
      schedule: { kind: 'daily', everyMinutes: 60, timeOfDay: '09:00', atTime: '' }
    })
    const settings = settingsWith([task])
    const { runtime } = createRuntime(settings)

    await (runtime as unknown as {
      ensureNextRuns: (settings: AppSettingsV1) => Promise<void>
    }).ensureNextRuns(settings)

    await expect(runtime.status()).resolves.toMatchObject({ queuedTaskIds: [task.id] })
  })

  it('rejects dependency cycles before queueing', () => {
    const first = makeTask({ id: 'first', dependsOn: ['second'] })
    const second = makeTask({ id: 'second', dependsOn: ['first'] })
    expect(hasTaskDependencyCycle(first.id, [first, second])).toBe(true)
    expect(hasTaskDependencyCycle(first.id, [first, makeTask({ id: 'second' })])).toBe(false)
  })

  it('creates detected reminder requests into top-level schedule settings', async () => {
    const future = '2099-06-03T09:00:00.000Z'
    vi.stubGlobal('fetch', vi.fn(async () => ({
      ok: true,
      text: async () => JSON.stringify({
        choices: [{
          message: {
            content: JSON.stringify({
              shouldCreateTask: true,
              scheduleAt: future,
              reminderBody: 'ship the review',
              taskName: 'Ship review'
            })
          }
        }]
      })
    })))
    const { runtime, store } = createRuntime(settingsWith())
    vi.spyOn(runtime, 'sync').mockImplementation(() => undefined)

    const result = await runtime.createScheduledTaskFromText('Remind me tomorrow to ship the review.', {
      workspaceRoot: '/tmp/schedule',
      modelHint: 'deepseek-v4-flash',
      mode: 'plan'
    })

    expect(result).toMatchObject({
      kind: 'created',
      title: 'Ship review reminder',
      scheduleAt: future
    })
    expect(store.read().schedule.enabled).toBe(true)
    expect(store.read().schedule.tasks[0]).toMatchObject({
      title: 'Ship review reminder',
      workspaceRoot: '/tmp/schedule',
      providerId: 'deepseek',
      model: 'deepseek-v4-flash',
      reasoningEffort: 'max',
      mode: 'plan',
      schedule: { kind: 'at', atTime: future }
    })
    expect(store.read().claw.tasks).toEqual([])
  })

  it('starts a Kun thread with a Schedule title and records running status', async () => {
    const task = makeTask({ reasoningEffort: 'max' })
    const runtimeRequest = vi.fn(async (_settings, path, init) => {
      if (path === '/v1/threads') {
        return { ok: true, status: 200, body: JSON.stringify({ id: 'thr_1' }) }
      }
      if (path === '/v1/threads/thr_1' && init?.method === 'PATCH') {
        return { ok: true, status: 200, body: '{}' }
      }
      if (path === '/v1/threads/thr_1/turns') {
        return { ok: true, status: 202, body: JSON.stringify({ turnId: 'turn_1' }) }
      }
      throw new Error(`unexpected path ${path}`)
    })
    const { runtime, store } = createRuntime(settingsWith([task]), runtimeRequest)
    ;(runtime as unknown as { monitorTaskTurn: () => void }).monitorTaskTurn = vi.fn()

    await expect(runtime.runTask(task.id)).resolves.toMatchObject({
      ok: true,
      threadId: 'thr_1',
      turnId: 'turn_1'
    })

    const createRequest = runtimeRequest.mock.calls.find(([, path, init]) =>
      path === '/v1/threads' && init?.method === 'POST'
    )?.[2]?.body
    const turnRequest = runtimeRequest.mock.calls.find(([, path]) =>
      path === '/v1/threads/thr_1/turns'
    )?.[2]?.body
    expect(JSON.parse(String(createRequest))).toMatchObject({
      title: '[Scheduled task] Task',
      workspace: '/tmp/workspace',
      model: 'deepseek-v4-flash',
      mode: 'agent'
    })
    expect(JSON.parse(String(turnRequest))).toMatchObject({
      model: 'deepseek-v4-flash',
      reasoningEffort: 'max',
      // Headless turn: a user_input request would hang until timeout.
      disableUserInput: true
    })
    expect(store.read().schedule.tasks[0]).toMatchObject({
      lastStatus: 'running',
      lastThreadId: 'thr_1',
      lastMessage: 'Started'
    })
  })

  it('runs selected Claw channel scheduled tasks with the Claw persona', async () => {
    const channel = makeClawChannel()
    const task = makeTask({
      clawChannelId: channel.id,
      workspaceRoot: '',
      model: channel.model
    })
    const initial = settingsWith([task])
    initial.claw.channels = [channel]
    const runtimeRequest = vi.fn(async (_settings, path, init) => {
      if (path === '/v1/threads') {
        return { ok: true, status: 200, body: JSON.stringify({ id: 'thr_claw' }) }
      }
      if (path === '/v1/threads/thr_claw' && init?.method === 'PATCH') {
        return { ok: true, status: 200, body: '{}' }
      }
      if (path === '/v1/threads/thr_claw/turns') {
        return { ok: true, status: 202, body: JSON.stringify({ turnId: 'turn_claw' }) }
      }
      throw new Error(`unexpected path ${path}`)
    })
    const { runtime } = createRuntime(initial, runtimeRequest)
    ;(runtime as unknown as { monitorTaskTurn: () => void }).monitorTaskTurn = vi.fn()

    await expect(runtime.runTask(task.id)).resolves.toMatchObject({
      ok: true,
      threadId: 'thr_claw',
      turnId: 'turn_claw'
    })

    const createRequest = runtimeRequest.mock.calls.find(([, path, init]) =>
      path === '/v1/threads' && init?.method === 'POST'
    )?.[2]?.body
    const turnRequest = runtimeRequest.mock.calls.find(([, path]) =>
      path === '/v1/threads/thr_claw/turns'
    )?.[2]?.body
    expect(JSON.parse(String(createRequest))).toMatchObject({
      workspace: '/tmp/claw-workspace',
      model: 'deepseek-v4-flash'
    })
    const turnBody = JSON.parse(String(turnRequest))
    expect(turnBody.prompt).toContain('[Claw managed instructions]')
    expect(turnBody.prompt).toContain('[Agent name]\nOps Claw')
    expect(turnBody.prompt).toContain('Run the task')
  })

  it('reads assistant text from the real Kun thread detail shape', async () => {
    const task = makeTask()
    const runtimeRequest = vi.fn(async (_settings, path, init) => {
      if (path === '/v1/threads') {
        return { ok: true, status: 200, body: JSON.stringify({ id: 'thr_1' }) }
      }
      if (path === '/v1/threads/thr_1' && init?.method === 'PATCH') {
        return { ok: true, status: 200, body: '{}' }
      }
      if (path === '/v1/threads/thr_1/turns') {
        return { ok: true, status: 202, body: JSON.stringify({ turnId: 'turn_1' }) }
      }
      if (path === '/v1/threads/thr_1' && init?.method === 'GET') {
        return {
          ok: true,
          status: 200,
          body: JSON.stringify({
            id: 'thr_1',
            status: 'idle',
            turns: [
              {
                id: 'turn_1',
                status: 'completed',
                items: [{ kind: 'assistant_text', text: 'scheduled task completed' }]
              }
            ]
          })
        }
      }
      throw new Error(`unexpected path ${path}`)
    })
    const { runtime } = createRuntime(settingsWith([task]), runtimeRequest)

    const result = await (runtime as unknown as {
      runPrompt: (
        settingsArg: AppSettingsV1,
        options: {
          prompt: string
          title: string
          workspaceRoot: string
          model: string
          reasoningEffort: ScheduledTaskV1['reasoningEffort']
          mode: ScheduledTaskV1['mode']
          waitForResult: boolean
          responseTimeoutMs: number
        }
      ) => Promise<{ ok: boolean; text?: string }>
    }).runPrompt(settingsWith([task]), {
      prompt: 'hello',
      title: 'demo',
      workspaceRoot: '/tmp/workspace',
      model: 'auto',
      reasoningEffort: 'medium',
      mode: 'agent',
      waitForResult: true,
      responseTimeoutMs: 2_000
    })

    expect(result).toMatchObject({ ok: true, text: 'scheduled task completed' })
  })

  it('waits for the current scheduled turn to complete before returning final text', async () => {
    const task = makeTask()
    let getCount = 0
    const runtimeRequest = vi.fn(async (_settings, path, init) => {
      if (path === '/v1/threads') {
        return { ok: true, status: 200, body: JSON.stringify({ id: 'thr_1' }) }
      }
      if (path === '/v1/threads/thr_1' && init?.method === 'PATCH') {
        return { ok: true, status: 200, body: '{}' }
      }
      if (path === '/v1/threads/thr_1/turns') {
        return { ok: true, status: 202, body: JSON.stringify({ turnId: 'turn_current' }) }
      }
      if (path === '/v1/threads/thr_1' && init?.method === 'GET') {
        getCount += 1
        return {
          ok: true,
          status: 200,
          body: JSON.stringify(getCount === 1
            ? {
                id: 'thr_1',
                status: 'running',
                turns: [
                  {
                    id: 'turn_previous',
                    status: 'completed',
                    items: [{ kind: 'assistant_text', text: 'previous scheduled reply' }]
                  },
                  {
                    id: 'turn_current',
                    status: 'running',
                    items: [{ kind: 'assistant_text', text: 'intermediate scheduled reply' }]
                  }
                ]
              }
            : {
                id: 'thr_1',
                status: 'idle',
                turns: [
                  {
                    id: 'turn_previous',
                    status: 'completed',
                    items: [{ kind: 'assistant_text', text: 'previous scheduled reply' }]
                  },
                  {
                    id: 'turn_current',
                    status: 'completed',
                    items: [
                      { kind: 'assistant_text', text: 'intermediate scheduled reply' },
                      { kind: 'assistant_text', text: 'final scheduled reply' }
                    ]
                  }
                ]
              })
        }
      }
      throw new Error(`unexpected path ${path}`)
    })
    const { runtime } = createRuntime(settingsWith([task]), runtimeRequest)

    const result = await (runtime as unknown as {
      runPrompt: (
        settingsArg: AppSettingsV1,
        options: {
          prompt: string
          title: string
          workspaceRoot: string
          model: string
          reasoningEffort: ScheduledTaskV1['reasoningEffort']
          mode: ScheduledTaskV1['mode']
          waitForResult: boolean
          responseTimeoutMs: number
        }
      ) => Promise<{ ok: boolean; text?: string }>
    }).runPrompt(settingsWith([task]), {
      prompt: 'hello',
      title: 'demo',
      workspaceRoot: '/tmp/workspace',
      model: 'auto',
      reasoningEffort: 'medium',
      mode: 'agent',
      waitForResult: true,
      responseTimeoutMs: 2_500
    })

    expect(result).toMatchObject({ ok: true, text: 'final scheduled reply' })
    expect(getCount).toBe(2)
  })

  it('does not return historical scheduled text when the current turn fails', async () => {
    const task = makeTask()
    const runtimeRequest = vi.fn(async (_settings, path, init) => {
      if (path === '/v1/threads') {
        return { ok: true, status: 200, body: JSON.stringify({ id: 'thr_1' }) }
      }
      if (path === '/v1/threads/thr_1' && init?.method === 'PATCH') {
        return { ok: true, status: 200, body: '{}' }
      }
      if (path === '/v1/threads/thr_1/turns') {
        return { ok: true, status: 202, body: JSON.stringify({ turnId: 'turn_current' }) }
      }
      if (path === '/v1/threads/thr_1' && init?.method === 'GET') {
        return {
          ok: true,
          status: 200,
          body: JSON.stringify({
            id: 'thr_1',
            status: 'idle',
            turns: [
              {
                id: 'turn_previous',
                status: 'completed',
                items: [{ kind: 'assistant_text', text: 'previous scheduled reply' }]
              },
              {
                id: 'turn_current',
                status: 'failed',
                items: []
              }
            ]
          })
        }
      }
      throw new Error(`unexpected path ${path}`)
    })
    const { runtime } = createRuntime(settingsWith([task]), runtimeRequest)

    await expect((runtime as unknown as {
      runPrompt: (
        settingsArg: AppSettingsV1,
        options: {
          prompt: string
          title: string
          workspaceRoot: string
          model: string
          reasoningEffort: ScheduledTaskV1['reasoningEffort']
          mode: ScheduledTaskV1['mode']
          waitForResult: boolean
          responseTimeoutMs: number
        }
      ) => Promise<{ ok: boolean; text?: string }>
    }).runPrompt(settingsWith([task]), {
      prompt: 'hello',
      title: 'demo',
      workspaceRoot: '/tmp/workspace',
      model: 'auto',
      reasoningEffort: 'medium',
      mode: 'agent',
      waitForResult: true,
      responseTimeoutMs: 2_000
    })).rejects.toThrow('Agent turn failed.')
  })

  it('disables one-time tasks after monitored completion', async () => {
    const task = makeTask({
      lastStatus: 'running',
      schedule: {
        kind: 'at',
        everyMinutes: 60,
        timeOfDay: '09:00',
        atTime: '2099-06-03T09:00:00.000Z'
      }
    })
    const { runtime, store } = createRuntime(settingsWith([task]))
    ;(runtime as unknown as {
      waitForAssistantText: () => Promise<string>
    }).waitForAssistantText = vi.fn(async () => 'done')

    await (runtime as unknown as {
      monitorTaskTurn: (taskId: string, threadId: string, turnId: string) => Promise<void>
    }).monitorTaskTurn(task.id, 'thr_1', 'turn_1')

    expect(store.read().schedule.tasks[0]).toMatchObject({
      enabled: false,
      nextRunAt: '',
      lastStatus: 'success',
      lastMessage: 'done',
      lastThreadId: 'thr_1'
    })
  })

  it('does not auto-run manual tasks during tick', async () => {
    const task = makeTask({
      schedule: { kind: 'manual', everyMinutes: 60, timeOfDay: '09:00', atTime: '' },
      nextRunAt: '2026-06-02T00:00:00.000Z'
    })
    const runtimeRequest = vi.fn()
    const { runtime } = createRuntime(settingsWith([task]), runtimeRequest)

    await (runtime as unknown as { tick: () => Promise<void> }).tick()

    expect(runtimeRequest).not.toHaveBeenCalled()
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
    slotState.set(0, { dirty: false })

    const acquireWorktreeMock = vi.fn(async (params: { projectPath: string; poolIndex: number; taskId: string }) => {
      acquireCalls.push(params.taskId)
      // mark dirty as soon as the task acquires
      slotState.set(params.poolIndex, { dirty: true })
      return {
        poolIndex: params.poolIndex,
        path: `/tmp/pool/pool-${params.poolIndex}`,
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
      workspaceRoot: '/tmp/project'
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
      await acquireWorktreeMock({ projectPath: '/tmp/project', poolIndex, taskId: currentTask.id })
      // simulate a successful run that left changes behind
      await releaseWorktreeMock({ projectPath: '/tmp/project', poolIndex })
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
