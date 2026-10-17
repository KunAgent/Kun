import { describe, expect, it } from 'vitest'
import type { DispatchRecord, QuestionRecord, TeamRecord } from '../contracts/ade.js'
import type { AgentDispatchIntent } from '../contracts/agent-dispatch-intents.js'
import { createAdeManagerContext } from './manager-context.js'

const NOW = '2026-09-29T00:00:00.000Z'

function team(overrides: Partial<TeamRecord> = {}): TeamRecord {
  return {
    version: 1,
    teamId: 'team_1',
    managerThreadId: 'thr_mgr',
    status: 'active',
    limits: { softWorkers: 4, hardWorkers: 8 },
    workers: [],
    createdAt: NOW,
    updatedAt: NOW,
    ...overrides
  }
}

function worker(overrides: Record<string, unknown> = {}) {
  return {
    workerId: 'wrk_1',
    label: 'fixer',
    route: { harnessId: 'claude-code', model: 'claude-sonnet-5', credentialMode: 'kun-gateway' },
    permissionMode: 'default',
    lifecycle: 'persistent',
    securitySnapshot: {
      sandboxRoot: '/repo/.worktrees/t1',
      allowedWritePaths: ['/repo/.worktrees/t1'],
      memoryEnabled: false
    },
    control: 'manager',
    state: 'active',
    createdAt: NOW,
    ...overrides
  } as TeamRecord['workers'][number]
}

function dispatch(overrides: Partial<DispatchRecord> = {}): DispatchRecord {
  return {
    dispatchId: 'dsp_1',
    teamId: 'team_1',
    workerId: 'wrk_1',
    parentTurnId: 'turn_1',
    title: 'fix login bug',
    task: 'fix it',
    mode: 'queue',
    state: 'accepted',
    createdAt: NOW,
    updatedAt: NOW,
    ...overrides
  } as DispatchRecord
}

function question(overrides: Partial<QuestionRecord> = {}): QuestionRecord {
  return {
    questionId: 'q_1',
    dispatchId: 'dsp_1',
    workerId: 'wrk_1',
    question: 'which file should hold the fix?',
    state: 'open',
    deadline: NOW,
    createdAt: NOW,
    updatedAt: NOW,
    ...overrides
  } as QuestionRecord
}

function intent(overrides: Partial<AgentDispatchIntent> = {}): AgentDispatchIntent {
  return {
    intentId: 'adi_1',
    kind: 'worker',
    state: 'countdown',
    revision: 1,
    recommendation: { title: 'split auth module', task: 'split it' },
    requestLedger: {},
    createdAt: NOW,
    updatedAt: NOW,
    ...overrides
  } as AgentDispatchIntent
}

function makeDeps(overrides: {
  team?: TeamRecord | null
  dispatches?: DispatchRecord[]
  questions?: QuestionRecord[]
  harnessSummary?: string
} = {}) {
  const t = 'team' in overrides ? overrides.team! : team()
  return {
    teams: { byManager: async () => t },
    dispatches: { list: async () => overrides.dispatches ?? [] },
    questions: { listOpen: async () => overrides.questions ?? [] },
    harnessSummary: async () => overrides.harnessSummary
  }
}

