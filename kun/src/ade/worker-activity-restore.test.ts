import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { ActivityStore } from '../services/activity-store.js'
import {
  NOW,
  seedDispatch,
  setupAdeStores,
  teardownAdeStores,
  turnRecord,
  workerRecord,
  workerThread,
  type AdeStores
} from './manager-controls-test-support.js'
import { restoreWorkerActivityRows } from './worker-activity-restore.js'

let stores: AdeStores
let activity: ActivityStore

beforeEach(async () => {
  stores = await setupAdeStores()
  activity = new ActivityStore({ nowIso: () => NOW })
})

afterEach(async () => {
  await teardownAdeStores(stores)
})

function restore() {
  return restoreWorkerActivityRows({
    teams: stores.teams,
    dispatches: stores.dispatches,
    threads: stores.threads,
    activity,
    nowMs: () => Date.parse(NOW)
  })
}

describe('restoreWorkerActivityRows', () => {
  it('rebuilds worker rows that the side-thread-blind hydrate never lists', async () => {
    await stores.teams.upsertWorker('thr_mgr', workerRecord())
    await stores.threads.upsert({
      ...workerThread({ relation: 'side', parentThreadId: 'thr_mgr' }),
      updatedAt: NOW,
      turns: [turnRecord({ status: 'completed' })]
    })

    await expect(restore()).resolves.toBe(1)

    expect(activity.get('wrk_1')).toMatchObject({
      kind: 'worker',
      parentThreadId: 'thr_mgr',
      teamId: 'thr_mgr',
      title: 'fixer',
      mainState: 'done',
      lastOutcome: 'completed',
      provenance: 'restored'
    })
  })

  it('restores a worker whose first run never started from its dispatch state', async () => {
    await stores.teams.upsertWorker('thr_mgr', workerRecord({ workerId: 'wrk_never', label: 'W2' }))
    await seedDispatch(stores, {
      dispatchId: 'dsp_never', workerId: 'wrk_never', state: 'failed',
      failureReason: 'Interrupted by a Kun runtime restart before the worker started this assignment'
    })

    await restore()

    expect(activity.get('wrk_never')).toMatchObject({ mainState: 'failed', lastOutcome: 'failed', title: 'W2' })
  })

  it('skips released, stale, and already-live workers', async () => {
    await stores.teams.upsertWorker('thr_mgr', workerRecord({ workerId: 'wrk_released', state: 'released' }))
    await stores.teams.upsertWorker('thr_mgr', workerRecord({
      workerId: 'wrk_stale', createdAt: '2026-09-01T00:00:00.000Z'
    }))
    await stores.teams.upsertWorker('thr_mgr', workerRecord({ workerId: 'wrk_live' }))
    activity.register({
      unitId: 'wrk_live', kind: 'worker', threadId: 'wrk_live', parentThreadId: 'thr_mgr',
      harnessId: 'kun', title: 'live', workspace: { path: '/repo', kind: 'local' }, mainState: 'working'
    })

    await expect(restore()).resolves.toBe(0)

    expect(activity.get('wrk_released')).toBeUndefined()
    expect(activity.get('wrk_stale')).toBeUndefined()
    expect(activity.get('wrk_live')).toMatchObject({ title: 'live', mainState: 'working' })
  })
})
