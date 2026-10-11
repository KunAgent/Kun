import { describe, expect, it } from 'vitest'
import type { ActivityRow } from '@shared/activity-row'
import type { AdeTeamOverview } from '@shared/ade-teams'
import {
  mergeWorkerRows,
  summarizeWorkerRows,
  workersPillState
} from './worker-row-data'

const NOW = Date.parse('2026-09-26T12:00:00.000Z')

function row(overrides: Partial<ActivityRow>): ActivityRow {
  return {
    unitId: 'wrk_x',
    kind: 'worker',
    threadId: 'thr_x',
    parentThreadId: 'thr_mgr',
    harnessId: 'kun',
    title: 'w',
    workspace: { path: '/ws', kind: 'worktree' },
    state: 'working',
    children: { working: 0, waiting: 0, done: 0, failed: 0 },
    stateSince: new Date(NOW - 60_000).toISOString(),
    updatedAt: new Date(NOW - 60_000).toISOString(),
    stalled: false,
    visibility: 'active',
    pinned: false,
    ...overrides
  } as ActivityRow
}

function overview(overrides: Partial<AdeTeamOverview> = {}): AdeTeamOverview {
  return {
    team: {
      teamId: 'team_1',
      managerThreadId: 'thr_mgr',
      status: 'active',
      workers: [
        {
          workerId: 'wrk_1',
          label: 'backend',
          route: { harnessId: 'claude-code', model: 'opus', credentialMode: 'subscription' },
          permissionMode: 'safe',
          control: 'manager',
          state: 'active'
        },
        {
          workerId: 'wrk_2',
          label: 'frontend',
          control: 'user',
          state: 'released'
        }
      ],
      createdAt: 'x',
      updatedAt: 'x'
    },
    dispatches: [
      {
        dispatchId: 'dsp_1',
        teamId: 'team_1',
        workerId: 'wrk_1',
        title: 'build api',
        state: 'completed',
        capture: { changedFiles: 3, insertions: 120, deletions: 40 },
        verdict: { status: 'passed', decidedBy: 'manager' },
        createdAt: 'x',
        updatedAt: 'x'
      }
    ],
    questions: [
      {
        questionId: 'q_1',
        dispatchId: 'dsp_2',
        workerId: 'wrk_1',
        question: 'which branch?',
        state: 'open',
        createdAt: 'x',
        updatedAt: 'x'
      }
    ],
    ...overrides
  }
}

describe('mergeWorkerRows', () => {
  it('merges worker record + latest dispatch + open question + activity row', () => {
    const rows = mergeWorkerRows(
      overview(),
      [row({ unitId: 'wrk_1', threadId: 'wrk_1', state: 'waiting', waitingReason: 'question' })],
      NOW
    )
    const w1 = rows.find((r) => r.workerId === 'wrk_1')!
    expect(w1.label).toBe('backend')
    expect(w1.harnessId).toBe('claude-code')
    expect(w1.model).toBe('opus')
    expect(w1.bucket).toBe('needs-you')
    expect(w1.waitingReason).toBe('question')
    expect(w1.diffStats).toEqual({ changedFiles: 3, insertions: 120, deletions: 40 })
    expect(w1.verdict?.status).toBe('passed')
    expect(w1.openQuestion?.questionId).toBe('q_1')
    const w2 = rows.find((r) => r.workerId === 'wrk_2')!
    expect(w2.control).toBe('user')
    expect(w2.bucket).toBe('done')
  })

  it('marks cross-review workers and drops non-latest dispatches', () => {
    const data = overview({
      dispatches: [
        {
          dispatchId: 'd_old', teamId: 't', workerId: 'wrk_1', title: 'old',
          state: 'completed', createdAt: 'x', updatedAt: '2020-01-01T00:00:00Z'
        },
        {
          dispatchId: 'd_new', teamId: 't', workerId: 'wrk_1', title: 'new',
          state: 'failed', createdAt: 'x', updatedAt: '2026-01-01T00:00:00Z'
        }
      ]
    })
    data.team.workers[0]!.reviewOf = 'dsp_9'
    const rows = mergeWorkerRows(data, [], NOW)
    const w1 = rows[0]!
    expect(w1.reviewer).toBe(true)
    expect(w1.dispatchState).toBe('failed')
    expect(w1.dispatchTitle).toBe('new')
  })
})

describe('summarizeWorkerRows', () => {
  it('counts running / waiting / done / failed from buckets', () => {
    const rows = mergeWorkerRows(
      overview(),
      [
        row({ unitId: 'wrk_1', threadId: 'wrk_1', state: 'waiting', waitingReason: 'question' }),
        row({ unitId: 'wrk_2', threadId: 'wrk_2', state: 'done' })
      ],
      NOW
    )
    const summary = summarizeWorkerRows(rows)
    expect(summary).toEqual({ running: 0, waiting: 1, done: 1, failed: 0, total: 2 })
  })
})

describe('workersPillState', () => {
  it('counts in-flight workers and waiting questions; skips settled/archived', () => {
    const { active, waitingQuestions } = workersPillState(
      [
        row({ unitId: 'w1', state: 'working' }),
        row({ unitId: 'w2', state: 'waiting', waitingReason: 'question' }),
        row({ unitId: 'w3', state: 'waiting', waitingReason: 'approval' }),
        row({ unitId: 'w4', state: 'idle' }),
        row({ unitId: 'w5', state: 'working', visibility: 'archived' })
      ],
      NOW
    )
    expect(active).toBe(3)
    expect(waitingQuestions).toBe(1)
  })
})
