import { describe, expect, it } from 'vitest'
import { evaluateStorageCleanupCandidate } from './storage-cleanup-policy'

const now = new Date('2026-07-14T00:00:00.000Z')

function candidate(overrides: Record<string, unknown> = {}) {
  return {
    category: 'logs' as const,
    id: 'log-1',
    bytes: 128,
    lastUsedAt: '2026-07-01T00:00:00.000Z',
    ...overrides
  }
}

describe('evaluateStorageCleanupCandidate', () => {
  it('allows an old unprotected candidate and honors per-category retention', () => {
    expect(evaluateStorageCleanupCandidate(candidate(), { now })).toEqual({
      safeToDelete: true,
      reason: 'eligible'
    })
    expect(evaluateStorageCleanupCandidate(candidate(), {
      now,
      minAgeMs: { logs: 14 * 24 * 60 * 60 * 1000 }
    })).toEqual({ safeToDelete: false, reason: 'not-old-enough' })
  })

  it('protects active threads, unmerged worktrees, pinned checkpoints, and recent rescue snapshots', () => {
    expect(evaluateStorageCleanupCandidate(candidate({ activeThread: true }), { now }).reason)
      .toBe('protected-active-thread')
    expect(evaluateStorageCleanupCandidate(candidate({ unmergedWorktree: true }), { now }).reason)
      .toBe('protected-unmerged-worktree')
    expect(evaluateStorageCleanupCandidate(candidate({ pinnedCheckpoint: true }), { now }).reason)
      .toBe('protected-pinned-checkpoint')
    expect(evaluateStorageCleanupCandidate(candidate({ rescueSnapshot: true, lastUsedAt: '2026-07-13T12:00:00.000Z' }), { now }).reason)
      .toBe('protected-recent-rescue-snapshot')
    expect(evaluateStorageCleanupCandidate(candidate({ rescueSnapshot: true }), { now }).reason)
      .toBe('eligible')
  })

  it('fails closed for malformed, future, and invalid retention inputs', () => {
    expect(evaluateStorageCleanupCandidate(candidate({ id: '' }), { now }).reason).toBe('invalid-candidate')
    expect(evaluateStorageCleanupCandidate(candidate({ bytes: -1 }), { now }).reason).toBe('invalid-candidate')
    expect(evaluateStorageCleanupCandidate(candidate({ extra: true }), { now }).reason).toBe('invalid-candidate')
    expect(evaluateStorageCleanupCandidate(candidate({ activeThread: 'yes' }), { now }).reason).toBe('invalid-candidate')
    expect(evaluateStorageCleanupCandidate(candidate({ lastUsedAt: 'July 1, 2026' }), { now }).reason)
      .toBe('invalid-candidate')
    expect(evaluateStorageCleanupCandidate(candidate({ lastUsedAt: '2026-02-31T00:00:00.000Z' }), { now }).reason)
      .toBe('invalid-candidate')
    expect(evaluateStorageCleanupCandidate(candidate({ lastUsedAt: '2026-07-15T00:00:00.000Z' }), { now }).reason)
      .toBe('invalid-candidate')
    expect(evaluateStorageCleanupCandidate(candidate(), { now, minAgeMs: { logs: -1 } }).reason)
      .toBe('eligible')
  })
})
