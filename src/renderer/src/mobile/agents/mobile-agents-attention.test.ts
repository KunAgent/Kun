import { describe, expect, it } from 'vitest'
import type { ActivityRow } from '@shared/activity-row'
import type { AdeQuestionRecord, AdeTeamOverview } from '@shared/ade-teams'
import type { PendingApprovalItem } from '@shared/ade-approvals'
import {
  buildAttentionItems,
  managerThreadOf,
  openQuestionForWorker
} from './mobile-agents-attention'

const NOW = '2025-01-01T12:00:00.000Z'

function row(overrides: Partial<ActivityRow>): ActivityRow {
  return {
    unitId: 'unit-1', kind: 'worker', threadId: 'worker-1',
    parentThreadId: 'manager-1', teamId: 'team-1', harnessId: 'kun',
    title: 'Worker one', workspace: { path: '/tmp/ws', kind: 'worktree' },
    state: 'waiting', mainState: 'waiting',
    children: { working: 0, waiting: 0, done: 0, failed: 0 },
    stateSince: NOW, updatedAt: NOW, provenance: 'runtime',
    restoredUnconfirmed: false, stalled: false,
    visibility: 'active', residency: 'live', pinned: false,
    ...overrides
  }
}

function question(overrides: Partial<AdeQuestionRecord> = {}): AdeQuestionRecord {
  return {
    questionId: 'q1', dispatchId: 'd1', workerId: 'worker-1',
    question: 'Which variant?', state: 'open',
    createdAt: NOW, updatedAt: NOW, ...overrides
  }
}

function overview(questions: AdeQuestionRecord[] = []): AdeTeamOverview {
  return {
    team: { teamId: 'team-1' } as AdeTeamOverview['team'],
    dispatches: [], questions
  }
}

describe('mobile attention builder', () => {
  it('surfaces a fetched approval per waiting row', () => {
    const waiting = row({ waitingReason: 'approval' })
    const approval: PendingApprovalItem = {
      approvalId: 'a1', threadId: 'worker-1', turnId: 'u1',
      toolName: 'write', summary: 'Write file', createdAt: NOW
    }
    const items = buildAttentionItems({
      rows: [waiting], approvals: { 'worker-1': [approval] }, overviews: {}
    })
    expect(items).toHaveLength(1)
    expect(items[0]).toMatchObject({ kind: 'approval', approval })
  })

  it('keeps approval rows tappable while the list is loading or emptied', () => {
    const waiting = row({ waitingReason: 'approval' })
    const cases: Record<string, PendingApprovalItem[]>[] = [{}, { 'worker-1': [] }]
    for (const approvals of cases) {
      const items = buildAttentionItems({ rows: [waiting], approvals, overviews: {} })
      expect(items).toEqual([
        { kind: 'wait', unitId: 'unit-1', row: waiting, reason: 'approval' }
      ])
    }
  })

  it('maps a waiting question to the worker open question from the overview', () => {
    const waiting = row({ waitingReason: 'question' })
    const open = question()
    const items = buildAttentionItems({
      rows: [waiting], approvals: {},
      overviews: { 'manager-1': overview([open, question({ questionId: 'q2', state: 'answered' })]) }
    })
    expect(items).toHaveLength(1)
    expect(items[0]).toMatchObject({ kind: 'question', question: open })
  })

  it('falls back to a tappable wait when the question is missing or resolved', () => {
    const waiting = row({ waitingReason: 'question' })
    const items = buildAttentionItems({
      rows: [waiting], approvals: {},
      overviews: { 'manager-1': overview([question({ workerId: 'other-worker' })]) }
    })
    expect(items).toEqual([
      { kind: 'wait', unitId: 'unit-1', row: waiting, reason: 'question' }
    ])
  })

  it('passes through user-input and terminal waits and skips quiet rows', () => {
    const input = row({ unitId: 'u1', threadId: 'w1', waitingReason: 'user_input' })
    const prompt = row({ unitId: 'u2', threadId: 'w2', waitingReason: 'terminal_prompt' })
    const working = row({ unitId: 'u3', threadId: 'w3', state: 'working', mainState: 'working' })
    const archived = row({ unitId: 'u4', threadId: 'w4', waitingReason: 'approval', visibility: 'archived' })
    const items = buildAttentionItems({
      rows: [input, prompt, working, archived], approvals: {}, overviews: {}
    })
    expect(items.map((item) => [item.kind, item.row.threadId])).toEqual([
      ['wait', 'w1'], ['wait', 'w2']
    ])
    expect((items[1] as { reason: string }).reason).toBe('terminal_prompt')
  })

  it('sorts by most recently updated row first', () => {
    const older = row({ unitId: 'u1', threadId: 'w1', waitingReason: 'user_input', updatedAt: '2025-01-01T10:00:00.000Z' })
    const newer = row({ unitId: 'u2', threadId: 'w2', waitingReason: 'user_input', updatedAt: NOW })
    const items = buildAttentionItems({
      rows: [older, newer], approvals: {}, overviews: {}
    })
    expect(items.map((item) => item.row.threadId)).toEqual(['w2', 'w1'])
  })

  it('locates the manager thread from parent or team', () => {
    expect(managerThreadOf(row({ parentThreadId: 'manager-1' }))).toBe('manager-1')
    expect(managerThreadOf(row({ parentThreadId: undefined }))).toBe('team-1')
    expect(managerThreadOf(row({ parentThreadId: undefined, teamId: undefined }))).toBeNull()
  })

  it('finds only the open question for the given worker', () => {
    const ov = overview([
      question({ questionId: 'q-open' }),
      question({ questionId: 'q-answered', state: 'answered' }),
      question({ questionId: 'q-other', workerId: 'other' })
    ])
    expect(openQuestionForWorker(ov, 'worker-1')?.questionId).toBe('q-open')
    expect(openQuestionForWorker(ov, 'nobody')).toBeNull()
    expect(openQuestionForWorker(null, 'worker-1')).toBeNull()
  })
})
