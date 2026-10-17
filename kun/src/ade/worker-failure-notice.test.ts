import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { RuntimeEvent } from '../contracts/events.js'
import {
  makeHarness,
  seedDispatch,
  seedWorker,
  setupAdeStores,
  teardownAdeStores,
  turnRecord,
  workerThread,
  type AdeStores
} from './manager-controls-test-support.js'

let stores: AdeStores

beforeEach(async () => {
  stores = await setupAdeStores()
})

afterEach(async () => {
  await teardownAdeStores(stores)
})

describe('worker failure notices', () => {
  it('leads with the budget stop and keeps the last worker output', async () => {
    await seedWorker(stores)
    await seedDispatch(stores, { dispatchId: 'dsp_1', state: 'accepted', title: 'refactor' })
    await stores.threads.upsert({
      ...workerThread(),
      turns: [turnRecord({ status: 'failed', clientRequestId: 'dsp_1' })]
    })
    const harness = makeHarness(stores)
    const events: RuntimeEvent[] = [{
      kind: 'error', threadId: 'wrk_1', turnId: 'turn_w1', seq: 7, createdAt: '2026-09-26T00:00:00.000Z',
      message: 'turn exceeded 128 model steps', code: 'turn_step_limit', severity: 'warning'
    } as RuntimeEvent]
    harness.deps.sessionStore = {
      loadItems: vi.fn(async () => [{
        kind: 'assistant_text', id: 'item_1', threadId: 'wrk_1', turnId: 'turn_w1', text: 'Now let me check the remaining files.'
      }]),
      loadEventsSince: vi.fn(async () => events)
    } as never

    await harness.lifecycle.handleWorkerTurnTerminal('wrk_1', 'turn_w1', 'failed')

    const dispatch = await stores.dispatches.get('thr_mgr', 'dsp_1')
    expect(dispatch).toMatchObject({ state: 'failed', failureReason: 'turn exceeded 128 model steps' })
    const [notice] = await stores.notices.pending('thr_mgr')
    expect(notice).toMatchObject({ kind: 'dispatch_failed', dispatchId: 'dsp_1' })
    expect(notice!.detail).toBe(
      'turn exceeded 128 model steps\n\nLast worker output: Now let me check the remaining files.'
    )
  })
})
