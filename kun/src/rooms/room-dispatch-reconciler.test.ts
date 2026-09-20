import { describe, expect, it, vi } from 'vitest'
import { RoomDispatchReconciler, type RoomDispatchIntent, type RoomTurnAdmissionPort } from './room-dispatch-reconciler.js'

function harness() {
  let record: RoomDispatchIntent = {
    id: 'dispatch_one', roomId: 'room_one', taskId: 'task_one', stepId: 'step_one',
    attemptId: 'attempt_one', threadId: 'thread_one', clientRequestId: 'request_one',
    requestFingerprint: 'a'.repeat(64), state: 'pending', revision: 0
  }
  let admission: Awaited<ReturnType<RoomTurnAdmissionPort['findAdmission']>> = { status: 'absent' }
  const store = {
    load: vi.fn(async () => structuredClone(record)),
    assertOwnership: vi.fn(async () => {}),
    save: vi.fn(async (next: RoomDispatchIntent, revision: number) => {
      if (record.revision !== revision) throw new Error('revision conflict')
      record = structuredClone(next)
    })
  }
  const turns = {
    findAdmission: vi.fn(async () => admission),
    ensureThread: vi.fn(async () => {}),
    enqueue: vi.fn(async () => {
      admission = { status: 'found', turnId: 'turn_one', requestFingerprint: record.requestFingerprint }
      return { turnId: 'turn_one' }
    })
  }
  return { store, turns, current: () => record,
    setAdmission: (next: typeof admission) => { admission = next },
    reconciler: new RoomDispatchReconciler(store, turns) }
}

describe('room dispatch reconciliation', () => {
  it('coalesces concurrent dispatches and returns the same admitted turn', async () => {
    const h = harness()
    const [a, b] = await Promise.all([h.reconciler.dispatch('dispatch_one'), h.reconciler.dispatch('dispatch_one')])
    expect(a.turnId).toBe('turn_one')
    expect(b).toEqual(a)
    expect(h.turns.enqueue).toHaveBeenCalledTimes(1)
    await h.reconciler.dispatch('dispatch_one')
    expect(h.turns.enqueue).toHaveBeenCalledTimes(1)
  })
  it('recovers a lost enqueue response without sending the request again', async () => {
    const h = harness()
    h.turns.enqueue.mockImplementationOnce(async () => {
      h.setAdmission({ status: 'found', turnId: 'turn_one', requestFingerprint: 'a'.repeat(64) })
      throw new Error('response lost after commit')
    })
    expect((await h.reconciler.dispatch('dispatch_one')).state).toBe('admitted')
    expect(h.turns.enqueue).toHaveBeenCalledTimes(1)
  })
  it('recovers a crash between thread admission and room mapping', async () => {
    const h = harness()
    h.setAdmission({ status: 'found', turnId: 'turn_old', requestFingerprint: 'a'.repeat(64) })
    expect((await h.reconciler.dispatch('dispatch_one')).turnId).toBe('turn_old')
    expect(h.turns.ensureThread).not.toHaveBeenCalled()
    expect(h.turns.enqueue).not.toHaveBeenCalled()
  })
  it('does not replay unknown admission results', async () => {
    const h = harness()
    h.setAdmission({ status: 'unknown' })
    expect((await h.reconciler.dispatch('dispatch_one')).state).toBe('recovery_required')
    expect(h.turns.enqueue).not.toHaveBeenCalled()
  })
  it('rejects a request fingerprint mismatch rather than adopting another turn', async () => {
    const h = harness()
    h.setAdmission({ status: 'found', turnId: 'wrong_turn', requestFingerprint: 'b'.repeat(64) })
    expect((await h.reconciler.dispatch('dispatch_one')).state).toBe('recovery_required')
    expect(h.turns.enqueue).not.toHaveBeenCalled()
  })
  it('does not admit work from a stale runtime owner', async () => {
    const h = harness()
    h.store.assertOwnership.mockRejectedValueOnce(new Error('stale fence'))
    await expect(h.reconciler.dispatch('dispatch_one')).rejects.toThrow('stale fence')
    expect(h.turns.enqueue).not.toHaveBeenCalled()
    expect(h.current().state).toBe('pending')
  })
})
