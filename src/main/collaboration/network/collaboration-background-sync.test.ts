import { describe, expect, it, vi } from 'vitest'
import { CollaborationBackgroundSync } from './collaboration-background-sync'

describe('CollaborationBackgroundSync', () => {
  it('syncs the active E2EE meeting and runs post-sync reconciliation', async () => {
    const dispatch = vi.fn(async () => undefined)
    const afterSync = vi.fn(async () => undefined)
    const sync = new CollaborationBackgroundSync({
      status: async () => readyStatus(), dispatch, afterSync, now: () => 1_000
    })

    await sync.runOnce()

    expect(dispatch).toHaveBeenCalledWith({ kind: 'network_sync', meetingId: 'meeting-1' })
    expect(afterSync).toHaveBeenCalledWith('meeting-1')
  })

  it('deduplicates concurrent ticks and retries transport failures with backoff', async () => {
    let release: (() => void) | undefined
    let now = 1_000
    let attempts = 0
    const dispatch = vi.fn(() => {
      attempts += 1
      if (attempts > 1) return Promise.resolve()
      return new Promise<void>((_resolve, reject) => { release = () => reject(new Error('offline')) })
    })
    const sync = new CollaborationBackgroundSync({
      status: async () => readyStatus(), dispatch, now: () => now,
      baseRetryMs: 5_000, maxRetryMs: 20_000
    })

    const first = sync.runOnce()
    await sync.runOnce()
    expect(dispatch).toHaveBeenCalledTimes(1)
    release?.()
    await first
    await sync.runOnce()
    expect(dispatch).toHaveBeenCalledTimes(1)
    now = 6_000
    await sync.runOnce()
    expect(dispatch).toHaveBeenCalledTimes(2)
  })

  it('does not write while security recovery is required', async () => {
    const dispatch = vi.fn()
    const sync = new CollaborationBackgroundSync({
      status: async () => ({ ...readyStatus(), state: 'SECURITY_SYNC_REQUIRED', e2eeState: 'blocked' }),
      dispatch
    })
    await sync.runOnce()
    expect(dispatch).not.toHaveBeenCalled()
  })
})

function readyStatus() {
  return {
    state: 'ready' as const, e2eeState: 'ready' as const, activeMeetingId: 'meeting-1',
    protocol: 1 as const, transport: 'tls13-spki' as const, encryption: 'rfc9420-openmls' as const
  }
}
