import { afterEach, describe, expect, it, vi } from 'vitest'
import type { ActivityRow } from '@shared/activity-row'
import { MAX_APP_BADGE_COUNT } from '@shared/kun-gui-api'
import { syncAppBadgeCount } from './app-badge'

function makeRow(patch: Partial<ActivityRow>): ActivityRow {
  return {
    unitId: 'unit-1',
    kind: 'worker',
    threadId: 'thread-1',
    harnessId: 'kun',
    title: 'Worker one',
    workspace: { path: '/repo', kind: 'worktree' },
    state: 'working',
    mainState: 'working',
    children: { working: 0, waiting: 0, done: 0, failed: 0 },
    stateSince: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    provenance: 'runtime',
    restoredUnconfirmed: false,
    stalled: false,
    visibility: 'active',
    residency: 'live',
    pinned: false,
    ...patch
  }
}

describe('syncAppBadgeCount', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
    vi.restoreAllMocks()
  })

  function stubBadge() {
    const setAppBadgeCount = vi.fn(async () => ({ ok: true as const }))
    vi.stubGlobal('window', { kunGui: { setAppBadgeCount } })
    return setAppBadgeCount
  }

  it('combines unread completions and needs-you rows', () => {
    const setAppBadgeCount = stubBadge()
    const rows: Record<string, ActivityRow> = {
      a: makeRow({ unitId: 'a', state: 'waiting' }),
      b: makeRow({ unitId: 'b', state: 'failed' }),
      c: makeRow({ unitId: 'c', state: 'working' })
    }
    syncAppBadgeCount({ t1: 'failed', t2: true }, rows)
    expect(setAppBadgeCount).toHaveBeenCalledWith(4)
  })

  it('excludes dismissed and archived rows from needs-you', () => {
    const setAppBadgeCount = stubBadge()
    const rows: Record<string, ActivityRow> = {
      a: makeRow({ unitId: 'a', state: 'waiting', dismissedAt: '2026-01-01T00:01:00.000Z' }),
      b: makeRow({ unitId: 'b', state: 'waiting', visibility: 'archived' }),
      c: makeRow({ unitId: 'c', state: 'waiting' })
    }
    syncAppBadgeCount({}, rows)
    expect(setAppBadgeCount).toHaveBeenCalledWith(1)
  })

  it('caps at MAX_APP_BADGE_COUNT', () => {
    const setAppBadgeCount = stubBadge()
    const rows: Record<string, ActivityRow> = {}
    for (let i = 0; i < 10; i += 1) {
      rows[`u${i}`] = makeRow({ unitId: `u${i}`, state: 'waiting' })
    }
    const unread: Record<string, true> = {}
    for (let i = 0; i < MAX_APP_BADGE_COUNT + 5; i += 1) unread[`t${i}`] = true
    syncAppBadgeCount(unread, rows)
    expect(setAppBadgeCount).toHaveBeenCalledWith(MAX_APP_BADGE_COUNT)
  })

  it('is a no-op without the kunGui bridge', () => {
    vi.stubGlobal('window', {})
    expect(() => syncAppBadgeCount({}, {})).not.toThrow()
  })
})
