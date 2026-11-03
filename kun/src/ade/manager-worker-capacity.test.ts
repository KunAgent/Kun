import { publicAgentDispatchIntent } from '../contracts/agent-dispatch-intents.js'
import { createAdeManagerContext } from './manager-context.js'
import { WorkerNoticeCoordinator } from './worker-notice-coordinator.js'
import { resolveThreadExecutionConfig } from '../domain/thread-execution-config.js'
import { workerCapacity } from './team-execution-policy.js'
import { FileWorkerNoticeStore } from './worker-notice-store.js'
import { describe, it, expect, vi } from 'vitest'
import { setup, startNow } from './manager-worker-dispatch-fixtures.js'

describe('worker capacity admission', () => {
  it('notifies immediately for rejected and skipped batch items and deduplicates recovery', async () => {
    const f = await setup('ask-for-approval', 'kun', 1)
    f.workspace.path = f.root
    const result = await f.runtime.createWorkerBatch(f.ctx, { items: [f.assignment, f.assignment, f.assignment] }, f.context)
    await startNow(f, result.dispatchIntentId!)
    await vi.waitFor(() => expect(f.runChild).toHaveBeenCalledTimes(1))
    await vi.waitFor(async () => expect(await f.dispatches.list('parent')).toHaveLength(3))
    const failures = (await f.dispatches.list('parent')).filter(row => row.state === 'failed')
    expect(failures).toHaveLength(2)
    expect(await f.notices.pending('parent')).toHaveLength(2)
    for (const row of failures) {
      expect(await f.teams.worker('parent', row.workerId)).toBeNull()
      expect(row.dispatchIntentId).toBe(result.dispatchIntentId)
    }
    await f.notices.ack('parent', failures.map(row => `ntc_${row.dispatchId}`))
    await f.deliverer.reconcileTeam('parent')
    expect(await f.notices.pending('parent')).toHaveLength(0)
    expect(await f.notices.list('parent')).toHaveLength(2)
  })

  it('reports capacity without creating a team', async () => {
    const f = await setup('ask-for-approval', 'kun', 1)
    f.workspace.path = f.root
    expect(await f.runtime.workerStatus(f.ctx, {})).toMatchObject({ capacity: { limit: 1, active: 0, available: 1 } })
    expect(await f.teams.get('parent')).toBeNull()
  })
  it('refuses new full-team requests but preserves an existing intent', async () => {
    const f = await setup('ask-for-approval', 'kun', 1)
    f.workspace.path = f.root
    const first = await f.runtime.createWorker(f.ctx, f.assignment, f.context)
    await startNow(f, first.dispatchIntentId!)
    await vi.waitFor(() => expect(f.runChild).toHaveBeenCalledTimes(1))
    expect((await f.runtime.createWorker(f.ctx, f.assignment, f.context)).dispatchIntentId).toBe(first.dispatchIntentId)
    const next = await f.runtime.createWorker(f.ctx, f.assignment, { ...f.context, activeToolCallId: 'second' })
    expect(next).toMatchObject({ ok: false, refusal: 'worker_limit', capacity: { limit: 1, active: 1, available: 0 } })
    expect(next.dispatchIntentId).toBeUndefined()
    expect(await f.service.list('parent')).toHaveLength(1)
    expect(f.taskWorkspaces.create).toHaveBeenCalledTimes(1)
    expect(f.runChild).toHaveBeenCalledTimes(1)
  })
})

async function pendingPair() {
  const f = await setup('ask-for-approval', 'kun', 1)
  f.workspace.path = f.root
  const a = await f.runtime.createWorker(f.ctx, f.assignment, f.context)
  const b = await f.runtime.createWorker(f.ctx, f.assignment, { ...f.context, activeToolCallId: 'b' })
  return { f, a, b }
}

