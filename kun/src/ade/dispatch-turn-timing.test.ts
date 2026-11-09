import { afterEach, describe, expect, it, vi } from 'vitest'
import type { RuntimeEvent } from '../contracts/events.js'
import { FileDispatchStore } from './dispatch-store.js'
import { backfillDispatchTiming, dispatchTurnTimingPatch } from './dispatch-turn-timing.js'
import { teardownAdeStores, makeHarness, NOW, seedDispatch, seedWorker, setupAdeStores, turnRecord, workerThread, type AdeStores } from './manager-controls-test-support.js'

const START = '2026-09-26T00:01:00.000Z'
const FINISH = '2026-09-26T00:03:00.000Z'
const storesToClean: AdeStores[] = []
afterEach(async () => { for (const stores of storesToClean.splice(0)) await teardownAdeStores(stores) })
async function setup() {
  const stores = await setupAdeStores()
  storesToClean.push(stores)
  await seedWorker(stores)
  return stores
}

describe('dispatch turn timing', () => {
  it('records a pre-bound turn start from the fresh Turn rather than its queued thread snapshot', async () => {
    const stores = await setup()
    const dispatch = await seedDispatch(stores, { state: 'accepted', turnId: 'turn_w1' })
    const queued = turnRecord({ status: 'queued', clientRequestId: dispatch.dispatchId })
    await stores.threads.upsert({ ...workerThread(), turns: [queued] })
    const { lifecycle, deps } = makeHarness(stores)
    vi.mocked(deps.turns.getTurn).mockResolvedValue({ ...queued, status: 'running', startedAt: START })
    lifecycle.handleRuntimeEvent({ kind: 'turn_started', threadId: 'wrk_1', turnId: 'turn_w1' } as RuntimeEvent)
    await vi.waitFor(async () => {
      expect(await stores.dispatches.get('thr_mgr', dispatch.dispatchId)).toMatchObject({ startedAt: START, state: 'accepted' })
    })
    expect(await stores.dispatches.get('thr_mgr', dispatch.dispatchId)).not.toHaveProperty('finishedAt')
  })

  it.each(['completed', 'failed', 'aborted'] as const)('uses the matching Turn timestamps for %s, not capture/review time', async (status) => {
    const stores = await setup()
    const dispatch = await seedDispatch(stores, { state: 'accepted', turnId: 'turn_w1' })
    const turn = turnRecord({ status, clientRequestId: dispatch.dispatchId, startedAt: START, finishedAt: FINISH })
    await stores.threads.upsert({ ...workerThread(), turns: [turn] })
    const { lifecycle } = makeHarness(stores)
    await lifecycle.handleWorkerTurnTerminal('wrk_1', turn.id, status)
    await lifecycle.handleWorkerTurnTerminal('wrk_1', turn.id, status)
    expect(await stores.dispatches.get('thr_mgr', dispatch.dispatchId)).toMatchObject({
      startedAt: START, finishedAt: FINISH, updatedAt: NOW,
      state: status === 'aborted' ? 'cancelled' : status
    })
    expect(await stores.notices.pending('thr_mgr')).toHaveLength(1)
    const reopened = new FileDispatchStore(stores.dataDir, () => '2026-09-27T00:00:00.000Z')
    await reopened.update('thr_mgr', dispatch.dispatchId, { verdict: { status: 'passed', checks: [] } })
    expect(await reopened.get('thr_mgr', dispatch.dispatchId)).toMatchObject({ startedAt: START, finishedAt: FINISH })
  })

  it('does not manufacture a start for a queued cancellation or inherit another dispatch interval', async () => {
    const stores = await setup()
    const first = await seedDispatch(stores, { state: 'completed', turnId: 'turn_old', startedAt: START, finishedAt: FINISH })
    const second = await seedDispatch(stores, { dispatchId: 'dsp_next', state: 'accepted' })
    const queued = turnRecord({ id: 'turn_next', status: 'queued', clientRequestId: second.dispatchId })
    await backfillDispatchTiming(stores.dispatches, 'thr_mgr', second.dispatchId, queued)
    expect(await stores.dispatches.get('thr_mgr', second.dispatchId)).not.toHaveProperty('startedAt')
    await backfillDispatchTiming(stores.dispatches, 'thr_mgr', second.dispatchId, { ...queued, status: 'aborted', finishedAt: FINISH })
    expect(await stores.dispatches.get('thr_mgr', second.dispatchId)).toMatchObject({ finishedAt: FINISH })
    expect(await stores.dispatches.get('thr_mgr', second.dispatchId)).not.toHaveProperty('startedAt')
    expect(dispatchTurnTimingPatch(first, queued)).toBeNull()
    expect(dispatchTurnTimingPatch(second, { ...queued, threadId: 'foreign' })).toBeNull()
  })

  it('late start backfill cannot erase a fast terminal boundary or replay its state', async () => {
    const stores = await setup()
    const record = await seedDispatch(stores, { state: 'completed', turnId: 'turn_w1' })
    const turn = turnRecord({ clientRequestId: record.dispatchId, startedAt: START, finishedAt: FINISH, status: 'completed' })
    await Promise.all([
      backfillDispatchTiming(stores.dispatches, 'thr_mgr', record.dispatchId, turn),
      backfillDispatchTiming(stores.dispatches, 'thr_mgr', record.dispatchId, { ...turn, status: 'running', finishedAt: undefined })
    ])
    expect(await stores.dispatches.get('thr_mgr', record.dispatchId)).toMatchObject({ state: 'completed', startedAt: START, finishedAt: FINISH })
    await backfillDispatchTiming(stores.dispatches, 'thr_mgr', record.dispatchId, { ...turn, finishedAt: NOW })
    expect((await stores.dispatches.get('thr_mgr', record.dispatchId))?.finishedAt).toBe(FINISH)
  })

  it('startup repairs settled and running metadata without replaying settled side effects', async () => {
    const stores = await setup()
    const settled = await seedDispatch(stores, { state: 'completed', turnId: 'turn_old' })
    await seedDispatch(stores, { dispatchId: 'dsp_new', state: 'accepted', turnId: 'turn_new' })
    await stores.threads.upsert({ ...workerThread(), turns: [
      turnRecord({ id: 'turn_old', status: 'completed', clientRequestId: settled.dispatchId, startedAt: START, finishedAt: FINISH }),
      turnRecord({ id: 'turn_new', clientRequestId: 'dsp_new', startedAt: FINISH })
    ] })
    const { lifecycle, taskWorkspaces } = makeHarness(stores)
    await lifecycle.reconcileOnStartup()
    await lifecycle.reconcileOnStartup()
    expect(await stores.dispatches.get('thr_mgr', settled.dispatchId)).toMatchObject({ startedAt: START, finishedAt: FINISH })
    expect(await stores.dispatches.get('thr_mgr', 'dsp_new')).toMatchObject({ startedAt: FINISH, state: 'accepted' })
    expect(await stores.dispatches.get('thr_mgr', 'dsp_new')).not.toHaveProperty('finishedAt')
    expect(taskWorkspaces.captureForDispatch).not.toHaveBeenCalled()
    expect(await stores.notices.pending('thr_mgr')).toHaveLength(0)
  })
})
