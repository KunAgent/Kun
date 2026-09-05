import { describe, expect, it } from 'vitest'
import {
  ServiceManagerState,
  StaleTurnFenceError,
  ThreadLeaseBusyError
} from './service-manager.js'

function registration(flavor: 'production' | 'development') {
  return {
    flavor,
    instanceId: `${flavor}-runtime`,
    pid: process.pid,
    startedAt: '2026-08-01T00:00:00.000Z',
    host: '127.0.0.1',
    port: flavor === 'production' ? 18899 : 18999,
    baseUrl: `http://127.0.0.1:${flavor === 'production' ? 18899 : 18999}`,
    runtimeToken: `${flavor}-secret`
  }
}

describe('service manager fencing and host liveness', () => {
  it('increments thread fencing tokens and rejects old owners after reacquire', () => {
    const state = new ServiceManagerState()
    const started = new Date('2026-08-01T00:00:00.000Z')
    state.register(registration('production'), started)
    const first = state.acquireLease({
      threadId: 'thread-fenced',
      turnId: 'turn-first',
      ownerFlavor: 'production',
      ownerInstanceId: 'production-runtime'
    }, started)
    expect(first.fencingToken).toBe(1)
    expect(state.releaseLease(first)).toBe(true)
    const second = state.acquireLease({
      threadId: 'thread-fenced',
      turnId: 'turn-second',
      ownerFlavor: 'production',
      ownerInstanceId: 'production-runtime'
    }, new Date('2026-08-01T00:00:01.000Z'))
    expect(second.fencingToken).toBe(2)
    expect(state.releaseLease(first)).toBe(false)
    expect(state.renewLease(first, new Date('2026-08-01T00:00:02.000Z'))).toBeNull()
    expect(() => state.assertTurnMutationFence(first)).toThrow(StaleTurnFenceError)

    const restored = ServiceManagerState.restore(state.durableSnapshot())
    expect(restored.releaseLease(second)).toBe(true)
    expect(restored.acquireLease({
      threadId: 'thread-fenced',
      turnId: 'turn-third',
      ownerFlavor: 'production',
      ownerInstanceId: 'production-runtime'
    }, new Date('2026-08-01T00:00:03.000Z')).fencingToken).toBe(3)
  })

  it('persists expired-owner reconciliation and blocks reacquisition until it completes', () => {
    const state = new ServiceManagerState()
    const started = new Date('2026-08-01T00:00:00.000Z')
    state.register(registration('production'), started)
    const first = state.acquireLease({
      threadId: 'thread-pending-reconciliation',
      turnId: 'turn-expired',
      ownerFlavor: 'production',
      ownerInstanceId: 'production-runtime'
    }, started)
    let expired: typeof first[] = []
    for (let seconds = 1; seconds <= 21; seconds += 1) {
      expired = state.expireStale(new Date(started.getTime() + seconds * 1_000))
    }
    expect(expired).toContainEqual(first)

    const restored = ServiceManagerState.restore(state.durableSnapshot())
    const reacquiredAt = new Date('2026-08-01T00:00:22.000Z')
    restored.register(registration('production'), reacquiredAt)
    expect(() => restored.acquireLease({
      threadId: first.threadId,
      turnId: 'turn-new',
      ownerFlavor: 'production',
      ownerInstanceId: 'production-runtime'
    }, reacquiredAt)).toThrow(ThreadLeaseBusyError)
    expect(restored.completeExpiredLeaseReconciliation(first)).toBe(true)
    expect(restored.acquireLease({
      threadId: first.threadId,
      turnId: 'turn-new',
      ownerFlavor: 'production',
      ownerInstanceId: 'production-runtime'
    }, reacquiredAt).fencingToken).toBe(2)
  })

  it('preserves live leases across explicit suspend and timer gaps', () => {
    const state = new ServiceManagerState()
    const started = new Date('2026-08-01T00:00:00.000Z')
    state.register(registration('production'), started)
    const lease = state.acquireLease({
      threadId: 'thread-sleep',
      turnId: 'turn-sleep',
      ownerFlavor: 'production',
      ownerInstanceId: 'production-runtime'
    }, started)
    expect(state.expireStale(new Date('2026-08-01T00:00:01.000Z'))).toEqual([])
    state.noteHostSuspended(new Date('2026-08-01T00:00:02.000Z'))
    state.noteHostResumed(new Date('2026-08-01T01:00:02.000Z'))
    expect(state.expireStale(new Date('2026-08-01T01:00:03.000Z'))).toEqual([])
    expect(() => state.assertTurnMutationFence(
      lease,
      new Date('2026-08-01T01:00:03.000Z')
    )).not.toThrow()

    const fallback = new ServiceManagerState()
    fallback.register(registration('production'), started)
    fallback.acquireLease({
      threadId: 'thread-gap',
      turnId: 'turn-gap',
      ownerFlavor: 'production',
      ownerInstanceId: 'production-runtime'
    }, started)
    fallback.expireStale(new Date('2026-08-01T00:00:01.000Z'))
    expect(fallback.expireStale(new Date('2026-08-01T01:00:01.000Z'))).toEqual([])
    expect(fallback.lease('thread-gap', new Date('2026-08-01T01:00:02.000Z'))).not.toBeNull()
  })

  it('revalidates direct lease and resource requests before expiring owners after a timer gap', () => {
    const state = new ServiceManagerState()
    const started = new Date('2026-08-01T00:00:00.000Z')
    state.register(registration('production'), started)
    const lease = state.acquireLease({
      threadId: 'thread-direct-gap',
      turnId: 'turn-direct-gap',
      ownerFlavor: 'production',
      ownerInstanceId: 'production-runtime'
    }, started)
    const resource = state.acquireResource({
      resource: 'resource-direct-gap',
      ownerFlavor: 'production',
      ownerInstanceId: 'production-runtime'
    }, started).lease
    state.expireStale(new Date('2026-08-01T00:00:01.000Z'))

    const renewed = state.renewLease(lease, new Date('2026-08-01T01:00:01.000Z'))
    expect(renewed).toMatchObject({ fencingToken: lease.fencingToken })
    expect(state.renewResource(resource, new Date('2026-08-01T01:00:01.000Z')))
      .toMatchObject({ fencingToken: resource.fencingToken })
    expect(() => state.assertTurnMutationFence(
      renewed!,
      new Date('2026-08-01T01:00:02.000Z')
    )).not.toThrow()
  })

  it('keeps competing owners busy while an explicit host suspension is unresolved', () => {
    const state = new ServiceManagerState()
    const started = new Date('2026-08-01T00:00:00.000Z')
    state.register(registration('production'), started)
    state.register(registration('development'), started)
    const lease = state.acquireLease({
      threadId: 'thread-suspended-owner',
      turnId: 'turn-suspended-owner',
      ownerFlavor: 'production',
      ownerInstanceId: 'production-runtime'
    }, started)
    const resource = state.acquireResource({
      resource: 'resource-suspended-owner',
      ownerFlavor: 'production',
      ownerInstanceId: 'production-runtime'
    }, started).lease
    state.noteHostSuspended(new Date('2026-08-01T00:00:02.000Z'))
    const wake = new Date('2026-08-01T01:00:00.000Z')

    expect(() => state.acquireLease({
      threadId: lease.threadId,
      turnId: 'turn-competitor',
      ownerFlavor: 'development',
      ownerInstanceId: 'development-runtime'
    }, wake)).toThrow(ThreadLeaseBusyError)
    expect(state.acquireResource({
      resource: resource.resource,
      ownerFlavor: 'development',
      ownerInstanceId: 'development-runtime'
    }, wake)).toMatchObject({ acquired: false, lease: { fencingToken: resource.fencingToken } })
    expect(() => state.assertTurnMutationFence(lease, wake)).not.toThrow()
  })

  it('ignores delayed host power reports from an older sequence', () => {
    const state = new ServiceManagerState()
    expect(state.reportHostPower({
      phase: 'resume',
      sourceId: 'electron-main',
      sequence: 2,
      observedAt: new Date('2026-08-01T01:00:00.000Z')
    })).toBe(true)
    expect(state.reportHostPower({
      phase: 'suspend',
      sourceId: 'electron-main',
      sequence: 1,
      observedAt: new Date('2026-08-01T00:00:00.000Z')
    })).toBe(false)
    expect(state.expireStale(new Date('2026-08-01T01:00:01.000Z'))).toEqual([])
  })

  it('orders power reports across process sources and persists the watermark', () => {
    const state = new ServiceManagerState()
    expect(state.reportHostPower({
      phase: 'resume',
      sourceId: 'electron-main-new',
      sequence: 1,
      observedAt: new Date('2026-08-01T01:00:00.000Z')
    })).toBe(true)
    const restored = ServiceManagerState.restore(state.durableSnapshot())

    expect(restored.reportHostPower({
      phase: 'suspend',
      sourceId: 'electron-main-old',
      sequence: 99,
      observedAt: new Date('2026-08-01T00:59:59.000Z')
    })).toBe(false)
    expect(restored.reportHostPower({
      phase: 'suspend',
      sourceId: 'electron-main-new',
      sequence: 1,
      observedAt: new Date('2026-08-01T01:00:01.000Z')
    })).toBe(false)
  })

  it('rejects a cross-process report tied on the global timestamp', () => {
    const state = new ServiceManagerState()
    const observedAt = new Date('2026-08-01T01:00:00.000Z')
    expect(state.reportHostPower({
      phase: 'resume', sourceId: 'electron-main-new', sequence: 1, observedAt
    })).toBe(true)
    expect(state.reportHostPower({
      phase: 'suspend', sourceId: 'electron-main-old', sequence: 1, observedAt
    })).toBe(false)
  })

  it('accepts a new source after the host wall clock is rolled back', () => {
    const state = new ServiceManagerState()
    expect(state.reportHostPower({
      phase: 'resume', sourceId: 'electron-main-old', sequence: 1,
      observedAt: new Date('2026-08-01T02:00:00.000Z'),
      receivedAt: new Date('2026-08-01T02:00:00.000Z')
    })).toBe(true)
    expect(state.reportHostPower({
      phase: 'suspend', sourceId: 'electron-main-new', sequence: 1,
      observedAt: new Date('2026-08-01T01:00:00.000Z'),
      receivedAt: new Date('2026-08-01T01:00:00.000Z')
    })).toBe(true)
  })

  it('retires the previous process source after a wall-clock rollback', () => {
    const state = new ServiceManagerState()
    expect(state.reportHostPower({
      phase: 'resume', sourceId: 'electron-main-old', sequence: 1,
      observedAt: new Date('2026-08-01T02:00:00.000Z'),
      receivedAt: new Date('2026-08-01T02:00:00.000Z')
    })).toBe(true)
    expect(state.reportHostPower({
      phase: 'suspend', sourceId: 'electron-main-new', sequence: 1,
      observedAt: new Date('2026-08-01T01:00:00.000Z'),
      receivedAt: new Date('2026-08-01T01:00:00.000Z')
    })).toBe(true)
    expect(state.reportHostPower({
      phase: 'resume', sourceId: 'electron-main-new', sequence: 2,
      observedAt: new Date('2026-08-01T01:00:05.000Z'),
      receivedAt: new Date('2026-08-01T01:00:05.000Z')
    })).toBe(true)

    expect(state.reportHostPower({
      phase: 'suspend', sourceId: 'electron-main-old', sequence: 2,
      observedAt: new Date('2026-08-01T02:01:00.000Z'),
      receivedAt: new Date('2026-08-01T01:00:06.000Z')
    })).toBe(false)
  })

  it('deduplicates a retried resume notification', () => {
    const state = new ServiceManagerState()
    const started = new Date('2026-08-01T00:00:00.000Z')
    state.register(registration('production'), started)
    state.acquireLease({
      threadId: 'thread-idempotent-resume',
      turnId: 'turn-idempotent-resume',
      ownerFlavor: 'production',
      ownerInstanceId: 'production-runtime'
    }, started)
    state.expireStale(new Date('2026-08-01T00:00:01.000Z'))
    expect(state.reportHostPower({
      phase: 'resume', sourceId: 'electron-main', sequence: 1,
      observedAt: new Date('2026-08-01T01:00:01.000Z')
    })).toBe(true)
    const firstExpiry = state.lease(
      'thread-idempotent-resume', new Date('2026-08-01T01:00:01.000Z')
    )?.expiresAt

    expect(state.reportHostPower({
      phase: 'resume', sourceId: 'electron-main', sequence: 1,
      observedAt: new Date('2026-08-01T01:00:02.000Z')
    })).toBe(false)
    expect(state.lease(
      'thread-idempotent-resume', new Date('2026-08-01T01:00:02.000Z')
    )?.expiresAt).toBe(firstExpiry)
    expect(state.reportHostPower({
      phase: 'resume', sourceId: 'electron-main', sequence: 2,
      observedAt: new Date('2026-08-01T01:00:02.000Z')
    })).toBe(true)
    expect(state.lease(
      'thread-idempotent-resume', new Date('2026-08-01T01:00:02.000Z')
    )?.expiresAt).toBe(firstExpiry)
  })

  it('does not extend deadlines for later consecutive resume sequences', () => {
    const state = new ServiceManagerState()
    const started = new Date('2026-08-01T00:00:00.000Z')
    state.register(registration('production'), started)
    state.acquireLease({
      threadId: 'thread-consecutive-resume',
      turnId: 'turn-consecutive-resume',
      ownerFlavor: 'production',
      ownerInstanceId: 'production-runtime'
    }, started)
    state.expireStale(new Date('2026-08-01T00:00:01.000Z'))
    expect(state.reportHostPower({
      phase: 'resume', sourceId: 'electron-main', sequence: 1,
      observedAt: new Date('2026-08-01T01:00:01.000Z')
    })).toBe(true)
    const firstExpiry = state.lease(
      'thread-consecutive-resume', new Date('2026-08-01T01:00:01.000Z')
    )?.expiresAt
    for (let second = 2; second <= 11; second += 1) {
      state.expireStale(new Date(`2026-08-01T01:00:${String(second).padStart(2, '0')}.000Z`))
    }

    expect(state.reportHostPower({
      phase: 'resume', sourceId: 'electron-main', sequence: 2,
      observedAt: new Date('2026-08-01T01:00:12.000Z')
    })).toBe(true)
    expect(state.lease(
      'thread-consecutive-resume', new Date('2026-08-01T01:00:12.000Z')
    )?.expiresAt).toBe(firstExpiry)
  })

  it('recovers when a suspend sequence was lost before the next resume', () => {
    const state = new ServiceManagerState()
    const started = new Date('2026-08-01T00:00:00.000Z')
    state.register(registration('production'), started)
    state.acquireLease({
      threadId: 'thread-lost-suspend',
      turnId: 'turn-lost-suspend',
      ownerFlavor: 'production',
      ownerInstanceId: 'production-runtime'
    }, started)
    state.expireStale(new Date('2026-08-01T00:00:01.000Z'))
    expect(state.reportHostPower({
      phase: 'resume', sourceId: 'electron-main', sequence: 2,
      observedAt: new Date('2026-08-01T01:00:01.000Z')
    })).toBe(true)
    const firstExpiry = state.lease(
      'thread-lost-suspend', new Date('2026-08-01T01:00:01.000Z')
    )?.expiresAt

    expect(state.reportHostPower({
      phase: 'resume', sourceId: 'electron-main', sequence: 4,
      observedAt: new Date('2026-08-01T01:00:02.000Z')
    })).toBe(true)
    expect(state.lease(
      'thread-lost-suspend', new Date('2026-08-01T01:00:02.000Z')
    )?.expiresAt).not.toBe(firstExpiry)
  })

  it('rejects a delayed suspend after automatic clock-gap recovery', () => {
    const state = new ServiceManagerState()
    const started = new Date('2026-08-01T00:00:00.000Z')
    state.register(registration('production'), started)
    state.expireStale(new Date('2026-08-01T00:00:01.000Z'))
    expect(state.expireStale(new Date('2026-08-01T01:00:01.000Z'))).toEqual([])

    expect(state.reportHostPower({
      phase: 'suspend', sourceId: 'electron-main', sequence: 1,
      observedAt: new Date('2026-08-01T00:00:02.000Z')
    })).toBe(false)
  })

  it('protects a near-expiry lease when only a short-gap resume report arrives', () => {
    const state = new ServiceManagerState()
    const started = new Date('2026-08-01T00:00:00.000Z')
    state.register(registration('production'), started)
    const lease = state.acquireLease({
      threadId: 'thread-short-gap',
      turnId: 'turn-short-gap',
      ownerFlavor: 'production',
      ownerInstanceId: 'production-runtime'
    }, started)
    state.expireStale(new Date('2026-08-01T00:00:19.000Z'))

    expect(state.reportHostPower({
      phase: 'resume', sourceId: 'electron-main', sequence: 1,
      observedAt: new Date('2026-08-01T00:00:23.000Z')
    })).toBe(true)
    expect(() => state.assertTurnMutationFence(
      lease,
      new Date('2026-08-01T00:00:31.000Z')
    )).not.toThrow()
  })

  it('recovers a persisted suspension even when the explicit resume report is lost', () => {
    const state = new ServiceManagerState()
    const started = new Date('2026-08-01T00:00:00.000Z')
    state.register(registration('production'), started)
    const lease = state.acquireLease({
      threadId: 'thread-lost-resume',
      turnId: 'turn-lost-resume',
      ownerFlavor: 'production',
      ownerInstanceId: 'production-runtime'
    }, started)
    state.noteHostSuspended(new Date('2026-08-01T00:00:02.000Z'))
    const restored = ServiceManagerState.restore(state.durableSnapshot())

    expect(restored.expireStale(new Date('2026-08-01T01:00:02.000Z'))).toEqual([])
    expect(() => restored.assertTurnMutationFence(
      lease,
      new Date('2026-08-01T01:00:03.000Z')
    )).not.toThrow()
  })
})
