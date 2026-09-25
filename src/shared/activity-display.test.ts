import { describe, expect, it } from 'vitest'
import {
  DONE_DECAY_MS,
  displayBucket,
  type ActivityDisplayRow
} from './activity-display'

const NOW = Date.parse('2026-09-01T12:00:00.000Z')

function row(overrides: Partial<ActivityDisplayRow> = {}): ActivityDisplayRow {
  return {
    state: 'done',
    kind: 'thread',
    workspace: { kind: 'local' },
    stateSince: '2026-09-01T11:00:00.000Z',
    ...overrides
  }
}

describe('displayBucket', () => {
  it('marks waiting rows as needs-you', () => {
    expect(displayBucket(row({ state: 'waiting' }), NOW)).toBe('needs-you')
  })

  it('marks failed rows as needs-you', () => {
    expect(displayBucket(row({ state: 'failed' }), NOW)).toBe('needs-you')
  })

  it('marks working and initializing rows as working', () => {
    expect(displayBucket(row({ state: 'working' }), NOW)).toBe('working')
    expect(displayBucket(row({ state: 'initializing' }), NOW)).toBe('working')
  })

  it('marks done worktree rows as review', () => {
    expect(
      displayBucket(row({ state: 'done', workspace: { kind: 'worktree' } }), NOW)
    ).toBe('review')
    expect(displayBucket(row({ state: 'done', kind: 'worker' }), NOW)).toBe('review')
  })

  it('marks done local threads as done', () => {
    expect(displayBucket(row({ state: 'done' }), NOW)).toBe('done')
  })

  it('decays acknowledged done rows to idle after the decay window', () => {
    expect(
      displayBucket(
        row({
          state: 'done',
          workspace: { kind: 'worktree' },
          acknowledgedAt: '2026-09-01T11:00:00.000Z',
          stateSince: new Date(NOW - DONE_DECAY_MS - 1).toISOString()
        }),
        NOW
      )
    ).toBe('idle')
    // Unacknowledged rows never decay.
    expect(
      displayBucket(
        row({
          state: 'done',
          workspace: { kind: 'worktree' },
          stateSince: new Date(NOW - DONE_DECAY_MS - 1).toISOString()
        }),
        NOW
      )
    ).toBe('review')
  })

  it('dismissed rows only resurface while working', () => {
    expect(displayBucket(row({ state: 'waiting', dismissedAt: '2026-09-01T11:30:00.000Z' }), NOW)).toBe('idle')
    expect(displayBucket(row({ state: 'working', dismissedAt: '2026-09-01T11:30:00.000Z' }), NOW)).toBe('working')
    expect(displayBucket(row({ state: 'failed', dismissedAt: '2026-09-01T11:30:00.000Z' }), NOW)).toBe('idle')
  })

  it('marks idle and closed rows as idle', () => {
    expect(displayBucket(row({ state: 'idle' }), NOW)).toBe('idle')
    expect(displayBucket(row({ state: 'closed' }), NOW)).toBe('idle')
  })
})
