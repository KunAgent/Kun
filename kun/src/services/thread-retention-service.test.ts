import { describe, expect, it } from 'vitest'
import type { ThreadRecord } from '../contracts/threads.js'
import { selectRetentionCutoff } from './thread-retention-service.js'

const DAY = 86_400_000
const NOW = '2026-08-23T00:00:00.000Z'

function thread(ages: number[]): ThreadRecord {
  return {
    id: 'thr_retention', title: 'Retention', workspace: '/', model: 'model',
    mode: 'agent', status: 'idle', approvalPolicy: 'on-request', sandboxMode: 'workspace-write',
    approvalReviewer: 'user', relation: 'primary', createdAt: NOW, updatedAt: NOW,
    turns: ages.map((days, index) => ({
      id: `turn_${index + 1}`, threadId: 'thr_retention', status: 'completed', prompt: `p${index}`,
      orchestration: 'direct', steering: [], createdAt: new Date(Date.parse(NOW) - days * DAY).toISOString(),
      finishedAt: new Date(Date.parse(NOW) - days * DAY).toISOString(), items: [], attachmentIds: [],
      activeSkillIds: [], injectedMemoryIds: [], injectedMemorySummaries: [], injectedInstructionSources: []
    }))
  }
}

describe('thread retention cutoff', () => {
  it('retains the union of recent turns and recent days', () => {
    const source = thread([90, 60, 20, 10, 1])
    expect(selectRetentionCutoff(source, {
      keepLastTurns: 2,
      keepDays: 30,
      archiveBeforePrune: true
    }, NOW)).toBe('turn_2')
  })

  it('returns no cutoff when every completed turn is retained', () => {
    expect(selectRetentionCutoff(thread([2, 1]), {
      keepDays: 30,
      archiveBeforePrune: true
    }, NOW)).toBeUndefined()
  })
})
