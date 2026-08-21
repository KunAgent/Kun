import { describe, expect, it } from 'vitest'
import type { NormalizedThread } from '../agent/types'
import {
  collectRunningWatchTargets,
  normalizeListedThreadActivity
} from './chat-store-thread-activity-reconcile'

function thread(id: string, overrides: Partial<NormalizedThread> = {}): NormalizedThread {
  return {
    id,
    title: id,
    workspace: '/project',
    model: 'deepseek-v4-pro',
    mode: 'agent',
    updatedAt: '2026-08-19T00:00:00.000Z',
    status: 'running',
    latestTurnStatus: 'running',
    ...overrides
  }
}

describe('thread activity reconciliation', () => {
  it('arms only background running threads that have no completion watch', () => {
    const targets = collectRunningWatchTargets([
      thread('background'),
      thread('active'),
      thread('already-watched'),
      thread('archived', { archived: true }),
      thread('completed', { status: 'idle', latestTurnStatus: 'completed' })
    ], {
      activeThreadId: 'active',
      watchTurnCompletion: { 'already-watched': true },
      watchLimit: 200
    })

    expect(targets).toEqual(['background'])
  })

  it('respects the bounded completion-watch capacity', () => {
    expect(collectRunningWatchTargets([thread('one'), thread('two')], {
      activeThreadId: null,
      watchTurnCompletion: { existing: true },
      watchLimit: 2
    })).toEqual(['one'])
  })

  it('retains locally confirmed terminal evidence over a stale running summary', () => {
    const listed = [thread('thread', { status: 'running', latestTurnStatus: undefined })]
    const local = new Map([['thread', thread('thread', {
      status: 'idle', latestTurnId: 'turn_done', latestTurnStatus: 'completed'
    })]])

    expect(normalizeListedThreadActivity(listed, local)[0]).toMatchObject({
      status: 'idle', latestTurnId: 'turn_done', latestTurnStatus: 'completed'
    })
  })
})
