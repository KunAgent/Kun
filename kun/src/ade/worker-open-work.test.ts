import { describe, expect, it } from 'vitest'
import { hasOpenWorkerWork } from './worker-open-work.js'
import type { DispatchRecord, QuestionRecord, TeamRecord } from '../contracts/ade.js'

function team(workerIds: string[]): TeamRecord {
  return {
    version: 1,
    teamId: 'team-1',
    managerThreadId: 'manager-1',
    status: 'active',
    limits: { softWorkers: 4, hardWorkers: 8 },
    workers: workerIds.map((workerId) => ({
      workerId,
      label: workerId,
      route: { harnessId: 'kun', providerId: 'kun', model: 'm', credentialMode: 'kun-gateway' },
      permissionMode: 'supervised',
      lifecycle: 'persistent' as const,
      securitySnapshot: { sandboxRoot: '/ws', memoryEnabled: false },
      control: 'manager' as const,
      state: 'active' as const,
      createdAt: '2026-09-01T12:00:00.000Z'
    })),
    createdAt: '2026-09-01T12:00:00.000Z',
    updatedAt: '2026-09-01T12:00:00.000Z'
  }
}

function dispatch(state: DispatchRecord['state']): DispatchRecord {
  return {
    dispatchId: `dsp-${state}`,
    teamId: 'team-1',
    workerId: 'w1',
    parentTurnId: 'turn-1',
    title: 'task',
    task: 'task',
    mode: 'queue',
    state,
    createdAt: '2026-09-01T12:00:00.000Z',
    updatedAt: '2026-09-01T12:00:00.000Z'
  }
}

function question(state: QuestionRecord['state']): QuestionRecord {
  return {
    questionId: `q-${state}`,
    dispatchId: 'dsp-1',
    workerId: 'w1',
    question: 'q?',
    state,
    deadline: '2026-09-02T12:00:00.000Z',
    createdAt: '2026-09-01T12:00:00.000Z',
    updatedAt: '2026-09-01T12:00:00.000Z'
  }
}

function stores(input: {
  workerIds?: string[]
  dispatches?: DispatchRecord[]
  questions?: QuestionRecord[]
}) {
  return {
    teams: { list: () => Promise.resolve(input.workerIds ? [team(input.workerIds)] : []) },
    dispatches: {
      listByWorker: () => Promise.resolve(input.dispatches ?? [])
    },
    questions: {
      listByWorker: () => Promise.resolve(input.questions ?? [])
    }
  }
}

describe('hasOpenWorkerWork', () => {
  it('is false for a worker on no team', async () => {
    expect(await hasOpenWorkerWork(stores({}), 'w1')).toBe(false)
  })

  it('is false when every dispatch is finished and no question is open', async () => {
    const s = stores({
      workerIds: ['w1'],
      dispatches: [dispatch('completed'), dispatch('failed'), dispatch('cancelled')],
      questions: [question('answered'), question('timeout'), question('cancelled')]
    })
    expect(await hasOpenWorkerWork(s, 'w1')).toBe(false)
  })

  it.each(['pending', 'delivering', 'uncertain', 'accepted'] as const)(
    'is true while a dispatch is %s',
    async (state) => {
      const s = stores({ workerIds: ['w1'], dispatches: [dispatch(state)] })
      expect(await hasOpenWorkerWork(s, 'w1')).toBe(true)
    }
  )

  it.each(['open', 'escalated'] as const)(
    'is true while a question is %s',
    async (state) => {
      const s = stores({ workerIds: ['w1'], questions: [question(state)] })
      expect(await hasOpenWorkerWork(s, 'w1')).toBe(true)
    }
  )
})
