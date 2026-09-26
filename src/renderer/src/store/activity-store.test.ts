import { afterEach, describe, expect, it, vi } from 'vitest'
import type { ActivityPollResponse, ActivityRow } from '@shared/activity-row'
import {
  ACTIVITY_HIDDEN_INTERVAL_MS,
  ACTIVITY_POLL_WAIT_MS,
  activityFeedCoversThread,
  startActivityFeed,
  stopActivityFeed,
  useActivityStore,
  type ActivityFeedDeps
} from './activity-store'

function row(unitId: string, overrides: Partial<ActivityRow> = {}): ActivityRow {
  return {
    unitId,
    kind: 'thread',
    threadId: unitId,
    harnessId: 'kun',
    title: unitId,
    workspace: { path: '/ws', kind: 'local' },
    state: 'working',
    mainState: 'working',
    children: { working: 0, waiting: 0, done: 0, failed: 0 },
    stateSince: '2026-09-01T12:00:00.000Z',
    updatedAt: '2026-09-01T12:00:00.000Z',
    provenance: 'runtime',
    restoredUnconfirmed: false,
    stalled: false,
    visibility: 'active',
    residency: 'live',
    pinned: false,
    ...overrides
  }
}

/** A poll that stays pending until the feed's abort signal fires. */
function parkedPoll(signal: AbortSignal): Promise<ActivityPollResponse> {
  return new Promise((resolve) => {
    signal.addEventListener('abort', () =>
      resolve({ type: 'activity', cursor: 'parked', changes: [] }))
  })
}

function depsHarness(overrides: Partial<ActivityFeedDeps> = {}) {
  const sleeps: number[] = []
  const waits: number[] = []
  let hidden = false
  const deps: ActivityFeedDeps = {
    snapshot: vi.fn(async () => ({ cursor: 'c1', rows: [] })),
    // Resolve once, then park: a poll that resolves forever spins the
    // loop hot in tests and starves the worker.
    poll: vi.fn((cursor, waitMs, signal) => {
      waits.push(waitMs)
      if (waits.length === 1) {
        return Promise.resolve({ type: 'activity' as const, cursor: 'c2', changes: [] })
      }
      return parkedPoll(signal)
    }),
    isHidden: () => hidden,
    sleep: async (ms) => { sleeps.push(ms) },
    ...overrides
  }
  return {
    deps,
    sleeps,
    waits,
    setHidden: (value: boolean) => { hidden = value }
  }
}

afterEach(() => {
  stopActivityFeed()
  useActivityStore.setState({ rows: {}, cursor: null, status: 'idle' })
})

