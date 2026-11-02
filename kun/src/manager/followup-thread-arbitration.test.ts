import { afterEach, describe, expect, it, vi } from 'vitest'
import type { ThreadStore } from '../ports/thread-store.js'
import { control, time } from '../rooms/room-collaboration-test-fixtures.js'
import { FOLLOW_UP_ARBITRATION_LEASE, ManagerFollowUpWriteArbitration } from './followup-arbitration.js'
import { requestManagerJson } from './manager-client.js'
import { nativeManagerFixture, type NativeManagerFixture } from './followup-thread-test-support.js'

const fixtures: NativeManagerFixture[] = []
afterEach(async () => {
  vi.restoreAllMocks()
  for (const fixture of fixtures.splice(0)) await fixture.close()
})
function deferred() {
  let resolve!: () => void
  const promise = new Promise<void>((done) => { resolve = done })
  return { promise, resolve }
}
async function within(promise: Promise<void>): Promise<void> {
  let timer: ReturnType<typeof setTimeout> | undefined
  try {
    await Promise.race([promise, new Promise<never>((_, reject) => {
      timer = setTimeout(() => reject(new Error('deterministic arbitration barrier was not reached')), 5000)
    })])
  } finally { if (timer) clearTimeout(timer) }
}

describe('Manager physical follow-up arbitration', () => {
  it.each([false, true])('keeps replacement stop behind outstanding native persistence; reject=%s', async (rejectWrite) => {
    const h = await nativeManagerFixture(); fixtures.push(h); await h.seed()
    const enteredWrite = deferred(), releaseWrite = deferred(), stopEnqueued = deferred()
    const physical = h.data.threadStore as ThreadStore & Required<Pick<ThreadStore, 'upsertIfRevision'>>
    const originalWrite = physical.upsertIfRevision.bind(physical)
    const writeSpy = vi.spyOn(physical, 'upsertIfRevision').mockImplementation(async (thread, revision) => {
      enteredWrite.resolve()
      await releaseWrite.promise
      if (rejectWrite) throw new Error('simulated native persistence failure')
      return originalWrite(thread, revision)
    })
    const originalRun = ManagerFollowUpWriteArbitration.prototype.run
    let calls = 0
    const queueSpy = vi.spyOn(ManagerFollowUpWriteArbitration.prototype, 'run').mockImplementation(
      function <T>(this: ManagerFollowUpWriteArbitration, operation: () => Promise<T>): Promise<T> {
        const result = originalRun.call(this, operation) as Promise<T>
        if (++calls === 2) stopEnqueued.resolve()
        return result
      }
    )
    const native = h.send(h.next, h.scope).then((result) => ({ result }), (error: unknown) => ({ error }))
    let stop: Promise<{ result: unknown } | { error: unknown }> | undefined
    try {
      await within(enteredWrite.promise)
      const previous = h.scope.arbitration
      expect(h.state.endResourceCommit(previous.fence, previous.commitId)).toBe(true)
      expect(h.state.releaseResource(previous.fence)).toBe(true)
      h.state.register({ flavor: 'development', instanceId: 'replacement', pid: process.pid,
        startedAt: new Date().toISOString(), host: '127.0.0.1', port: 18899,
        baseUrl: 'http://127.0.0.1:18899', runtimeToken: 'replacement-token' })
      const arb = h.state.acquireResource({ resource: FOLLOW_UP_ARBITRATION_LEASE,
        ownerFlavor: 'development', ownerInstanceId: 'replacement' })
      expect(arb.acquired).toBe(true)
      const arbFence = { resource: arb.lease.resource, ownerFlavor: arb.lease.ownerFlavor,
        ownerInstanceId: arb.lease.ownerInstanceId, fencingToken: arb.lease.fencingToken }
      expect(h.state.beginResourceCommit(arbFence, 'replacement-commit')).not.toBeNull()
      const room = h.state.acquireResource({ resource: 'rooms-coordinator',
        ownerFlavor: 'development', ownerInstanceId: 'replacement' })
      expect(room.acquired).toBe(true)
      const roomFence = { resource: room.lease.resource, ownerFlavor: room.lease.ownerFlavor,
        ownerInstanceId: room.lease.ownerInstanceId, fencingToken: room.lease.fencingToken }
      const stopped = { ...control(), generation: 1, authorizationEpoch: 1,
        paused: true, trackingEnabled: false, stoppedAt: time }
      stop = requestManagerJson(h.connection, '/v1/data/room/commit', { method: 'POST', body: {
        input: { requestId: 'replacement-stop', checks: [{ kind: 'commitment_control', id: stopped.id, expectedRevision: 0 }],
          puts: [{ kind: 'commitment_control', id: stopped.id, value: stopped }] },
        fence: roomFence, arbitration: { fence: arbFence, commitId: 'replacement-commit' }
      } }).then((result) => ({ result }), (error: unknown) => ({ error }))
      let stopSettled = false
      void stop.then(() => { stopSettled = true })
      await within(stopEnqueued.promise)
      expect((await h.data.roomStore.get('commitment_control', stopped.id))?.value).toMatchObject({ trackingEnabled: true })
      expect(stopSettled).toBe(false)
      releaseWrite.resolve()
      const first = await native
      if (rejectWrite) expect(first).toHaveProperty('error.status', 500)
      else expect(first).toHaveProperty('result.result.applied', true)
      expect(await stop).toHaveProperty('result.result.duplicate', false)
      expect((await h.data.roomStore.get('commitment_control', stopped.id))?.value).toMatchObject({ stoppedAt: time })
      const stored = await h.data.threadStore.getMetadata!('thread')
      expect(stored?.turns).toHaveLength(rejectWrite ? 0 : 1)
    } finally {
      releaseWrite.resolve()
      await native
      if (stop) await stop
      queueSpy.mockRestore()
      writeSpy.mockRestore()
    }
  })
})
