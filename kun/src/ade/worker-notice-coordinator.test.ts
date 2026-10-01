import { resolveThreadExecutionConfig } from '../domain/thread-execution-config.js'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { WorkerNotice } from '../contracts/ade.js'
import type { StartTurnResponse } from '../contracts/turns.js'
import { InMemoryThreadStore } from '../adapters/in-memory-thread-store.js'
import { createThreadRecord } from '../domain/thread.js'
import { FileTeamStore } from './team-store.js'
import { FileWorkerNoticeStore } from './worker-notice-store.js'
import { WorkerNoticeCoordinator } from './worker-notice-coordinator.js'

let dataDir: string
let teams: FileTeamStore
let notices: FileWorkerNoticeStore
let threads: InMemoryThreadStore
const coordinators = new Set<WorkerNoticeCoordinator>()

const NOW = '2026-09-26T00:00:00.000Z'
const MANAGER = 'thr_mgr'

beforeEach(async () => {
  dataDir = await mkdtemp(join(tmpdir(), 'kun-ade-notice-'))
  teams = new FileTeamStore(dataDir, () => NOW)
  notices = new FileWorkerNoticeStore(dataDir, () => NOW)
  threads = new InMemoryThreadStore()
})

afterEach(async () => {
  for (const coordinator of coordinators) coordinator.clearManager(MANAGER)
  coordinators.clear()
  vi.useRealTimers()
  await rm(dataDir, { recursive: true, force: true })
})

function notice(id: string, overrides: Partial<WorkerNotice> = {}): WorkerNotice {
  return {
    noticeId: id,
    teamId: MANAGER,
    workerId: 'wrk_1',
    kind: 'dispatch_completed',
    title: `dispatch ${id}`,
    createdAt: NOW,
    attempts: 0,
    ...overrides
  }
}

function managerThread(turns: Array<{ status: string }> = []) {
  const thread = createThreadRecord({
    id: MANAGER,
    title: 'manager',
    workspace: '/tmp/ws',
    model: 'model-mgr'
  })
  thread.providerId = 'deepseek'
  thread.turns = turns.map((turn, index) => ({
    id: `turn_${index}`,
    threadId: MANAGER,
    status: turn.status as 'running',
    orchestration: 'direct',
    prompt: 'p',
    steering: [],
    createdAt: NOW,
    items: [],
    attachmentIds: [],
    activeSkillIds: [],
    injectedMemoryIds: [],
    injectedMemorySummaries: [],
    injectedDirectiveIds: [],
    injectedDirectiveSummaries: [],
    injectedInstructionSources: []
  }))
  return thread
}

type StartCall = { request: { prompt: string; clientRequestId: string; messageSource?: string } }

function harness(input: { startImpl?: (call: StartCall) => Promise<StartTurnResponse> } = {}) {
  // Emulate the real contract: onAdmitted fires only for a newly admitted
  // turn; a repeated clientRequestId replays the stored response instead.
  const admitted = new Set<string>()
  const startTurn = vi.fn(async (args: { threadId: string; request: StartCall['request'] }, options?: {
    onAdmitted?: (response: StartTurnResponse) => void | Promise<void>
  }) => {
    const replay = admitted.has(args.request.clientRequestId)
    admitted.add(args.request.clientRequestId)
    const response: StartTurnResponse = input.startImpl
      ? await input.startImpl({ request: args.request })
      : { threadId: args.threadId, turnId: 'turn_new', userMessageItemId: 'item_new' }
    if (!replay) await options?.onAdmitted?.(response)
    return response
  })
  const runTurn = vi.fn(async () => 'completed')
  const coordinator = new WorkerNoticeCoordinator({
    notices,
    teams,
    threads,
    turns: { startTurn: startTurn as never },
    runTurn: () => runTurn,
    nowIso: () => NOW,
    language: () => 'en'
  })
  coordinators.add(coordinator)
  return { coordinator, startTurn, runTurn }
}

