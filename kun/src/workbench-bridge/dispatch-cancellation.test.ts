import { describe, expect, it, vi } from 'vitest'
import type { WorkbenchLink } from '../contracts/workbench-links.js'
import { AgentDispatchService } from '../delegation/agent-dispatch-service.js'
import { createTurnRecord } from '../domain/turn.js'
import { WorkbenchBridge } from './bridge.js'
import { dispatchFixture as fixture } from './dispatch-test-support.js'
import { reconcileWorkbench } from './reconcile.js'
import { updateWorkbenchLink } from './link-store.js'
import { claimWorkbenchAdmission, reconcileWorkbenchCancellation, recordWorkbenchAdmission } from './task-admission.js'

vi.mock('../rooms/room-continuation-service.js', () => ({ enqueuePrivateContinuation: vi.fn(async () => 'queued') }))

function barrier() {
  let release!: () => void
  let entered!: () => void
  return { wait: new Promise<void>((resolve) => { release = resolve }), entered: new Promise<void>((resolve) => { entered = resolve }),
    release: () => release(), enter: () => entered() }
}

async function prepared(extra: Record<string, unknown> = {}) {
  const f = await fixture()
  const created = await f.create(extra)
  f.clock.now += 60_000
  await f.service.reconcile()
  await reconcileWorkbench(f.bridge)
  expect(f.stub.calls.created).toHaveLength(1)
  expect(f.stub.calls.enqueued).toHaveLength(0)
  const cancel = async () => {
    const intent = await f.intent(created.dispatchIntentId)
    await f.service.act(intent.intentId, { action: 'cancel', expectedRevision: intent.revision, requestId: 'cancel-admission' })
    await f.service.reconcile()
  }
  return { ...f, created, cancel }
}

