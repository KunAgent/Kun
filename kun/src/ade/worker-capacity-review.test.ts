import { FileDispatchStore } from './dispatch-store.js'
import { FileTeamStore } from './team-store.js'
import { it, expect, vi } from 'vitest'
import { setup, startNow } from './manager-worker-dispatch-fixtures.js'
import { DispatchDeliverer } from './dispatch-deliverer.js'
import { WorkerNoticeCoordinator } from './worker-notice-coordinator.js'
import { FileWorkerNoticeStore } from './worker-notice-store.js'

function wire(f: Awaited<ReturnType<typeof setup>>) {
  const notices = new FileWorkerNoticeStore(f.root)
  const runTurn = vi.fn(async () => 'completed' as const)
  const startTurn = vi.fn(async (_args, options) => {
    const result = { threadId: 'parent', turnId: 'wake', userMessageItemId: 'wake-item' }
    await options?.onAdmitted?.(result)
    return result
  })
  const coordinator = new WorkerNoticeCoordinator({ notices, teams: f.teams, threads: f.threads,
    dispatches: f.dispatches, agentDispatchService: f.service, turns: { startTurn }, runTurn: () => runTurn,
    nowIso: () => new Date(f.clock.now).toISOString(), mergeWindowMs: () => 0 })
  f.wireNotices(coordinator)
  return { coordinator, startTurn, runTurn, notices }
}

it.each(['running', 'completed', 'partial'] as const)('replays %s batch using its own records at full capacity', async state => {
  const f = await setup('ask-for-approval', 'kun', state === 'partial' ? 1 : 3)
  f.workspace.path = f.root
  const input = { items: [f.assignment, { ...f.assignment, label: 'B' }, { ...f.assignment, label: 'C' }] }
  const saved = await f.runtime.createWorkerBatch(f.ctx, input, f.context)
  await startNow(f, saved.dispatchIntentId!)
  if (state === 'completed') {
    for (const row of await f.dispatches.list('parent')) await f.dispatches.update('parent', row.dispatchId,
      { state: 'completed', outcome: 'completed', verdict: { status: 'passed', checks: [] } })
    await f.service.reconcile()
  }
  const before = await f.dispatches.list('parent')
  const replay = await f.runtime.createWorkerBatch(f.ctx, input, f.context)
  expect(replay).toMatchObject({ pending: 0, created: state === 'partial' ? 1 : 3,
    dispatched: state === 'partial' ? 1 : 3, failed: state === 'partial' ? 1 : 0, skipped: state === 'partial' ? 1 : 0 })
  expect(new Set(replay.items.map(item => item.dispatchId)).size).toBe(3)
  const results = replay.items.filter(item => item.result !== 'skipped').map(item => item.result as { dispatchId?: string })
  expect(new Set(results.map(result => result.dispatchId)).size).toBe(results.length)
  expect(await f.dispatches.list('parent')).toEqual(before)
  expect(f.runChild).toHaveBeenCalledTimes(state === 'partial' ? 1 : 3)
  expect(f.taskWorkspaces.create).toHaveBeenCalledTimes(state === 'partial' ? 1 : 3)
})

it('immediately admits a manager notice while the successful batch worker is still running', async () => {
  const f = await setup('ask-for-approval', 'kun', 1)
  f.workspace.path = f.root
  const w = wire(f)
  try {
    const saved = await f.runtime.createWorkerBatch(f.ctx, { items: [f.assignment, f.assignment] }, f.context)
    await startNow(f, saved.dispatchIntentId!)
    await vi.waitFor(() => expect(w.runTurn).toHaveBeenCalledTimes(1))
    expect(w.startTurn).toHaveBeenCalledTimes(1)
    expect((await f.dispatches.list('parent')).some(row => row.state === 'accepted')).toBe(true)
    await vi.waitFor(async () => expect(await w.notices.pending('parent')).toHaveLength(0))
  } finally { w.coordinator.clearManager('parent') }
})

