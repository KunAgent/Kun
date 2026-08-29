import { describe, expect, it } from 'vitest'
import {
  goalElapsedLabelAt,
  resolveGoalElapsedAnchorMs
} from './use-goal-elapsed'
import type { ThreadGoal } from '../../agent/types'

function goal(overrides: Partial<ThreadGoal> = {}): ThreadGoal {
  return {
    threadId: 'thread_1',
    objective: 'finish the task',
    status: 'active',
    tokensUsed: 0,
    timeUsedSeconds: 90,
    createdAt: '2026-08-27T10:00:00.000Z',
    updatedAt: '2026-08-27T10:00:00.000Z',
    ...overrides
  }
}

describe('resolveGoalElapsedAnchorMs', () => {
  it('prefers the recovered persisted turn start', () => {
    expect(resolveGoalElapsedAnchorMs({
      currentTurnStartedAtMs: 1000,
      currentTurnUserId: 'user_1',
      turnStartedAtByUserId: { user_1: 2000 }
    })).toBe(1000)
  })

  it('falls back to the live per-user start for this session', () => {
    expect(resolveGoalElapsedAnchorMs({
      currentTurnStartedAtMs: null,
      currentTurnUserId: 'user_1',
      turnStartedAtByUserId: { user_1: 2000 }
    })).toBe(2000)
  })

  it('returns undefined when no anchor is known', () => {
    expect(resolveGoalElapsedAnchorMs({
      currentTurnStartedAtMs: null,
      currentTurnUserId: null,
      turnStartedAtByUserId: { user_1: 2000 }
    })).toBeUndefined()
    expect(resolveGoalElapsedAnchorMs({
      currentTurnStartedAtMs: null,
      currentTurnUserId: 'user_2',
      turnStartedAtByUserId: {}
    })).toBeUndefined()
  })
})

describe('goalElapsedLabelAt', () => {
  it('adds the live delta to the persisted seconds', () => {
    expect(goalElapsedLabelAt({
      goal: goal(),
      timing: true,
      anchorMs: 60_000,
      nowMs: 92_000
    })).toBe('2m 2s')
  })

  it('keeps counting from the persisted anchor after a conversation switch', () => {
    // Simulates a re-mount long after the turn started: the label must not
    // reset to just the persisted seconds.
    expect(goalElapsedLabelAt({
      goal: goal({ timeUsedSeconds: 10 }),
      timing: true,
      anchorMs: Date.parse('2026-08-27T10:00:00.000Z'),
      nowMs: Date.parse('2026-08-27T10:10:00.000Z')
    })).toBe('10m 10s')
  })

  it('shows only persisted seconds when idle or the anchor is unknown', () => {
    expect(goalElapsedLabelAt({
      goal: goal(),
      timing: false,
      anchorMs: undefined,
      nowMs: 999_000
    })).toBe('1m 30s')
    expect(goalElapsedLabelAt({
      goal: goal(),
      timing: true,
      anchorMs: undefined,
      nowMs: 999_000
    })).toBe('1m 30s')
  })

  it('never counts backwards from a future anchor', () => {
    expect(goalElapsedLabelAt({
      goal: goal({ timeUsedSeconds: 5 }),
      timing: true,
      anchorMs: 200_000,
      nowMs: 100_000
    })).toBe('5s')
  })

  it('returns an empty label without a goal', () => {
    expect(goalElapsedLabelAt({
      goal: null,
      timing: true,
      anchorMs: 60_000,
      nowMs: 120_000
    })).toBe('')
  })
})