describe('activity feed store', () => {
  it('loads the snapshot then applies polled changes', async () => {
    let calls = 0
    const { deps } = depsHarness({
      poll: vi.fn((_cursor, _waitMs, signal) => {
        calls += 1
        if (calls === 1) {
          return Promise.resolve({
            type: 'activity' as const,
            cursor: 'c2',
            changes: [{ unitId: 't1', row: row('t1') }]
          })
        }
        return parkedPoll(signal)
      })
    })
    startActivityFeed(deps)
    await vi.waitFor(() => {
      expect(useActivityStore.getState().rows.t1?.unitId).toBe('t1')
    })
    expect(useActivityStore.getState().status).toBe('live')
    expect(useActivityStore.getState().cursor).toBe('c2')
  })

  it('re-snapshots and replaces rows on reset_required', async () => {
    const { deps } = depsHarness({
      snapshot: vi
        .fn()
        .mockResolvedValueOnce({ cursor: 'c1', rows: [row('old')] })
        .mockResolvedValue({ cursor: 'c9', rows: [row('fresh')] }),
      poll: vi.fn((cursor, waitMs, signal) => {
        void cursor
        void waitMs
        if (useActivityStore.getState().cursor === 'c9') return parkedPoll(signal)
        return Promise.resolve({ type: 'reset_required' as const, cursor: 'c9' })
      })
    })
    startActivityFeed(deps)
    await vi.waitFor(() => {
      expect(useActivityStore.getState().rows.fresh?.unitId).toBe('fresh')
    })
    expect(useActivityStore.getState().rows.old).toBeUndefined()
    expect(deps.snapshot).toHaveBeenCalledTimes(2)
  })

  it('removes rows marked removed in a change batch', async () => {
    const { deps } = depsHarness({
      snapshot: vi.fn(async () => ({ cursor: 'c1', rows: [row('t1'), row('t2')] })),
      poll: vi.fn((_cursor, _waitMs, signal) => {
        void _cursor
        void _waitMs
        if (useActivityStore.getState().rows.t1) {
          return Promise.resolve({
            type: 'activity' as const,
            cursor: 'c2',
            changes: [{ unitId: 't1', removed: true }]
          })
        }
        return parkedPoll(signal)
      })
    })
    startActivityFeed(deps)
    await vi.waitFor(() => {
      expect(useActivityStore.getState().rows.t2?.unitId).toBe('t2')
      expect(useActivityStore.getState().rows.t1).toBeUndefined()
    })
  })

  it('slows to a 60-second cadence and a zero wait_ms while hidden', async () => {
    let calls = 0
    const { deps, waits, sleeps, setHidden } = depsHarness()
    deps.poll = vi.fn((_cursor, waitMs, signal) => {
      void _cursor
      waits.push(waitMs)
      calls += 1
      if (calls === 1) {
        setHidden(true)
        return Promise.resolve({ type: 'activity' as const, cursor: 'c2', changes: [] })
      }
      if (calls === 2) return Promise.resolve({ type: 'activity' as const, cursor: 'c3', changes: [] })
      return parkedPoll(signal)
    })
    startActivityFeed(deps)
    await vi.waitFor(() => {
      expect(waits.slice(0, 2)).toEqual([ACTIVITY_POLL_WAIT_MS, 0])
      expect(sleeps).toContain(ACTIVITY_HIDDEN_INTERVAL_MS)
    })
  })

  it('clears rows and cursor on stop so stale coverage cannot linger', async () => {
    const { deps } = depsHarness({
      snapshot: vi.fn(async () => ({ cursor: 'c1', rows: [row('t1')] }))
    })
    startActivityFeed(deps)
    await vi.waitFor(() => {
      expect(useActivityStore.getState().rows.t1?.unitId).toBe('t1')
    })

    stopActivityFeed()

    expect(useActivityStore.getState().rows).toEqual({})
    expect(useActivityStore.getState().cursor).toBeNull()
    expect(useActivityStore.getState().status).toBe('idle')
  })

  it('only covers threads while the feed is live', async () => {
    const { deps } = depsHarness({
      snapshot: vi.fn(async () => ({ cursor: 'c1', rows: [row('t1')] }))
    })
    expect(activityFeedCoversThread('t1')).toBe(false)

    startActivityFeed(deps)
    await vi.waitFor(() => {
      expect(activityFeedCoversThread('t1')).toBe(true)
    })
    expect(activityFeedCoversThread('other')).toBe(false)

    // A stale row snapshot left behind by a stopped feed must not keep
    // suppressing ordinary notifications (B4).
    useActivityStore.setState({ status: 'idle' })
    expect(activityFeedCoversThread('t1')).toBe(false)

    stopActivityFeed()
    expect(activityFeedCoversThread('t1')).toBe(false)
  })

  it('backs off exponentially on errors', async () => {
    const { deps, sleeps } = depsHarness({
      snapshot: vi.fn(async () => ({ cursor: 'c1', rows: [] })),
      poll: vi.fn((_cursor, _waitMs, signal) => {
        void _cursor
        void _waitMs
        if (sleeps.length >= 3) return parkedPoll(signal)
        return Promise.reject(new Error('down'))
      })
    })
    startActivityFeed(deps)
    await vi.waitFor(() => expect(sleeps).toEqual([1_000, 2_000, 4_000]))
    expect(useActivityStore.getState().status).toBe('error')
  })
})