describe('capacity races and durable notices', () => {
  it('admits only one of two concurrent starts for the last slot', async () => {
    const { f, a, b } = await pendingPair()
    await Promise.all([startNow(f, a.dispatchIntentId!), startNow(f, b.dispatchIntentId!)])
    expect((await f.teams.get('parent'))!.workers).toHaveLength(1)
    expect(f.runChild).toHaveBeenCalledTimes(1)
    expect(f.taskWorkspaces.create).toHaveBeenCalledTimes(1)
    expect(await f.notices.pending('parent')).toHaveLength(1)
    expect((await f.service.list('parent')).map(row => row.state).sort()).toEqual(['failed', 'running'])
  })

  it('recovers a persisted refusal with a preallocated ID and wakes the manager once across ACK', async () => {
    const { f, a, b } = await pendingPair()
    await startNow(f, a.dispatchIntentId!)
    const notify = vi.spyOn(f.deliverer, 'notifyFailure').mockResolvedValue(undefined)
    await startNow(f, b.dispatchIntentId!)
    expect(await f.notices.list('parent')).toHaveLength(0)
    notify.mockRestore()
    const intent = (await f.service.get(b.dispatchIntentId!))!
    expect(intent.target!.workerIds).toHaveLength(1)
    expect(await f.childRuns.get(intent.target!.workerIds![0])).toBeUndefined()
    f.runtime.handleRuntimeEvent({ kind: 'agent_dispatch_intent', threadId: 'parent',
      dispatchIntent: publicAgentDispatchIntent(intent) } as Parameters<typeof f.runtime.handleRuntimeEvent>[0])
    await vi.waitFor(async () => expect(await f.notices.list('parent')).toHaveLength(1))
    await f.deliverer.reconcileTeam('parent')
    const reopened = new FileWorkerNoticeStore(f.root)
    expect(await reopened.pending('parent')).toHaveLength(1)
    const startTurn = vi.fn(async () => ({ threadId: 'parent', turnId: 'notice-turn', userMessageItemId: 'notice-item' }))
    const runTurn = vi.fn(async () => 'completed')
    const coordinator = new WorkerNoticeCoordinator({ nowIso: () => new Date(f.clock.now).toISOString(), notices: reopened, teams: f.teams, threads: f.threads,
      dispatches: f.dispatches, agentDispatchService: f.service, turns: { startTurn: startTurn as never },
      runTurn: () => runTurn as never })
    try {
      await coordinator.deliverForManager('parent')
      await f.deliverer.reconcileTeam('parent')
      await coordinator.deliverForManager('parent')
      expect(startTurn).toHaveBeenCalledTimes(1)
      expect(await reopened.pending('parent')).toHaveLength(0)
      expect(f.runChild).toHaveBeenCalledTimes(1)
    } finally { coordinator.clearManager('parent') }
  })

  it.each(['cancel', 'takeover', 'archived', 'deleted', 'aborted'] as const)('suppresses a no-worker failure after %s', async (action) => {
    const { f, a, b } = await pendingPair()
    await startNow(f, a.dispatchIntentId!)
    await startNow(f, b.dispatchIntentId!)
    const intent = (await f.service.get(b.dispatchIntentId!))!
    if (action === 'cancel' || action === 'takeover') {
      await f.store.transaction(file => {
        const current = file.intents.find(row => row.intentId === intent.intentId)!
        current.cancellationRequested = action === 'cancel'
        current.takenOver = action === 'takeover'
      })
    } else {
      const thread = (await f.threads.get('parent'))!
      if (action === 'aborted') thread.turns[0].status = 'aborted'
      else thread.status = action
      await f.threads.upsert(thread)
    }
    const startTurn = vi.fn()
    const coordinator = new WorkerNoticeCoordinator({ nowIso: () => new Date(f.clock.now).toISOString(), notices: f.notices, teams: f.teams, threads: f.threads,
      dispatches: f.dispatches, agentDispatchService: f.service, turns: { startTurn }, runTurn: () => vi.fn() as never })
    try {
      await coordinator.deliverForManager('parent')
      expect(startTurn).not.toHaveBeenCalled()
      expect(await f.notices.pending('parent')).toHaveLength(0)
    } finally { coordinator.clearManager('parent') }
  })

  it('uses pending/current policy, then existing team, then global/schema without status mutations', async () => {
    const f = await setup('ask-for-approval')
    expect(await workerCapacity({ threads: f.threads, teams: f.teams }, 'parent')).toEqual({ limit: 8, active: 0, available: 8 })
    await f.teams.ensure('parent', { hardWorkers: 3 })
    const snapshot = resolveThreadExecutionConfig({ request: { mode: 'agent', workspace: '/repo', model: 'main-model' },
      global: { limits: { softWorkers: 1, hardWorkers: 2 } }, nowIso: '2026-10-07T00:00:00.000Z' }).snapshot
    const thread = (await f.threads.get('parent'))!
    thread.executionConfig = snapshot
    thread.pendingExecutionConfig = { ...snapshot, limits: { softWorkers: 1, hardWorkers: 1 } }
    await f.threads.upsert(thread)
    expect((await f.runtime.workerStatus(f.ctx, {})).capacity.limit).toBe(1)
    delete thread.pendingExecutionConfig
    await f.threads.upsert(thread)
    expect((await f.runtime.workerStatus(f.ctx, {})).capacity.limit).toBe(2)
    delete thread.executionConfig
    await f.threads.upsert(thread)
    expect((await f.runtime.workerStatus(f.ctx, {})).capacity.limit).toBe(3)
    expect((await f.teams.get('parent'))!.limits.hardWorkers).toBe(3)
  })

  it.each(['en', 'zh-CN'])('reports saved versus refused capacity in %s', async language => {
    const { f, a } = await pendingPair()
    f.locale.value = language
    const saved = await f.runtime.createWorker(f.ctx, f.assignment, f.context)
    expect(saved.userReport).toContain(language === 'en' ? 'Not started yet' : '尚未启动')
    await startNow(f, a.dispatchIntentId!)
    const refused = await f.runtime.createWorker(f.ctx, f.assignment, { ...f.context, activeToolCallId: 'third' })
    expect(refused.userReport).toContain('1/1')
    expect(refused.userReport).toContain(language === 'en' ? 'no worker was created' : '未创建')
    const dispatch = (await f.dispatches.list('parent'))[0]
    await f.dispatches.update('parent', dispatch.dispatchId, { state: 'completed' })
    const team = (await f.teams.get('parent'))!
    expect(team.workers[0].lifecycle).toBe('persistent')
    expect((await f.runtime.workerStatus(f.ctx, {})).capacity.active).toBe(1)
    await f.teams.upsertWorker('parent', { ...team.workers[0], state: 'released' })
    expect((await f.runtime.workerStatus(f.ctx, {})).capacity.available).toBe(1)
  })
})