async function persistedFailure(f: Awaited<ReturnType<typeof setup>>) {
  await f.teams.ensure('parent')
  return f.dispatches.create({ dispatchId: 'legacy', workerId: 'uncreated', teamId: 'parent', parentTurnId: 'source-turn',
    title: 'Refused', task: 'No execution', state: 'failed', mode: 'queue', failureReason: 'Worker limit',
    createdAt: new Date(f.clock.now).toISOString(), updatedAt: new Date(f.clock.now).toISOString() })
}

it('recovers persisted-only failure through a reconstructed deliverer and does not wake again after ACK', async () => {
  const f = await setup('ask-for-approval', 'kun', 1)
  f.workspace.path = f.root
  const notify = vi.spyOn(f.deliverer, 'notifyFailure').mockResolvedValue(undefined)
  const saved = await f.runtime.createWorkerBatch(f.ctx, { items: [f.assignment, f.assignment] }, f.context)
  await startNow(f, saved.dispatchIntentId!)
  expect((await f.dispatches.list('parent')).filter(row => row.state === 'failed')).toHaveLength(1)
  expect(await f.notices.list('parent')).toHaveLength(0)
  notify.mockRestore()
  const w = wire(f)
  const recover = () => new DispatchDeliverer({ ...f.delivererDeps,
    dispatches: new FileDispatchStore(f.root), teams: new FileTeamStore(f.root) }).reconcileTeam('parent')
  try {
    await recover()
    await vi.waitFor(() => expect(w.runTurn).toHaveBeenCalledTimes(1))
    await vi.waitFor(async () => expect(await w.notices.pending('parent')).toHaveLength(0))
    await recover()
    await w.coordinator.deliverForManager('parent')
    expect(f.runChild).toHaveBeenCalledTimes(1)
    expect(w.startTurn).toHaveBeenCalledTimes(1)
    expect(await w.notices.list('parent')).toHaveLength(1)
  } finally { w.coordinator.clearManager('parent') }
})

it.each(['aborted', 'archived', 'deleted'] as const)('suppresses legacy failure after %s with no retries', async state => {
  const f = await setup('ask-for-approval')
  const row = await persistedFailure(f)
  await f.deliverer.notifyFailure(row)
  const source = (await f.threads.get('parent'))!
  if (state === 'aborted') source.turns[0].status = state
  else source.status = state
  await f.threads.upsert(source)
  const w = wire(f)
  try {
    await w.coordinator.deliverForManager('parent')
    expect(w.startTurn).not.toHaveBeenCalled()
    expect(await w.notices.pending('parent')).toHaveLength(0)
    await new DispatchDeliverer(f.delivererDeps).reconcileTeam('parent')
    await w.coordinator.deliverForManager('parent')
    expect(w.startTurn).not.toHaveBeenCalled()
    expect((await w.notices.list('parent'))[0].attempts).toBe(0)
  } finally { w.coordinator.clearManager('parent') }
})


it('settles creation and a competing notice ACK without a team-lock deadlock', async () => {
  const f = await setup('ask-for-approval')
  f.workspace.path = f.root
  await f.teams.ensure('parent')
  await f.notices.enqueue({ noticeId: 'older', teamId: 'parent', workerId: 'older-worker',
    kind: 'dispatch_failed', title: 'Older failure', attempts: 0, createdAt: new Date(f.clock.now).toISOString() })
  let release!: () => void
  const hold = new Promise<void>(resolve => { release = resolve })
  f.taskWorkspaces.create.mockImplementationOnce(async () => { await hold; return f.workspace })
  const creation = f.runtime.createWorkerNow(f.ctx, f.assignment, f.context)
  await vi.waitFor(() => expect(f.taskWorkspaces.create).toHaveBeenCalledTimes(1))
  let acked = false
  const ack = f.notices.ack('parent', ['older']).then(() => { acked = true })
  expect(acked).toBe(false)
  release()
  expect((await creation).ok).toBe(true)
  await ack
  expect(await f.notices.pending('parent')).toHaveLength(0)
})
