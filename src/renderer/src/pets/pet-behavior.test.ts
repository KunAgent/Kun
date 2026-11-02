import { describe, expect, it } from 'vitest'
import type { ActivityRow } from '@shared/activity-row'
import { PET_NOTIFICATION_TTL_MS, PET_ROWS } from '@shared/pets'
import { frameAtElapsedMs, frameDurationMs, staticFrame, totalCycleDurationMs } from './pet-animation'
import { acceptPetSnapshot, highestPetStatus, projectPetActivity, semanticSnapshotKey, visiblePetNotifications } from './pet-activity'
import { queuePetNavigation, resolvePetThreadTarget } from './pet-navigation'
import { classifyPointerGesture, nextMascotWidth, overlayKeyAction, welcomeUntil } from './pet-pointer'
import { petBubbleAllowed } from './pet-publisher'

describe('pet animation and interaction', () => {
  it('maps nine rows, slows idle, and returns to idle after three transient cycles', () => {
    for (const state of Object.keys(PET_ROWS) as Array<keyof typeof PET_ROWS>) {
      expect(frameAtElapsedMs(state, 0, 2).row).toBe(PET_ROWS[state].row)
    }
    expect(frameDurationMs('idle', 0)).toBe(PET_ROWS.idle.frameDurationsMs[0] * 6)
    const elapsed = totalCycleDurationMs('waiting') * 3
    expect(frameAtElapsedMs('waiting', elapsed, 2).row).toBe(PET_ROWS.idle.row)
    expect(staticFrame('running', 2).column).toBe(0)
  })

  it('classifies pointer gestures, welcomes once, and clamps scale', () => {
    expect(classifyPointerGesture({ cancelled: true, dx: 1, dy: 1 })).toBe('cancel')
    expect(classifyPointerGesture({ cancelled: false, dx: 3, dy: 0 })).toBe('click')
    expect(classifyPointerGesture({ cancelled: false, dx: 4, dy: 0 })).toBe('drag')
    expect(welcomeUntil('kun:dot', [], 1_000)).toBe(9_000)
    expect(welcomeUntil('kun:dot', ['kun:dot'], 1_000)).toBeNull()
    expect(nextMascotWidth(80, -1)).toBe(80)
    expect(nextMascotWidth(112, 1)).toBe(128)
    expect(nextMascotWidth(224, 1)).toBe(224)
    expect(overlayKeyAction('Enter')).toBe('reply')
    expect(overlayKeyAction('Escape')).toBe('close')
  })
})

describe('pet activity projection', () => {
  it('prefers activity rows, drops restored rows, and dedupes the same thread event', () => {
    const now = Date.parse('2026-01-01T00:00:00.000Z')
    const snapshot = projectPetActivity({
      generation: 3,
      profileKey: 'profile',
      nowMs: now,
      rows: [
        row({ unitId: 'root', state: 'working', turnId: 'turn-1' }),
        row({ unitId: 'child', state: 'working', turnId: 'turn-1', parentThreadId: 'root' }),
        row({ unitId: 'wait', threadId: 'thr-wait', state: 'waiting' }),
        row({ unitId: 'old', state: 'done', restoredUnconfirmed: true }),
        row({ unitId: 'cancelled', threadId: 'thr-cancel', state: 'done', lastOutcome: 'cancelled' }),
        row({ unitId: 'stalled', threadId: 'thr-stall', state: 'working', stalled: true })
      ],
      supplements: [{ threadId: 'thr', title: 'Duplicate', latestTurnStatus: 'running' }, { threadId: 'plain', title: 'Plain', latestTurnStatus: 'failed', latestTurnId: 'turn-9' }]
    })
    expect(snapshot.items.map((item) => item.unitId).sort()).toEqual(['child', 'plain', 'stalled', 'wait'])
    expect(snapshot.items.find((item) => item.unitId === 'stalled')).toMatchObject({ status: 'failed', stalled: true, subtitle: 'Stalled' })
    expect(highestPetStatus(snapshot.items)).toBe('waiting')
    expect(acceptPetSnapshot(snapshot, { ...snapshot, generation: 2 })).toBe(snapshot)
  })

  it('expires from the transition time, keeps the next turn, and limits replay', () => {
    const since = '2026-01-01T00:00:00.000Z'
    const snapshot = projectPetActivity({
      generation: 1,
      profileKey: 'profile',
      nowMs: Date.parse(since),
      rows: [row({ state: 'failed', stateSince: since })],
      supplements: []
    })
    const key = snapshot.items[0].key
    const dismissed = new Set([key])
    expect(visiblePetNotifications(snapshot, dismissed, Date.parse(since) + 1_000)).toEqual([])
    expect(visiblePetNotifications(snapshot, new Set(), Date.parse(since) + PET_NOTIFICATION_TTL_MS.failed + 1)).toEqual([])
    const nextSince = '2026-01-01T00:00:10.000Z'
    const next = projectPetActivity({
      generation: 1,
      profileKey: 'profile',
      nowMs: Date.parse(nextSince),
      rows: [row({ state: 'failed', stateSince: nextSince, turnId: 'turn-2' })],
      supplements: []
    })
    expect(visiblePetNotifications(next, dismissed, Date.parse(nextSince) + 1_000)).toHaveLength(1)
    expect(petBubbleAllowed({ threadId: 'thr', preferenceEnabled: false, foregroundVisible: false })).toBe(false)
    expect(petBubbleAllowed({ threadId: 'thr', preferenceEnabled: true, foregroundVisible: true })).toBe(false)
  })

  it('keeps dismissals across feed restarts while publishing changed summaries', () => {
    const input = {
      generation: 1, profileKey: 'profile', nowMs: Date.parse('2026-01-01T00:00:00.000Z'),
      rows: [row({ state: 'waiting', progressNote: 'First summary' })], supplements: []
    }
    const first = projectPetActivity(input)
    const restarted = projectPetActivity({ ...input, generation: 3 })
    expect(restarted.items[0].key).toBe(first.items[0].key)
    expect(visiblePetNotifications(restarted, new Set([first.items[0].key]), input.nowMs)).toEqual([])
    expect(semanticSnapshotKey(restarted)).not.toBe(semanticSnapshotKey(first))
    const changed = projectPetActivity({ ...input, rows: [row({ state: 'waiting', progressNote: 'Updated summary' })] })
    expect(semanticSnapshotKey(changed)).not.toBe(semanticSnapshotKey(first))
    expect(changed.items[0].key).toBe(first.items[0].key)
  })

  it('does not activate a missing, protected, or unrelated thread', () => {
    expect(resolvePetThreadTarget({ request: { type: 'reply', threadId: 'missing' }, knownThreadIds: new Set(['current']) })).toEqual({ ok: false, reason: 'missing' })
    expect(resolvePetThreadTarget({ request: { type: 'open', threadId: 'room-thread', roomId: 'room' }, knownThreadIds: new Set(['room-thread']) })).toEqual({ ok: true, threadId: 'room-thread' })
    expect(queuePetNavigation({ ready: false, request: { type: 'reply', threadId: 'room-thread' }, pending: null }).deliver).toBeNull()
  })
})

function row(overrides: Partial<ActivityRow>): ActivityRow {
  return {
    unitId: 'unit',
    kind: 'thread',
    threadId: 'thr',
    harnessId: 'kun',
    title: 'Task',
    workspace: { path: '/ws', kind: 'local' },
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
    ...overrides
  }
}