it('recovers legacy dispatch records without intent linkage', async () => {
  const f = await setup('ask-for-approval')
  await f.teams.ensure('parent')
  await f.dispatches.create({ dispatchId: 'legacy', teamId: 'parent', workerId: 'uncreated', parentTurnId: 'source-turn',
    title: 'Legacy', task: 'No execution', mode: 'queue', state: 'failed', failureReason: 'worker limit',
    createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() })
  await f.deliverer.reconcileTeam('parent')
  await f.deliverer.reconcileTeam('parent')
  expect(await f.notices.list('parent')).toHaveLength(1)
  expect(f.runChild).not.toHaveBeenCalled()
})

it.each(['en', 'zh'])('renders dynamic capacity in %s without creating a team', async language => {
  const f = await setup('ask-for-approval', 'kun', 2)
  const render = createAdeManagerContext({ teams: f.teams, dispatches: f.dispatches,
    questions: { listOpen: async () => [] }, harnessSummary: async () => undefined,
    capacity: async () => (await f.runtime.workerStatus(f.ctx, {})).capacity, language: () => language })
  const text = await render({ threadId: 'parent' })
  expect(text).toContain('0/2')
  expect(text).toContain(language === 'en' ? '2 available' : '可用 2')
  expect(await f.teams.get('parent')).toBeNull()
})


it('retains intent-level refusal notifications when no dispatch record exists', async () => {
  const f = await setup('ask-for-approval')
  const saved = await f.runtime.createWorker(f.ctx, f.assignment, f.context)
  await f.store.transaction(file => {
    const intent = file.intents.find(row => row.intentId === saved.dispatchIntentId)!
    intent.state = 'failed'
    intent.error = 'Review denied'
  })
  const intent = (await f.service.get(saved.dispatchIntentId!))!
  const event = { kind: 'agent_dispatch_intent', threadId: 'parent', dispatchIntent: publicAgentDispatchIntent(intent) } as Parameters<typeof f.runtime.handleRuntimeEvent>[0]
  f.runtime.handleRuntimeEvent(event)
  await vi.waitFor(async () => expect(await f.notices.list('parent')).toHaveLength(1))
  f.runtime.handleRuntimeEvent(event)
  await vi.waitFor(async () => expect(await f.notices.pending('parent')).toHaveLength(1))
  expect((await f.notices.list('parent'))[0].noticeId).toBe(`${intent.intentId}:failed:0`)
  expect(await f.dispatches.list('parent')).toHaveLength(0)
  expect(f.runChild).not.toHaveBeenCalled()
})


it.each(['completed', 'awaiting_parent', 'starting', 'uncertain', 'stopping', 'queued'] as const)(
  'preserves the %s status when replaying an existing intent', async state => {
    const f = await setup('ask-for-approval')
    const original = await f.runtime.createWorker(f.ctx, f.assignment, f.context)
    await f.store.transaction(file => { file.intents[0].state = state })
    const replay = await f.runtime.createWorker(f.ctx, f.assignment, f.context)
    expect(replay.dispatchIntentId).toBe(original.dispatchIntentId)
    expect(replay.dispatchIntent?.state).toBe(state)
    expect(replay.userReport).not.toContain('Not started yet')
    expect(f.runChild).not.toHaveBeenCalled()
  })
