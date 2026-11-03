import { describe, expect, it, vi } from 'vitest'
import { ServiceManagerState } from './service-manager-state.js'
import { FENCE_FLOOR_KEY, ServiceManagerStateSnapshotSchema } from './service-manager-state-snapshot.js'
import { ManagerStateWriteQueue } from './service-manager-state-write-queue.js'

function registration(instanceId: string) {
  return {
    flavor: 'production' as const,
    instanceId,
    pid: process.pid,
    startedAt: '2026-10-19T00:00:00.000Z',
    host: '127.0.0.1',
    port: 1,
    baseUrl: 'http://127.0.0.1:1',
    runtimeToken: 'runtime-token'
  }
}

const owner = { ownerFlavor: 'production' as const, ownerInstanceId: 'runtime-1' }

describe('manager fence high-water retirement', () => {
  it('keeps only leased resources in the snapshot and never reissues a retired token', () => {
    const state = new ServiceManagerState()
    const tokens: number[] = []
    for (let index = 0; index < 50; index += 1) {
      const { lease } = state.acquireResource({ resource: `data:${index}`, ...owner })
      tokens.push(lease.fencingToken)
      expect(state.releaseResource(lease)).toBe(true)
    }
    const held = state.acquireResource({ resource: 'desktop-host', ...owner }).lease
    const snapshot = state.durableSnapshot()
    expect(Object.keys(snapshot.resourceFenceHighWater).sort()).toEqual(['desktop-host', FENCE_FLOOR_KEY].sort())

    const restored = ServiceManagerState.restore(JSON.parse(JSON.stringify(snapshot)))
    for (const [index, previous] of tokens.entries()) {
      const { lease } = restored.acquireResource({ resource: `data:${index}`, ...owner })
      expect(lease.fencingToken).toBeGreaterThan(previous)
      restored.releaseResource(lease)
    }
    const renewed = restored.renewResource(held)
    expect(renewed?.fencingToken).toBe(held.fencingToken)
  })

  it('retires thread fences only after their lease and pending expiry are gone', () => {
    const state = new ServiceManagerState()
    state.register(registration('runtime-1'))
    const first = state.acquireLease({ threadId: 'thread-a', turnId: 'turn-1', ...owner })
    expect(state.releaseLease(first)).toBe(true)
    const live = state.acquireLease({ threadId: 'thread-b', turnId: 'turn-1', ...owner })
    const snapshot = state.durableSnapshot()
    expect(Object.keys(snapshot.threadLeaseFenceHighWater).sort()).toEqual(['thread-b', FENCE_FLOOR_KEY].sort())

    const restored = ServiceManagerState.restore(JSON.parse(JSON.stringify(snapshot)))
    restored.register(registration('runtime-1'))
    const again = restored.acquireLease({ threadId: 'thread-a', turnId: 'turn-2', ...owner })
    expect(again.fencingToken).toBeGreaterThan(first.fencingToken)
    expect(restored.lease('thread-b')?.fencingToken).toBe(live.fencingToken)
  })

  it('reads a floor written by this layout and folds a bloated legacy map on the next write', () => {
    const highWater = Object.fromEntries(Array.from({ length: 2_000 }, (_, index) => [`data:${index}`, index + 1]))
    const restored = ServiceManagerState.restore({
      ...new ServiceManagerState().durableSnapshot(),
      resourceFenceHighWater: highWater
    })
    const snapshot = restored.durableSnapshot()
    expect(snapshot.resourceFenceHighWater).toEqual({ [FENCE_FLOOR_KEY]: 2_000 })
    expect(ServiceManagerStateSnapshotSchema.parse(snapshot)).toEqual(snapshot)
    expect(restored.acquireResource({ resource: 'data:1999', ...owner }).lease.fencingToken).toBe(2_001)
  })
})

describe('lazy manager state snapshots', () => {
  it('builds one snapshot per durable write while mutations keep arriving', async () => {
    const state = new ServiceManagerState()
    let release!: () => void
    const writes: unknown[] = []
    const queue = new ManagerStateWriteQueue('unused.json', {
      writer: async (_path, snapshot) => {
        writes.push(snapshot)
        if (writes.length === 1) await new Promise<void>((resolve) => { release = resolve })
      }
    })
    const build = vi.spyOn(state, 'durableSnapshot')
    state.onMutation(() => queue.enqueue(() => state.durableSnapshot()))
    for (let index = 0; index < 100; index += 1) {
      const { lease } = state.acquireResource({ resource: `data:${index}`, ...owner })
      state.releaseResource(lease)
    }
    release()
    await queue.flush()
    expect(build).toHaveBeenCalledTimes(2)
    expect(writes).toHaveLength(2)
  })
})