describe('createAdeManagerContext', () => {
  it('renders the delegation contract, team state, and harness menu', async () => {
    const block = await createAdeManagerContext(makeDeps({
      team: team({ workers: [worker()] }),
      dispatches: [dispatch()],
      questions: [question()],
      harnessSummary: 'Graph worker harnesses: kun (Kun) — native loop'
    }))({ threadId: 'thr_mgr' })
    expect(block).toContain('manager of this ADE team workspace')
    expect(block).toContain('acceptance criteria')
    expect(block).toContain('wrk_1 [active] fixer on claude-code/claude-sonnet-5')
    expect(block).toContain('dsp_1 [accepted] fix login bug')
    expect(block).toContain('q_1 [open] from wrk_1: which file should hold the fix?')
    expect(block).toContain('Graph worker harnesses')
  })

  it('marks terminal dispatches with a worker report as awaiting review', async () => {
    const block = await createAdeManagerContext(makeDeps({
      dispatches: [dispatch({
        state: 'completed',
        workerReport: {
          summary: 'done',
          outcome: 'succeeded',
          submittedAt: NOW
        }
      })]
    }))({ threadId: 'thr_mgr' })
    expect(block).toContain('completed, report awaiting review')
  })

  it('shows dispatch cards that have not started a worker yet', async () => {
    const block = await createAdeManagerContext({
      ...makeDeps({ team: null }),
      nowMs: () => Date.parse(NOW),
      dispatchIntents: { list: async () => [
        intent(),
        intent({ intentId: 'adi_2', state: 'pending_confirmation' }),
        intent({ intentId: 'adi_3', state: 'failed', error: 'Dispatch admission failed: worker limit reached' }),
        intent({ intentId: 'adi_4', state: 'cancelled', requestLedger: { 'source-abort:turn_1': 'h' } }),
        intent({ intentId: 'adi_running', state: 'running',
          target: { threadId: 'thr_mgr', workerIds: ['wrk_1'], dispatchIds: ['dsp_1'] } }),
        intent({ intentId: 'adi_old', state: 'failed', error: 'old', updatedAt: '2026-09-28T00:00:00.000Z' })
      ] }
    })({ threadId: 'thr_mgr' })
    expect(block).toContain('Dispatch cards without a started worker')
    expect(block).toContain('adi_1 [countdown, starts automatically unless the user cancels] split auth module')
    expect(block).toContain('adi_2 [waiting for user confirmation]')
    expect(block).toContain('adi_3 [failed, no worker started: Dispatch admission failed: worker limit reached]')
    expect(block).toContain('adi_4 [cancelled because its source turn was stopped; no worker started]')
    expect(block).not.toContain('adi_running')
    expect(block).not.toContain('adi_old')
  })

  it('keeps recently failed dispatches without a report in view', async () => {
    const block = await createAdeManagerContext({
      ...makeDeps({ dispatches: [dispatch({
        state: 'failed',
        failureReason: 'Interrupted by a Kun runtime restart before the worker started this assignment; no work was done.'
      })] }),
      nowMs: () => Date.parse(NOW)
    })({ threadId: 'thr_mgr' })
    expect(block).toContain('dsp_1 [failed: Interrupted by a Kun runtime restart before the worker started this assignment')
    expect(block).not.toContain('Dispatch cards without a started worker')
  })

  it('still returns guidance when no team exists yet', async () => {
    const block = await createAdeManagerContext(makeDeps({
      team: null
    }))({ threadId: 'thr_mgr' })
    expect(block).toContain('manager of this ADE team workspace')
    expect(block).toContain('No team exists yet')
  })

  it('keeps existing-team guidance without suggesting new dispatches when disabled', async () => {
    const block = await createAdeManagerContext({
      ...makeDeps({ team: team({ workers: [worker()] }) }),
      canStartNewWork: () => false
    })({ threadId: 'thr_mgr' })
    expect(block).toContain('disabled for new work')
    expect(block).toContain('Workers (1)')
    expect(block).not.toContain('No team exists yet')
    expect(block).not.toContain('create one worker per piece')
  })

  it('bounds the block length for large teams', async () => {
    const workers = Array.from({ length: 40 }, (_, i) =>
      worker({ workerId: `wrk_${i}`, label: `w${i}` }))
    const dispatches = Array.from({ length: 20 }, (_, i) =>
      dispatch({ dispatchId: `dsp_${i}`, state: 'accepted' }))
    const block = await createAdeManagerContext(makeDeps({
      team: team({ workers }),
      dispatches
    }))({ threadId: 'thr_mgr' })
    expect(block!.length).toBeLessThanOrEqual(2_400)
  })

  it('tolerates store failures and reports an ended team as absent', async () => {
    const deps = makeDeps({ team: team({ status: 'ended' }) })
    deps.dispatches = { list: async () => { throw new Error('io') } }
    const block = await createAdeManagerContext(deps)({ threadId: 'thr_mgr' })
    expect(block).toContain('No team exists yet')
    expect(block).not.toContain('Workers (')
  })
})