describe('WorkerNoticeCoordinator', () => {
  it('merges notices arriving inside the window into one wake-up turn', async () => {
    vi.useFakeTimers()
    await threads.upsert(managerThread())
    const { coordinator, startTurn, runTurn } = harness()
    await coordinator.enqueue(notice('ntc_1'))
    await coordinator.enqueue(notice('ntc_2'))
    await coordinator.enqueue(notice('ntc_3'))
    await vi.advanceTimersByTimeAsync(3_000)
    await vi.waitFor(() => expect(startTurn).toHaveBeenCalledTimes(1))
    await vi.waitFor(async () => expect(await notices.pending(MANAGER)).toHaveLength(0))
    const call = startTurn.mock.calls[0]![0] as { request: StartCall['request'] }
    expect(call.request.messageSource).toBe('worker_update')
    expect(call.request.prompt).toContain('<kun_worker_updates>')
    expect(call.request.prompt).toContain('dispatch ntc_1')
    expect(call.request.prompt).toContain('dispatch ntc_3')
    expect(runTurn).toHaveBeenCalledWith(MANAGER, 'turn_new')
  })

  it('waits for durable acknowledgement after admission while a write is still pending', async () => {
    vi.useFakeTimers()
    await threads.upsert(managerThread())
    const { coordinator, startTurn, runTurn } = harness()
    const ack = notices.ack.bind(notices)
    let release!: () => void
    const gate = new Promise<void>((resolve) => { release = resolve })
    vi.spyOn(notices, 'ack').mockImplementation(async (...args) => {
      await gate
      return ack(...args)
    })
    try {
      await coordinator.enqueue(notice('ntc_delayed_ack'))
      await vi.advanceTimersByTimeAsync(3_000)
      await vi.waitFor(() => expect(startTurn).toHaveBeenCalledTimes(1))
      await vi.waitFor(() => expect(runTurn).toHaveBeenCalledTimes(1))
      // Admission is observable before the durable ACK finishes. The old
      // immediate empty-inbox assertion raced this real filesystem boundary.
      expect(await notices.pending(MANAGER)).toHaveLength(1)
      release()
      await vi.waitFor(async () => expect(await notices.pending(MANAGER)).toHaveLength(0))
      expect(startTurn).toHaveBeenCalledTimes(1)
    } finally {
      release()
    }
  })

  it('derives a deterministic batch clientRequestId from the pending set', async () => {
    await threads.upsert(managerThread())
    const first = harness()
    const second = harness()
    await first.coordinator.enqueue(notice('ntc_a'))
    await first.coordinator.enqueue(notice('ntc_b'))
    await first.coordinator.deliverForManager(MANAGER)
    const firstKey = (first.startTurn.mock.calls[0]![0] as { request: StartCall['request'] })
      .request.clientRequestId
    // Re-persist the same ids as fresh pending rows in a second inbox.
    const secondNotices = new FileWorkerNoticeStore(await mkdtemp(join(tmpdir(), 'kun-ade-notice-b-')), () => NOW)
    const secondTeams = new FileTeamStore(dataDir, () => NOW)
    const secondCoordinator = new WorkerNoticeCoordinator({
      notices: secondNotices,
      teams: secondTeams,
      threads,
      turns: { startTurn: second.startTurn as never },
      runTurn: () => second.runTurn,
      nowIso: () => NOW,
      language: () => 'en'
    })
    coordinators.add(secondCoordinator)
    await secondNotices.enqueue(notice('ntc_a'))
    await secondNotices.enqueue(notice('ntc_b'))
    await secondCoordinator.deliverForManager(MANAGER)
    const secondKey = (second.startTurn.mock.calls[0]![0] as { request: StartCall['request'] })
      .request.clientRequestId
    expect(secondKey).toBe(firstKey)
    expect(firstKey).toMatch(/^wnb_[a-f0-9]{24}$/)
  })

  it('defers while the manager is busy and retries with backoff', async () => {
    vi.useFakeTimers()
    const thread = managerThread([{ status: 'running' }])
    await threads.upsert(thread)
    const { coordinator, startTurn } = harness()
    await coordinator.enqueue(notice('ntc_1'))
    await coordinator.deliverForManager(MANAGER)
    expect(startTurn).not.toHaveBeenCalled()
    expect(await notices.pending(MANAGER)).toHaveLength(1)
    thread.turns = []
    await threads.upsert(thread)
    await vi.advanceTimersByTimeAsync(2_000)
    await vi.waitFor(() => expect(startTurn).toHaveBeenCalledTimes(1))
    await vi.waitFor(async () => expect(await notices.pending(MANAGER)).toHaveLength(0))
  })

  it('defers while a composer hold is active, then delivers after it lapses', async () => {
    vi.useFakeTimers()
    await threads.upsert(managerThread())
    const { coordinator, startTurn } = harness()
    coordinator.holdNotices(MANAGER, 45_000)
    await coordinator.enqueue(notice('ntc_1'))
    await coordinator.deliverForManager(MANAGER)
    expect(startTurn).not.toHaveBeenCalled()
    // Held for 45 s; backoff retries must not deliver while the hold stands.
    await vi.advanceTimersByTimeAsync(30_000)
    expect(startTurn).not.toHaveBeenCalled()
    await vi.advanceTimersByTimeAsync(60_000)
    await vi.waitFor(() => expect(startTurn).toHaveBeenCalledTimes(1))
    await vi.waitFor(async () => expect(await notices.pending(MANAGER)).toHaveLength(0))
  })

  it('acks pending notices without a turn when the manager thread is gone', async () => {
    const { coordinator, startTurn } = harness()
    await coordinator.enqueue(notice('ntc_1'))
    await coordinator.deliverForManager(MANAGER)
    expect(startTurn).not.toHaveBeenCalled()
    expect(await notices.pending(MANAGER)).toHaveLength(0)
  })

  it('records failed admissions and retries with persisted attempts', async () => {
    vi.useFakeTimers()
    let calls = 0
    const { coordinator, startTurn } = harness({
      startImpl: async () => {
        calls += 1
        if (calls === 1) throw new Error('manager busy')
        return { threadId: MANAGER, turnId: 'turn_ok', userMessageItemId: 'item_ok' }
      }
    })
    await threads.upsert(managerThread())
    await coordinator.enqueue(notice('ntc_1'))
    await coordinator.deliverForManager(MANAGER)
    expect(startTurn).toHaveBeenCalledTimes(1)
    const stored = await notices.pending(MANAGER)
    expect(stored[0]?.attempts).toBe(1)
    expect(stored[0]?.lastError).toContain('manager busy')
    await vi.advanceTimersByTimeAsync(2_000)
    await vi.waitFor(() => expect(startTurn).toHaveBeenCalledTimes(2))
    await vi.waitFor(async () => expect(await notices.pending(MANAGER)).toHaveLength(0))
  })

  it('replays unacknowledged notices for every team after restart', async () => {
    await teams.ensure(MANAGER)
    await threads.upsert(managerThread())
    await notices.enqueue(notice('ntc_orphan'))
    const { coordinator, startTurn } = harness()
    expect(await coordinator.replayPending()).toBe(1)
    await vi.waitFor(() => expect(startTurn).toHaveBeenCalledTimes(1))
    await vi.waitFor(async () => expect(await notices.pending(MANAGER)).toHaveLength(0))
  })

  it('keeps concurrent deliveries exactly-once via the shared batch key', async () => {
    await threads.upsert(managerThread())
    const { coordinator, startTurn, runTurn } = harness()
    await notices.enqueue(notice('ntc_1'))
    await Promise.all([
      coordinator.deliverForManager(MANAGER),
      coordinator.deliverForManager(MANAGER),
      coordinator.deliverForManager(MANAGER)
    ])
    const keys = new Set(startTurn.mock.calls.map(
      (call) => (call[0] as { request: StartCall['request'] }).request.clientRequestId
    ))
    expect(keys.size).toBe(1)
    // Exactly one newly admitted turn runs the manager, however many replayed.
    expect(runTurn).toHaveBeenCalledTimes(1)
    expect(await notices.pending(MANAGER)).toHaveLength(0)
  })
  it('uses the pending manager model at the next wake-up admission', async () => {
    const snapshot = resolveThreadExecutionConfig({
      request: { workspace: '/tmp/ws', model: 'new-route', mode: 'agent' },
      global: { managerModel: { providerId: 'new-provider', model: 'new-manager' } }, nowIso: NOW
    }).snapshot
    await threads.upsert({ ...managerThread(), pendingExecutionConfig: snapshot })
    const { coordinator, startTurn } = harness()
    await coordinator.enqueue(notice('ntc_pending_route'))
    await coordinator.deliverForManager(MANAGER)
    expect(startTurn).toHaveBeenCalledWith(expect.objectContaining({
      request: expect.objectContaining({ providerId: 'new-provider', model: 'new-manager' })
    }), expect.anything())
  })

})
