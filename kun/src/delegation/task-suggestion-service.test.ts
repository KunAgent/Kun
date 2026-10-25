import { afterEach, describe, expect, it, vi } from 'vitest'
import type { RuntimeEvent } from '../contracts/events.js'
import type { TaskSuggestionIntent, TaskSuggestionTask } from '../contracts/task-suggestions.js'
import { InMemoryTaskSuggestionStore } from './task-suggestion-store.js'
import { TaskSuggestionService } from './task-suggestion-service.js'
import { TaskLaunchError, type TaskSuggestionLauncher, type TaskTurnInspection } from './task-suggestion-launcher.js'
import { renderTaskSuggestionContext } from './task-suggestion-context.js'

const source = { threadId: 'thr_parent', turnId: 'turn_1', toolCallId: 'call_1' }
const input = { reason: 'independent', tasks: [
  { title: 'Drop dead column', goal: 'Remove raw_messages', scope: ['migration'], done: ['merge < 300ms'] },
  { title: 'Cache scans', goal: 'Narrow signature invalidation' },
  { title: 'Trim first paint', goal: 'One request on first paint', worktree: false }
] }

type FakeLauncher = Pick<TaskSuggestionLauncher, 'launch' | 'inspect' | 'describeSource'>

function fakeLauncher(overrides: Partial<FakeLauncher> = {}) {
  const turns = new Map<string, TaskTurnInspection>()
  const launcher: FakeLauncher = {
    describeSource: async () => ({ workspace: '/repo', route: { agentId: 'kun', model: 'deepseek-v4-pro' } }),
    launch: vi.fn(async (intent: TaskSuggestionIntent, task: TaskSuggestionTask, persist) => {
      await persist({ threadId: `thr_${task.id}` })
      turns.set(`thr_${task.id}`, { status: 'running' })
      return { threadId: `thr_${task.id}`, turnId: `turn_${task.id}`, ...(task.worktree ? { branch: `kun/${task.id}` } : {}) }
    }),
    inspect: async (task) => turns.get(task.threadId ?? '') ?? { status: 'missing' },
    ...overrides
  }
  return { launcher: launcher as TaskSuggestionLauncher, turns }
}

function setup(options: { autoStartMs?: number; launcher?: Partial<FakeLauncher> } = {}) {
  const store = new InMemoryTaskSuggestionStore()
  const published: TaskSuggestionIntent[] = []
  let now = Date.parse('2026-10-22T10:00:00.000Z')
  const service = new TaskSuggestionService({
    store,
    policy: () => ({ autoStartMs: options.autoStartMs ?? 0, worktree: true, inheritContext: false }),
    onUpdated: (intent) => { published.push(intent) },
    now: () => now,
    newId: () => 'tsg_test'
  })
  const fake = fakeLauncher(options.launcher)
  service.attach(fake.launcher)
  return { service, published, fake, advance: (ms: number) => { now += ms } }
}

const terminal = (threadId: string, kind: 'turn_completed' | 'turn_failed' | 'turn_aborted' = 'turn_completed') =>
  ({ kind, threadId, turnId: `turn_${threadId.slice(4)}`, seq: 1, timestamp: new Date().toISOString() }) as unknown as RuntimeEvent

