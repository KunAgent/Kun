import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { ActivityRow } from '@shared/activity-row'
import type { AdeActivityNotificationCategory } from '@shared/kun-gui-notification-contracts'
import { useActivityStore } from './activity-store'
import {
  activityNotificationCategory,
  activityNotificationDedupeKey,
  resetActivityNotificationDedupe,
  startActivityNotifications,
  stopActivityNotifications
} from './activity-notifications'

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

function makeDeps(overrides: Record<string, unknown> = {}) {
  const notify = vi.fn()
  return {
    notify,
    deps: {
      getChatState: () => ({ activeThreadId: null, sideConversations: {} }),
      notify,
      notificationsEnabled: vi.fn(async () => true),
      ...overrides
    }
  }
}

async function flush(): Promise<void> {
  await Promise.resolve()
  await Promise.resolve()
}

describe('activityNotificationCategory', () => {
  it('maps state transitions and stalled flips', () => {
    const working = makeRow({ state: 'working' })
    expect(activityNotificationCategory(makeRow({ state: 'waiting' }), working)).toBe('waiting')
    expect(activityNotificationCategory(makeRow({ state: 'failed' }), working)).toBe('failed')
    expect(activityNotificationCategory(makeRow({ state: 'done' }), working)).toBe('done')
    expect(activityNotificationCategory(makeRow({ state: 'idle' }), working)).toBeNull()
    expect(activityNotificationCategory(working, working)).toBeNull()
    expect(activityNotificationCategory(makeRow({ stalled: true }), working)).toBe('stalled')
    expect(
      activityNotificationCategory(makeRow({ stalled: true }), makeRow({ stalled: true }))
    ).toBeNull()
  })
})

describe('startActivityNotifications', () => {
  beforeEach(() => {
    resetActivityNotificationDedupe()
    stopActivityNotifications()
    useActivityStore.setState({ rows: {}, cursor: 'c0', status: 'live' })
  })

  it('notifies on a waiting transition and dedupes the same transition', async () => {
    const { notify, deps } = makeDeps()
    startActivityNotifications(deps)
    const waiting = makeRow({ state: 'waiting', stateSince: '2026-01-01T00:01:00.000Z' })
    useActivityStore.setState({ rows: { 'unit-1': waiting } })
    await flush()
    expect(notify).toHaveBeenCalledTimes(1)
    expect(notify.mock.calls[0][0]).toMatchObject({
      category: 'waiting',
      threadId: 'thread-1',
      source: 'subagent'
    })
    // Same unitId+state+stateSince again (e.g. a feed restart replays it): once only.
    useActivityStore.setState({ rows: {} })
    useActivityStore.setState({ rows: { 'unit-1': { ...waiting } } })
    await flush()
    expect(notify).toHaveBeenCalledTimes(1)
  })

  it('defers pending metadata and lets Rooms own its final publication notifications', async () => {
    const { notify, deps } = makeDeps()
    startActivityNotifications(deps)
    const waiting = makeRow({ state: 'waiting', metadataPending: true })
    useActivityStore.setState({ rows: { 'unit-1': waiting } })
    await flush()
    expect(notify).not.toHaveBeenCalled()
    useActivityStore.setState({ rows: { 'unit-1': { ...waiting, metadataPending: undefined, roomId: 'room' } } })
    await flush()
    expect(notify).not.toHaveBeenCalled()
    useActivityStore.setState({ rows: { 'unit-1': waiting } })
    useActivityStore.setState({ rows: { 'unit-1': { ...waiting, metadataPending: undefined } } })
    await flush()
    expect(notify).toHaveBeenCalledOnce()
  })

  it('does not notify when the window is focused on that thread', async () => {
    vi.stubGlobal('document', {
      visibilityState: 'visible',
      hasFocus: () => true
    })
    try {
      const { notify, deps } = makeDeps({
        getChatState: () => ({ activeThreadId: 'thread-1', sideConversations: {} })
      })
      startActivityNotifications(deps)
      useActivityStore.setState({
        rows: { 'unit-1': makeRow({ state: 'waiting', stateSince: '2026-01-01T00:02:00.000Z' }) }
      })
      await flush()
      expect(notify).not.toHaveBeenCalled()
    } finally {
      vi.unstubAllGlobals()
    }
  })

  it('honours the per-category setting toggle', async () => {
    const notificationsEnabled = vi.fn(
      async (category: AdeActivityNotificationCategory) => category !== 'done'
    )
    const { notify, deps } = makeDeps({ notificationsEnabled })
    startActivityNotifications(deps)
    useActivityStore.setState({
      rows: { 'unit-1': makeRow({ state: 'done', stateSince: '2026-01-01T00:03:00.000Z' }) }
    })
    await flush()
    expect(notify).not.toHaveBeenCalled()
    useActivityStore.setState({
      rows: {
        'unit-1': makeRow({ state: 'failed', stateSince: '2026-01-01T00:04:00.000Z' })
      }
    })
    await flush()
    expect(notify).toHaveBeenCalledTimes(1)
    expect(notify.mock.calls[0][0].category).toBe('failed')
  })

  it('emits stalled for a stall flip without a state change', async () => {
    const { notify, deps } = makeDeps()
    startActivityNotifications(deps)
    useActivityStore.setState({
      rows: {
        'unit-1': makeRow({ state: 'working', stalled: true, stateSince: '2026-01-01T00:05:00.000Z' })
      }
    })
    await flush()
    expect(notify).toHaveBeenCalledTimes(1)
    expect(notify.mock.calls[0][0].category).toBe('stalled')
  })
})

describe('activityNotificationDedupeKey', () => {
  it('is unit + category + stateSince', () => {
    const row = makeRow({ stateSince: '2026-01-02T00:00:00.000Z' })
    expect(activityNotificationDedupeKey(row, 'waiting')).toBe(
      'unit-1:waiting:2026-01-02T00:00:00.000Z'
    )
  })
})