describe('durable Workbench cancellation versus first-turn admission', () => {
  it('does not enqueue after cancellation while the final permission update is pending', async () => {
    const f = await prepared()
    const blocked = barrier()
    const update = f.deps.threads.update.bind(f.deps.threads)
    f.deps.threads.update = async (...args: Parameters<typeof update>) => {
      if ('approvalPolicy' in args[1]) { blocked.enter(); await blocked.wait }
      return update(...args)
    }
    const admission = reconcileWorkbench(f.bridge)
    await blocked.entered
    try {
      await f.cancel()
      expect((await f.intent(f.created.dispatchIntentId)).state).toBe('cancelled')
    } finally { blocked.release() }
    await admission
    expect(f.stub.calls.enqueued).toHaveLength(0)
    expect((await f.link(f.created.linkId)).value.status).toBe('cancelled')
  })

  it('lets cancellation win the claim CAS instead of admitting from a stale link', async () => {
    const f = await prepared()
    const blocked = barrier()
    const commit = f.store.commit.bind(f.store)
    let held = false
    const spy = vi.spyOn(f.store, 'commit').mockImplementation(async (input) => {
      if (!held && input.puts?.some((put) => put.kind === 'workbench_link' && (put.value as WorkbenchLink).admissionAttempted)) {
        held = true
        blocked.enter()
        await blocked.wait
      }
      return commit(input)
    })
    const admission = reconcileWorkbench(f.bridge)
    await blocked.entered
    try { await f.cancel() } finally { blocked.release() }
    await admission
    spy.mockRestore()
    expect(f.stub.calls.enqueued).toHaveLength(0)
    expect((await f.intent(f.created.dispatchIntentId)).state).toBe('cancelled')
  })

  it('stops a preparing worktree whose identity is published after cancellation', async () => {
    const f = await prepared({ isolation: 'worktree' })
    const cancelled = vi.fn()
    f.bridge.attach({ taskWorkspaces: { create: () => ({ workspaceId: 'late-workspace' }), cancel: cancelled } as never })
    const blocked = barrier()
    const commit = f.store.commit.bind(f.store)
    let held = false
    const spy = vi.spyOn(f.store, 'commit').mockImplementation(async (input) => {
      if (!held && input.puts?.some((put) => put.kind === 'workbench_link' && (put.value as WorkbenchLink).taskWorkspaceId === 'late-workspace')) {
        held = true
        blocked.enter()
        await blocked.wait
      }
      return commit(input)
    })
    const admission = reconcileWorkbench(f.bridge)
    await blocked.entered
    try { await f.cancel() } finally { blocked.release() }
    await admission
    spy.mockRestore()
    expect(cancelled).toHaveBeenCalledWith('late-workspace')
    expect(f.stub.calls.enqueued).toHaveLength(0)
    expect((await f.intent(f.created.dispatchIntentId)).state).toBe('cancelled')
  })

  it('keeps a claimed admission stopping and interrupts its late receipt without touching another turn', async () => {
    const f = await prepared()
    const blocked = barrier()
    const enqueue = f.deps.turns.enqueueTurn.bind(f.deps.turns)
    f.deps.turns.enqueueTurn = async (input) => { blocked.enter(); await blocked.wait; return enqueue(input) }
    const admission = reconcileWorkbench(f.bridge)
    await blocked.entered
    try {
      await f.cancel()
      expect((await f.intent(f.created.dispatchIntentId)).state).toBe('stopping')
      expect((await f.link(f.created.linkId)).value).toMatchObject({ cancelRequested: true, admissionAttempted: true,
        status: 'recovery_required' })
      const wakes = f.wakes.count
      const pending = (await f.link(f.created.linkId)).value
      await reconcileWorkbenchCancellation(f.bridge, pending)
      await reconcileWorkbenchCancellation(f.bridge, pending)
      expect(f.wakes.count).toBe(wakes)
      const threadId = (await f.link(f.created.linkId)).value.threadId!
      f.stub.threads.get(threadId)!.turns.push(createTurnRecord({ id: 'unrelated-user-turn', threadId,
        prompt: 'unrelated', clientRequestId: 'user-request', status: 'running' }))
      f.deps.proveStopped = vi.fn(async () => false)
      f.deps.proveTurnStopped = vi.fn(async (id, turnId) => f.stub.threads.get(id)!.turns.find((turn) => turn.id === turnId)?.status === 'aborted')
      f.deps.stopBackgroundExecution = vi.fn(async () => {})
    } finally { blocked.release() }
    await admission
    await f.service.reconcile()
    expect((await f.intent(f.created.dispatchIntentId)).state).toBe('cancelled')
    const link = (await f.link(f.created.linkId)).value
    expect(link.status).toBe('cancelled')
    expect(link.error).toBeUndefined()
    expect(f.stub.calls.enqueued).toHaveLength(1)
    expect(f.stub.calls.interrupted).toEqual([link.turnId])
    expect(f.deps.proveStopped).not.toHaveBeenCalled()
    expect(f.deps.proveTurnStopped).toHaveBeenCalledWith(link.threadId, link.turnId)
    expect(f.deps.stopBackgroundExecution).toHaveBeenCalledWith(link.threadId, link.turnId)
    expect(f.stub.threads.get(link.threadId!)!.turns.find((turn) => turn.id === 'unrelated-user-turn')!.status).toBe('running')
  })

  it('recovers a missing receipt after runtime restart without treating absence as cancelled or enqueuing again', async () => {
    const f = await prepared()
    const enqueue = vi.spyOn(f.deps.turns, 'enqueueTurn').mockRejectedValue(new Error('lost admission receipt'))
    await reconcileWorkbench(f.bridge)
    await f.cancel()
    expect((await f.intent(f.created.dispatchIntentId)).state).toBe('stopping')
    await f.service.stop()
    const recovered = new AgentDispatchService({ store: f.intentStore, applicationSessionId: 'app-session', now: () => f.clock.now })
    const bridge = new WorkbenchBridge(f.deps, f.bridge.service, () => {})
    bridge.attach({ agentDispatch: recovered })
    try {
      await recovered.start()
      await reconcileWorkbench(bridge)
      await recovered.reconcile()
      expect((await recovered.get(f.created.dispatchIntentId))!.state).toBe('stopping')
      const link = (await f.link(f.created.linkId)).value
      f.stub.threads.get(link.threadId!)!.turns.push(createTurnRecord({ id: 'recovered-admission', threadId: link.threadId!,
        prompt: 'admitted before restart', clientRequestId: link.clientRequestId, status: 'queued' }))
      await reconcileWorkbench(bridge)
      await recovered.reconcile()
      expect(enqueue).toHaveBeenCalledTimes(1)
      expect(f.stub.calls.interrupted).toEqual(['recovered-admission'])
      expect((await recovered.get(f.created.dispatchIntentId))!.state).toBe('cancelled')
      expect((await f.link(f.created.linkId)).value).toMatchObject({ status: 'cancelled', turnId: 'recovered-admission' })
    } finally { await recovered.stop() }
  })

  it('retries failed stop calls and waits for execution to be proven stopped', async () => {
    const f = await prepared()
    await reconcileWorkbench(f.bridge)
    const original = f.deps.turns.interruptTurn.bind(f.deps.turns)
    vi.spyOn(f.deps.turns, 'interruptTurn').mockRejectedValueOnce(new Error('temporary stop transport error')).mockImplementation(original)
    let stopped = false
    f.deps.proveStopped = async () => stopped
    await f.cancel()
    expect((await f.intent(f.created.dispatchIntentId)).state).toBe('stopping')
    await reconcileWorkbench(f.bridge)
    await f.service.reconcile()
    expect((await f.intent(f.created.dispatchIntentId)).state).toBe('stopping')
    stopped = true
    await reconcileWorkbench(f.bridge)
    await f.service.reconcile()
    expect((await f.intent(f.created.dispatchIntentId)).state).toBe('cancelled')
    expect(f.stub.calls.enqueued).toHaveLength(1)
  })

  it('does not attach a stale receipt or claim to a newer replacement generation', async () => {
    const f = await prepared()
    const old = (await f.link(f.created.linkId)).value
    await updateWorkbenchLink(f.store, f.room.id, old.id, () => ({ dispatchReplacementCount: 1,
      threadId: undefined, clientRequestId: undefined, status: 'awaiting_confirmation' }))
    await recordWorkbenchAdmission(f.bridge, old, old.clientRequestId!, 'old-admission')
    expect((await f.link(old.id)).value).toMatchObject({ status: 'awaiting_confirmation', dispatchReplacementCount: 1 })
    expect((await f.link(old.id)).value.turnId).toBeUndefined()
    await updateWorkbenchLink(f.store, f.room.id, old.id, () => ({ status: 'queued', threadId: 'replacement-thread', clientRequestId: 'new-request' }))
    expect(await claimWorkbenchAdmission(f.bridge, old, old.clientRequestId!)).toBe(false)
    expect((await f.link(old.id)).value.admissionAttempted).toBeUndefined()
    expect(f.stub.calls.enqueued).toHaveLength(0)
  })

  it('uses exact terminal proof when a persisted target has left the metadata projection', async () => {
    const f = await prepared()
    await reconcileWorkbench(f.bridge)
    const link = (await f.link(f.created.linkId)).value
    const thread = f.stub.threads.get(link.threadId!)!
    thread.turns[0].status = 'aborted'
    f.deps.threads.getMetadata = async (id) => id === thread.id ? { ...thread, turns: [] } : null
    const proof = vi.fn(async () => false)
    f.deps.proveTurnStopped = proof
    await f.cancel()
    expect((await f.intent(f.created.dispatchIntentId)).state).toBe('stopping')
    proof.mockResolvedValue(true)
    await reconcileWorkbench(f.bridge)
    await f.service.reconcile()
    expect(proof).toHaveBeenCalledWith(link.threadId, link.turnId)
    expect((await f.intent(f.created.dispatchIntentId)).state).toBe('cancelled')
    expect(f.stub.calls.enqueued).toHaveLength(1)
  })
})
