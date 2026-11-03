import { describe, expect, it } from 'vitest'
import type { ActivityRow } from '@shared/activity-row'
import { DONE_DECAY_MS } from '@shared/activity-display'
import {
  selectBackgroundActivityByThread,
  selectSessionExecutionSummary
} from './session-execution-summary'

const NOW = Date.parse('2026-10-23T10:00:00.000Z')

function row(overrides: Partial<ActivityRow> & { unitId: string }): ActivityRow {
  const updatedAt = new Date(NOW - 30_000).toISOString()
  return {
    kind: 'worker',
    threadId: overrides.unitId,
    parentThreadId: 'thr_parent',
    harnessId: 'kun',
    title: 'repair-check',
    workspace: { path: '/ws', kind: 'worktree' },
    state: 'working',
    mainState: 'working',
    children: { working: 0, waiting: 0, done: 0, failed: 0 },
    stateSince: updatedAt,
    updatedAt,
    provenance: 'runtime',
    restoredUnconfirmed: false,
    stalled: false,
    visibility: 'active',
    residency: 'live',
    pinned: false,
    ...overrides
  } as ActivityRow
}

describe('selectSessionExecutionSummary', () => {
  it('counts executing, starting, and finished children separately', () => {
    const summary = selectSessionExecutionSummary(
      [
        row({ unitId: 'w1', state: 'working' }),
        row({ unitId: 'w2', state: 'initializing', mainState: 'initializing' }),
        row({ unitId: 'w3', state: 'done', reviewStatus: 'passed' })
      ],
      { now: NOW }
    )

    expect(summary.kind).toBe('running')
    expect(summary.counts).toMatchObject({ running: 1, starting: 1, completed: 1 })
    expect(summary.total).toBe(3)
    expect(summary.unfinished).toBe(2)
    expect(summary.activityTitle).toBe('repair-check')
  })

  it('returns none when the thread has no background rows', () => {
    expect(selectSessionExecutionSummary([], { now: NOW })).toEqual({
      kind: 'none',
      counts: {
        running: 0,
        starting: 0,
        waiting: 0,
        review: 0,
        failed: 0,
        completed: 0,
        unconfirmed: 0
      },
      unfinished: 0,
      total: 0
    })
  })

  it('lets a waiting child outrank a running sibling and keeps both counts', () => {
    const summary = selectSessionExecutionSummary(
      [
        row({ unitId: 'w1', state: 'working' }),
        row({ unitId: 'w2', state: 'waiting', mainState: 'waiting', waitingReason: 'approval' })
      ],
      { now: NOW }
    )

    expect(summary.kind).toBe('waiting-user')
    expect(summary.counts.running).toBe(1)
    expect(summary.counts.waiting).toBe(1)
    // Both children still need someone to act; the reply ending changes nothing.
    expect(summary.unfinished).toBe(2)
  })

  it('reports a failed child without counting it as running', () => {
    const summary = selectSessionExecutionSummary(
      [
        row({ unitId: 'w1', state: 'failed', mainState: 'failed', lastOutcome: 'failed' }),
        row({ unitId: 'w2', state: 'working' })
      ],
      { now: NOW }
    )

    expect(summary.kind).toBe('failed')
    expect(summary.counts.failed).toBe(1)
    expect(summary.counts.running).toBe(1)
  })

  it('treats an open review verdict as unfinished work, not success', () => {
    const summary = selectSessionExecutionSummary(
      [row({ unitId: 'w1', state: 'done', reviewRequired: true })],
      { now: NOW }
    )

    expect(summary.kind).toBe('review')
    expect(summary.unfinished).toBe(1)
  })

  it('keeps working when every child settled but the main turn still runs', () => {
    const summary = selectSessionExecutionSummary(
      [row({ unitId: 'w1', state: 'done', reviewStatus: 'passed' })],
      { now: NOW, mainRunning: true }
    )

    expect(summary.kind).toBe('continuing')
    expect(summary.unfinished).toBe(0)
  })

  it('only reports completion once everything settled and the turn ended', () => {
    const summary = selectSessionExecutionSummary(
      [row({ unitId: 'w1', state: 'done', reviewStatus: 'passed' })],
      { now: NOW, mainRunning: false }
    )

    expect(summary.kind).toBe('completed')
  })

  it('hides acknowledged rows that finished longer than the done decay', () => {
    const old = new Date(NOW - DONE_DECAY_MS - 60_000).toISOString()
    const summary = selectSessionExecutionSummary(
      [
        row({
          unitId: 'w1',
          state: 'done',
          reviewStatus: 'passed',
          stateSince: old,
          updatedAt: old,
          acknowledgedAt: old
        })
      ],
      { now: NOW }
    )

    expect(summary.kind).toBe('none')
  })

  it('ignores archived rows and never reports live progress for unconfirmed ones', () => {
    const archived = selectSessionExecutionSummary(
      [row({ unitId: 'w1', state: 'working', visibility: 'archived' })],
      { now: NOW }
    )
    expect(archived.kind).toBe('none')

    const restored = selectSessionExecutionSummary(
      [row({ unitId: 'w1', state: 'working', restoredUnconfirmed: true })],
      { now: NOW }
    )
    expect(restored.kind).toBe('unknown')
    expect(restored.counts.unconfirmed).toBe(1)
    expect(restored.counts.running).toBe(0)
  })

  it('downgrades a stale feed to an unconfirmed state without inventing completion', () => {
    const summary = selectSessionExecutionSummary(
      [
        row({ unitId: 'w1', state: 'working' }),
        row({ unitId: 'w2', state: 'done', reviewStatus: 'passed' })
      ],
      { now: NOW, feedError: true }
    )

    expect(summary.kind).toBe('unknown')
    expect(summary.counts.running).toBe(1)
  })

  it('keeps a dismissed row out of the way only after its verdict is recorded', () => {
    const dismissedAt = new Date(NOW).toISOString()
    const reviewed = selectSessionExecutionSummary(
      [row({ unitId: 'w1', state: 'done', reviewStatus: 'passed', dismissedAt })],
      { now: NOW }
    )
    expect(reviewed.kind).toBe('none')

    // Dismissing the card must not resolve a still-open quality requirement.
    const stillOpen = selectSessionExecutionSummary(
      [row({ unitId: 'w1', state: 'done', dismissedAt })],
      { now: NOW }
    )
    expect(stillOpen.kind).toBe('review')
  })
})

