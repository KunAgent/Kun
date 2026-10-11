import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import type { DispatchRecord, RaceRecord, WorkerRecord } from '../contracts/ade.js'
import type { UsageSnapshot } from '../contracts/usage.js'
import { FileDispatchStore } from './dispatch-store.js'
import { FileTeamStore } from './team-store.js'
import { buildRaceComparison } from './race-compare.js'

const NOW = '2026-10-01T00:00:00.000Z'
const TEAM = 'thr_mgr'
const tempDirs: string[] = []

afterEach(async () => {
  while (tempDirs.length) await rm(tempDirs.pop()!, { recursive: true, force: true })
})

function race(overrides: Partial<RaceRecord> = {}): RaceRecord {
  return {
    raceId: 'race_1',
    teamId: TEAM,
    label: 'fix bug',
    task: 'task',
    contenders: [
      { dispatchId: 'dsp_1', workerId: 'wrk_1', harnessId: 'claude-code', label: 'a' },
      { dispatchId: 'dsp_2', workerId: 'wrk_2', harnessId: 'codex', model: 'gpt-5', label: 'b' },
      { dispatchId: 'dsp_3', workerId: 'wrk_3', harnessId: 'kun', label: 'c', createError: 'spawn failed' }
    ],
    state: 'ready',
    deadlineAt: '2026-10-01T01:00:00.000Z',
    createdAt: NOW,
    updatedAt: NOW,
    ...overrides
  }
}

function dispatch(overrides: Partial<DispatchRecord> = {}): DispatchRecord {
  return {
    dispatchId: 'dsp_1',
    teamId: TEAM,
    workerId: 'wrk_1',
    parentTurnId: 'turn_mgr',
    title: 'contender',
    task: 'task',
    mode: 'queue',
    state: 'accepted',
    createdAt: NOW,
    updatedAt: NOW,
    ...overrides
  }
}

function worker(overrides: Partial<WorkerRecord> = {}): WorkerRecord {
  return {
    workerId: 'wrk_1',
    label: 'contender',
    route: { harnessId: 'kun', model: 'm', credentialMode: 'provider' },
    permissionMode: 'default',
    lifecycle: 'ephemeral',
    securitySnapshot: { sandboxRoot: '/repo', memoryEnabled: false },
    control: 'manager',
    state: 'active',
    createdAt: NOW,
    ...overrides
  }
}

async function harness(options: { nowMs?: () => number } = {}) {
  const dataDir = await mkdtemp(join(tmpdir(), 'kun-race-compare-'))
  tempDirs.push(dataDir)
  const dispatches = new FileDispatchStore(dataDir, () => NOW)
  const teams = new FileTeamStore(dataDir, () => NOW)
  await teams.ensure(TEAM)
  const usageByThread = new Map<string, UsageSnapshot>()
  const usage = { forThread: (threadId: string) => usageByThread.get(threadId) ?? emptyUsage() }
  return { dataDir, dispatches, teams, usageByThread, deps: { dispatches, teams, usage, nowMs: options.nowMs } }
}

function emptyUsage(): UsageSnapshot {
  return {
    promptTokens: 0,
    completionTokens: 0,
    totalTokens: 0,
    cacheHitRate: null,
    turns: 0
  } as UsageSnapshot
}

describe('buildRaceComparison', () => {
  it('rolls up dispatch state, verdict, diff stats, report, duration, and usage', async () => {
    const { dispatches, teams, usageByThread, deps } = await harness()
    await teams.upsertWorker(TEAM, worker({ workerId: 'wrk_1', taskWorkspaceId: 'tws_1' }))
    await teams.upsertWorker(TEAM, worker({ workerId: 'wrk_2', taskWorkspaceId: 'tws_2' }))
    await dispatches.create(dispatch({
      dispatchId: 'dsp_1',
      workerId: 'wrk_1',
      state: 'completed',
      outcome: 'completed',
      workerReport: {
        summary: 'fixed',
        outcome: 'succeeded',
        filesChanged: ['a.txt'],
        submittedAt: NOW
      },
      verdict: {
        status: 'passed',
        decidedBy: 'user',
        checks: [{ name: 'typecheck', status: 'passed', source: 'host' }]
      },
      capture: { changedFiles: 3, insertions: 40, deletions: 5 },
      resultExcerpt: 'done'
    }))
    await dispatches.create(dispatch({
      dispatchId: 'dsp_2',
      workerId: 'wrk_2',
      state: 'failed',
      updatedAt: '2026-10-01T00:10:00.000Z',
      outcome: 'failed' as never
    }))
    usageByThread.set('wrk_1', {
      ...emptyUsage(),
      promptTokens: 100,
      completionTokens: 50,
      totalTokens: 150,
      turns: 3,
      costUsd: 0.12,
      valueEstimateUsd: 0.4,
      costByCurrency: { USD: 0.12 }
    })

    const compare = await buildRaceComparison(deps, race())
    expect(compare.contenders).toHaveLength(3)
    const [a, b, c] = compare.contenders
    expect(a).toMatchObject({
      dispatchId: 'dsp_1',
      workerId: 'wrk_1',
      dispatchState: 'completed',
      taskWorkspaceId: 'tws_1',
      outcome: 'completed',
      resultExcerpt: 'done',
      durationMs: 0,
      timedOut: false,
      usage: { totalTokens: 150, turns: 3, costUsd: 0.12, valueEstimateUsd: 0.4 }
    })
    expect(a.capture).toMatchObject({ changedFiles: 3, insertions: 40, deletions: 5 })
    expect(a.checks?.[0]?.name).toBe('typecheck')
    expect(b).toMatchObject({
      dispatchState: 'failed',
      outcome: 'failed',
      durationMs: 600_000
    })
    expect(b.usage).toBeUndefined()
    expect(c).toMatchObject({ harnessId: 'kun', createError: 'spawn failed' })
    expect(c.dispatchState).toBeUndefined()
  })

  it('flags non-terminal contenders as timedOut once the deadline passed', async () => {
    const { dispatches, deps } = await harness({
      nowMs: () => Date.parse('2026-10-01T02:00:00.000Z')
    })
    await dispatches.create(dispatch({ dispatchId: 'dsp_1', workerId: 'wrk_1' }))
    await dispatches.create(dispatch({
      dispatchId: 'dsp_2', workerId: 'wrk_2', state: 'completed'
    }))
    const compare = await buildRaceComparison(deps, race())
    expect(compare.contenders[0]).toMatchObject({ dispatchState: 'accepted', timedOut: true })
    expect(compare.contenders[1]).toMatchObject({ dispatchState: 'completed', timedOut: false })
    // A create-failed contender never ran — not a timeout.
    expect(compare.contenders[2].timedOut).toBe(false)
    // A contender whose dispatch row vanished flags timeout past the deadline.
    const gone = await buildRaceComparison(deps, race({
      contenders: [{ dispatchId: 'dsp_x', workerId: 'wrk_x', harnessId: 'a', label: 'a' }]
    }))
    expect(gone.contenders[0].timedOut).toBe(true)
  })
})
