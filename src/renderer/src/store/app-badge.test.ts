import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { ActivityRow } from '@shared/activity-row'
import { MAX_APP_BADGE_COUNT } from '@shared/kun-gui-api'
import type { NormalizedThread } from '../agent/types'
import {
  appBadgeInputFromChatState,
  clearAppBadgeSyncForTests,
  syncAppBadgeCount,
  type AppBadgeInput
} from './app-badge'

function makeThread(patch: Partial<NormalizedThread> & { id: string }): NormalizedThread {
  return {
    title: patch.id,
    updatedAt: '2026-01-01T00:00:00.000Z',
    model: 'deepseek-chat',
    mode: 'agent',
    ...patch
  } as NormalizedThread
}

function makeInput(patch: Partial<AppBadgeInput> = {}): AppBadgeInput {
  return {
    threads: [],
    unreadThreadIds: {},
    awaitingUserInputThreadIds: {},
    watchTurnCompletion: {},
    scheduledThreadActivities: {},
    activeThreadId: null,
    busy: false,
    backgroundActivityByThread: {},
    ...patch
  }
}

function makeRow(patch: Partial<ActivityRow>): ActivityRow {
  return {
    unitId: 'unit-1',
    kind: 'worker',
    threadId: 'unit-thread',
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

function stubBadge() {
  const setAppBadgeCount = vi.fn(async () => ({ ok: true as const }))
  const logError = vi.fn(async () => ({ ok: true as const }))
  vi.stubGlobal('window', { kunGui: { setAppBadgeCount, logError } })
  return { setAppBadgeCount, logError }
}

describe('syncAppBadgeCount', () => {
  beforeEach(() => {
    clearAppBadgeSyncForTests()
  })

  afterEach(() => {
    vi.unstubAllGlobals()
    vi.restoreAllMocks()
  })

  it('counts the rows the needs-you panel lists', () => {
    const { setAppBadgeCount } = stubBadge()
    const count = syncAppBadgeCount(
      makeInput({
        threads: [makeThread({ id: 'a' }), makeThread({ id: 'b' }), makeThread({ id: 'c' })],
        unreadThreadIds: { a: 'completed', b: 'failed' },
        awaitingUserInputThreadIds: { c: true }
      })
    )

    expect(count).toBe(3)
    expect(setAppBadgeCount).toHaveBeenCalledWith(3)
  })

  it('no longer adds ADE needs-you rows that the panel never shows', () => {
    const { setAppBadgeCount } = stubBadge()
    const input = appBadgeInputFromChatState(
      {
        threads: [],
        unreadThreadIds: {},
        awaitingUserInputThreadIds: {},
        watchTurnCompletion: {},
        scheduledThreadActivities: {},
        activeThreadId: null,
        busy: false
      } as never,
      { 'unit-1': makeRow({ unitId: 'unit-1', state: 'waiting', mainState: 'waiting' }) }
    )

    expect(syncAppBadgeCount(input)).toBe(0)
    expect(setAppBadgeCount).toHaveBeenCalledWith(0)
  })

  it('skips archived threads, running work, and duplicate rows', () => {
    const count = syncAppBadgeCount(
      makeInput({
        threads: [
          makeThread({ id: 'archived', archived: true }),
          makeThread({ id: 'running' }),
          makeThread({ id: 'unread-1' }),
          makeThread({ id: 'unread-1' })
        ],
        unreadThreadIds: { archived: 'completed', running: 'completed', 'unread-1': 'completed' },
        watchTurnCompletion: { running: true }
      })
    )

    expect(count).toBe(1)
  })

  it('does not let the open thread report its own unread reply, but keeps its pending question', () => {
    const count = syncAppBadgeCount(
      makeInput({
        threads: [makeThread({ id: 'open' }), makeThread({ id: 'asked' })],
        unreadThreadIds: { open: 'completed', asked: 'completed' },
        awaitingUserInputThreadIds: { open: true },
        activeThreadId: 'open'
      })
    )

    expect(count).toBe(2)
  })

  it('caps the badge and stops writing once the total settles', () => {
    const { setAppBadgeCount } = stubBadge()
    const threads = Array.from({ length: MAX_APP_BADGE_COUNT + 5 }, (_, index) =>
      makeThread({ id: `thread-${index}` })
    )
    const registry = Object.fromEntries(threads.map((thread) => [thread.id, 'completed' as const]))
    const input = makeInput({ threads, unreadThreadIds: registry })

    expect(syncAppBadgeCount(input)).toBe(MAX_APP_BADGE_COUNT)
    expect(syncAppBadgeCount({ ...input })).toBe(MAX_APP_BADGE_COUNT)
    expect(setAppBadgeCount).toHaveBeenCalledTimes(1)
  })

  it('clears the badge when nothing needs the user', () => {
    const { setAppBadgeCount } = stubBadge()
    syncAppBadgeCount(
      makeInput({ threads: [makeThread({ id: 'a' })], unreadThreadIds: { a: 'completed' } })
    )
    syncAppBadgeCount(makeInput({ threads: [makeThread({ id: 'a' })] }))

    expect(setAppBadgeCount).toHaveBeenLastCalledWith(0)
  })

  it('works without the desktop bridge and reports bridge failures', async () => {
    const failing = vi.fn(async () => {
      throw new Error('bridge down')
    })
    const logError = vi.fn(async () => ({ ok: true as const }))
    vi.stubGlobal('window', { kunGui: { setAppBadgeCount: failing, logError } })
    const input = makeInput({ threads: [makeThread({ id: 'a' })], unreadThreadIds: { a: 'failed' } })

    expect(syncAppBadgeCount(input)).toBe(1)
    await Promise.resolve()
    await Promise.resolve()
    expect(logError).toHaveBeenCalledWith(
      'app-badge',
      'Failed to update app badge',
      expect.objectContaining({ count: 1 })
    )

    vi.unstubAllGlobals()
    vi.stubGlobal('window', {})
    expect(syncAppBadgeCount(input)).toBe(1)
  })
})