describe('selectBackgroundActivityByThread', () => {
  const map = (rows: ActivityRow[]): Record<string, ActivityRow> =>
    Object.fromEntries(rows.map((entry) => [entry.unitId, entry]))

  it('marks parents whose children still run or wait', () => {
    const activity = selectBackgroundActivityByThread(
      map([
        row({ unitId: 'w1', parentThreadId: 'thr_a', state: 'working' }),
        row({ unitId: 'w2', parentThreadId: 'thr_b', state: 'waiting', mainState: 'waiting', waitingReason: 'question' }),
        row({ unitId: 'w3', parentThreadId: 'thr_c', state: 'done', reviewStatus: 'passed' })
      ]),
      NOW
    )

    expect(activity).toEqual({ thr_a: 'running', thr_b: 'waiting' })
  })

  it('leaves threads without background work absent', () => {
    const activity = selectBackgroundActivityByThread({}, NOW)
    expect(activity).toEqual({})
  })

  it('skips archived rows and non-child units', () => {
    const activity = selectBackgroundActivityByThread(
      map([
        row({ unitId: 'w1', parentThreadId: 'thr_a', state: 'working', visibility: 'archived' }),
        row({ unitId: 't1', kind: 'thread', parentThreadId: 'thr_b', state: 'working' })
      ]),
      NOW
    )

    expect(activity).toEqual({})
  })
})
