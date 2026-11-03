import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { RuntimeEvent } from '../contracts/events.js'
import {
  childRun,
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

function childEvent(kind: 'turn_failed' | 'turn_aborted', launcher = 'manager-worker'): RuntimeEvent {
  return {
    kind,
    threadId: 'thr_mgr',
    child: {
      parentThreadId: 'thr_mgr',
      parentTurnId: 'turn_mgr_1',
      childId: 'wrk_1',
      childStatus: kind === 'turn_failed' ? 'failed' : 'aborted',
      childLauncher: launcher
    }
  } as never
}

async function restartKilledWorker(): Promise<void> {
  await seedWorker(stores)
  await seedDispatch(stores, { dispatchId: 'dsp_1', state: 'accepted', title: 'W1' })
  await stores.childRuns.upsert(childRun({
    status: 'failed',
    launcher: 'manager-worker',
    detached: true,
    terminationReason: 'runtime_restart',
    error: 'Subagent run was interrupted by a runtime restart.'
  }))
}

describe('stranded worker dispatches', () => {
  it('fails an accepted dispatch whose child was killed before its turn started and tells the manager', async () => {
    await restartKilledWorker()
    const { lifecycle } = makeHarness(stores)

    expect(await lifecycle.handleWorkerChildSettled('thr_mgr', 'wrk_1')).toBe(true)

    const dispatch = await stores.dispatches.get('thr_mgr', 'dsp_1')
    expect(dispatch?.state).toBe('failed')
    expect(dispatch?.outcome).toBe('failed')
    expect(dispatch?.failureReason).toMatch(/runtime restart before the worker started/)
    const pending = await stores.notices.pending('thr_mgr')
    expect(pending).toHaveLength(1)
    expect(pending[0]).toMatchObject({ kind: 'dispatch_failed', dispatchId: 'dsp_1', title: 'W1' })
    expect(pending[0]!.detail).toMatch(/no work was done/)
  })

  it('settles from the manager-worker child-run event', async () => {
    await restartKilledWorker()
    const { lifecycle } = makeHarness(stores)

    lifecycle.handleRuntimeEvent(childEvent('turn_failed'))

    // The hook is fire-and-forget: the notice lands after the state write.
    await vi.waitFor(async () => {
      expect((await stores.dispatches.get('thr_mgr', 'dsp_1'))?.state).toBe('failed')
      expect(await stores.notices.pending('thr_mgr')).toHaveLength(1)
    })
  })

  it('ignores child events from other launchers', async () => {
    await restartKilledWorker()
    const { lifecycle } = makeHarness(stores)

    lifecycle.handleRuntimeEvent(childEvent('turn_failed', 'delegate_task'))
    await new Promise((resolve) => setTimeout(resolve, 20))

    expect((await stores.dispatches.get('thr_mgr', 'dsp_1'))?.state).toBe('accepted')
  })

  it('leaves dispatches whose worker turn started to the turn-terminal hook', async () => {
    await restartKilledWorker()
    await stores.threads.upsert({
      ...workerThread(),
      turns: [turnRecord({ status: 'running', clientRequestId: 'dsp_1' })]
    })
    const { lifecycle } = makeHarness(stores)

    expect(await lifecycle.handleWorkerChildSettled('thr_mgr', 'wrk_1')).toBe(false)
    expect((await stores.dispatches.get('thr_mgr', 'dsp_1'))?.state).toBe('accepted')
    expect(await stores.notices.pending('thr_mgr')).toHaveLength(0)
  })

  it('does nothing while the child is still queued for a slot', async () => {
    await seedWorker(stores)
    await seedDispatch(stores, { dispatchId: 'dsp_1', state: 'accepted' })
    await stores.childRuns.upsert(childRun({ status: 'queued', launcher: 'manager-worker', detached: true }))
    const { lifecycle } = makeHarness(stores)

    expect(await lifecycle.handleWorkerChildSettled('thr_mgr', 'wrk_1')).toBe(false)
    expect((await stores.dispatches.get('thr_mgr', 'dsp_1'))?.state).toBe('accepted')
  })

  it('reports a stop before the assignment started as a cancellation', async () => {
    await seedWorker(stores)
    await seedDispatch(stores, { dispatchId: 'dsp_1', state: 'accepted' })
    await stores.childRuns.upsert(childRun({
      status: 'aborted', launcher: 'manager-worker', detached: true, terminationReason: 'manual_stop'
    }))
    const { lifecycle } = makeHarness(stores)

    await lifecycle.handleWorkerChildSettled('thr_mgr', 'wrk_1')

    expect((await stores.dispatches.get('thr_mgr', 'dsp_1'))?.state).toBe('cancelled')
    expect((await stores.notices.pending('thr_mgr'))[0]?.kind).toBe('dispatch_cancelled')
  })

  it('settles without a notice when the user controls the worker', async () => {
    await restartKilledWorker()
    await stores.teams.updateWorker('thr_mgr', 'wrk_1', { control: 'user' })
    const { lifecycle } = makeHarness(stores)

    await lifecycle.handleWorkerChildSettled('thr_mgr', 'wrk_1')

    expect((await stores.dispatches.get('thr_mgr', 'dsp_1'))?.state).toBe('failed')
    expect(await stores.notices.pending('thr_mgr')).toHaveLength(0)
  })

  it('startup reconciliation settles restart-killed dispatches and delivers the next one', async () => {
    await restartKilledWorker()
    await seedDispatch(stores, { dispatchId: 'dsp_2', state: 'pending', title: 'W2' })
    const { lifecycle, delegation } = makeHarness(stores)

    await lifecycle.reconcileOnStartup()

    expect((await stores.dispatches.get('thr_mgr', 'dsp_1'))?.state).toBe('failed')
    expect((await stores.notices.pending('thr_mgr')).map((notice) => notice.dispatchId)).toEqual(['dsp_1'])
    expect(delegation.resumeChild).toHaveBeenCalledWith(expect.objectContaining({
      childId: 'wrk_1', clientRequestId: 'dsp_2'
    }))
    expect((await stores.dispatches.get('thr_mgr', 'dsp_2'))?.state).toBe('accepted')
  })
})