describe('TaskSuggestionService', () => {
  afterEach(() => { vi.useRealTimers() })

  it('creates a waiting card from the model input with per-task defaults', async () => {
    const { service, published } = setup()
    const card = await service.propose({ source, workspace: '/repo', route: { agentId: 'kun', model: 'm' }, input })
    expect(card.state).toBe('suggested')
    expect(card.deadline).toBeUndefined()
    expect(card.tasks.map((task) => [task.id, task.state, task.worktree])).toEqual([
      ['t1', 'suggested', true], ['t2', 'suggested', true], ['t3', 'suggested', false]
    ])
    expect(card.tasks[0]!.brief).toEqual({ goal: 'Remove raw_messages', scope: ['migration'], done: ['merge < 300ms'] })
    expect(published).toHaveLength(1)
  })

  it('rejects a single task: suggestions are for parallel work', async () => {
    const { service } = setup()
    await expect(service.propose({ source, workspace: '/repo', route: { agentId: 'kun' },
      input: { tasks: [{ title: 'only', goal: 'one' }] } })).rejects.toThrow()
  })

  it('starts one row, settles it from the turn event, and reports the result', async () => {
    const { service, fake } = setup()
    const card = await service.propose({ source, workspace: '/repo', route: { agentId: 'kun' }, input })
    const started = await service.act(card.intentId, { action: 'start', expectedRevision: card.revision, requestId: 'r1', taskIds: ['t1'] })
    expect(started.tasks[0]!.state).toBe('starting')
    expect(started.state).toBe('active')
    await service.idle()
    let current = (await service.get(card.intentId))!
    expect(current.tasks[0]).toMatchObject({ state: 'running', threadId: 'thr_t1', turnId: 'turn_t1', branch: 'kun/t1' })
    fake.turns.set('thr_t1', { status: 'completed', result: { turnStatus: 'completed', summary: 'merge 1.4s → 210ms' } })
    service.observe(terminal('thr_t1'))
    await vi.waitFor(async () => expect((await service.get(card.intentId))!.tasks[0]!.state).toBe('done'))
    current = (await service.get(card.intentId))!
    expect(current.tasks[0]!.result?.summary).toBe('merge 1.4s → 210ms')
    expect(current.tasks[0]!.settledAt).toBeDefined()
    expect(current.state).toBe('active')
  })

  it('replays a request id without acting twice and refuses stale revisions', async () => {
    const { service, fake } = setup()
    const card = await service.propose({ source, workspace: '/repo', route: { agentId: 'kun' }, input })
    const first = await service.act(card.intentId, { action: 'start', expectedRevision: 1, requestId: 'same', taskIds: ['t2'] })
    const replay = await service.act(card.intentId, { action: 'start', expectedRevision: 1, requestId: 'same', taskIds: ['t2'] })
    expect(replay.revision).toBeGreaterThanOrEqual(first.revision)
    await service.idle()
    expect(fake.launcher.launch).toHaveBeenCalledTimes(1)
    await expect(service.act(card.intentId, { action: 'ignore', expectedRevision: 1, requestId: 'stale' }))
      .rejects.toThrow(/reload revision/)
  })

  it('classifies a start failure and retries without a worktree', async () => {
    let calls = 0
    const { service } = setup({ launcher: { launch: vi.fn(async (_intent, task: TaskSuggestionTask) => {
      calls += 1
      if (calls === 1) throw new Error('fatal: could not create work tree dir: No space left on device')
      return { threadId: `thr_${task.id}`, turnId: `turn_${task.id}` }
    }) } })
    const card = await service.propose({ source, workspace: '/repo', route: { agentId: 'kun' }, input })
    await service.act(card.intentId, { action: 'start', expectedRevision: 1, requestId: 'r1', taskIds: ['t1'] })
    await service.idle()
    let current = (await service.get(card.intentId))!
    expect(current.tasks[0]).toMatchObject({ state: 'start_failed', failure: { code: 'disk_space' } })
    current = await service.act(card.intentId, { action: 'retry', expectedRevision: current.revision, requestId: 'r2',
      taskId: 't1', changes: { worktree: false } })
    expect(current.tasks[0]).toMatchObject({ state: 'starting', attempt: 1, worktree: false })
    expect(current.tasks[0]!.failure).toBeUndefined()
    await service.idle()
    expect((await service.get(card.intentId))!.tasks[0]!.state).toBe('running')
  })

  it('settles the card once every row is final', async () => {
    const { service } = setup({ launcher: { launch: async () => { throw new TaskLaunchError({ code: 'agent_unavailable', message: 'not logged in' }) } } })
    const card = await service.propose({ source, workspace: '/repo', route: { agentId: 'claude-code' }, input })
    let current = await service.act(card.intentId, { action: 'continue_here', expectedRevision: 1, requestId: 'a', taskId: 't1' })
    current = await service.act(card.intentId, { action: 'ignore', expectedRevision: current.revision, requestId: 'b', taskIds: ['t2'] })
    expect(current.state).toBe('suggested')
    current = await service.act(card.intentId, { action: 'ignore', expectedRevision: current.revision, requestId: 'c' })
    expect(current.tasks.map((task) => task.state)).toEqual(['here', 'ignored', 'ignored'])
    expect(current.state).toBe('settled')
  })

  it('counts down, pauses, resumes and starts every suggested row when the window ends', async () => {
    vi.useFakeTimers()
    const { service, advance } = setup({ autoStartMs: 60_000 })
    await service.start()
    const card = await service.propose({ source, workspace: '/repo', route: { agentId: 'kun' }, input })
    expect(card.state).toBe('countdown')
    expect(card.deadline).toBe('2026-10-22T10:01:00.000Z')
    let current = await service.act(card.intentId, { action: 'pause', expectedRevision: 1, requestId: 'p' })
    expect(current.state).toBe('paused')
    expect(current.deadline).toBeUndefined()
    current = await service.act(card.intentId, { action: 'resume', expectedRevision: current.revision, requestId: 'r' })
    expect(current.state).toBe('countdown')
    advance(61_000)
    await vi.advanceTimersByTimeAsync(2_000)
    await service.idle()
    current = (await service.get(card.intentId))!
    expect(current.autoStarted).toBe(true)
    expect(current.tasks.every((task) => task.state === 'running')).toBe(true)
    service.stop()
  })

  it('resumes interrupted launches and settles finished rows on startup', async () => {
    const store = new InMemoryTaskSuggestionStore()
    const first = new TaskSuggestionService({ store, newId: () => 'tsg_restart' })
    const card = await first.propose({ source, workspace: '/repo', route: { agentId: 'kun' }, input })
    await first.act(card.intentId, { action: 'start', expectedRevision: 1, requestId: 'x', taskIds: ['t1', 't2'] })
    await first.idle()
    // No launcher was attached: both rows failed to start; simulate an older runtime that died mid-launch instead.
    await store.transaction((file) => { for (const task of file.intents[0]!.tasks.slice(0, 2)) { task.state = 'starting'; delete task.failure } })
    const second = new TaskSuggestionService({ store })
    const fake = fakeLauncher()
    second.attach(fake.launcher)
    await second.start()
    await second.idle()
    expect((await second.get(card.intentId))!.tasks.slice(0, 2).map((task) => task.state)).toEqual(['running', 'running'])
    second.stop()
  })

  it('renders a bounded context block that frames results as claims', async () => {
    const { service, fake } = setup()
    const card = await service.propose({ source, workspace: '/repo', route: { agentId: 'kun' }, input })
    await service.act(card.intentId, { action: 'start', expectedRevision: 1, requestId: 's', taskIds: ['t1'] })
    await service.idle()
    fake.turns.set('thr_t1', { status: 'completed', result: { turnStatus: 'completed', summary: 'done it' } })
    service.observe(terminal('thr_t1'))
    await vi.waitFor(async () => expect((await service.get(card.intentId))!.tasks[0]!.state).toBe('done'))
    const text = renderTaskSuggestionContext(await service.list('thr_parent'), Date.now())!
    expect(text).toContain('1. [done] Drop dead column (session thr_t1, branch kun/t1) — result: done it')
    expect(text).toContain('2. [suggested] Cache scans')
    expect(text).toMatch(/unverified claims/)
    expect(renderTaskSuggestionContext([], Date.now())).toBeUndefined()
  })
})
