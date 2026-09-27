import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import type { UsageSnapshot } from '../contracts/usage.js'
import { computeTeamUsage, TeamBudgetGate } from './team-budget.js'
import {
  makeHarness,
  managerCtx,
  seedWorker,
  setupAdeStores,
  teardownAdeStores,
  type AdeStores
} from './manager-controls-test-support.js'
import { ManagerRuntime } from './manager-runtime.js'

let stores: AdeStores
let budgetOpt: { softTokens?: number; hardTokens?: number } | undefined

beforeEach(async () => {
  stores = await setupAdeStores(undefined, budgetOpt)
  budgetOpt = undefined
})

afterEach(async () => {
  await teardownAdeStores(stores)
})

function snap(totalTokens: number): UsageSnapshot {
  return { promptTokens: 0, completionTokens: 0, totalTokens } as UsageSnapshot
}

// Re-seed with a budgeted team (setupAdeStores' beforeEach ensure already
// ran without one); callers then build the harness on the fresh stores.
async function seedTeamBudget(budget: { softTokens?: number; hardTokens?: number }) {
  await teardownAdeStores(stores)
  stores = await setupAdeStores(undefined, budget)
  await seedWorker(stores)
}

describe('computeTeamUsage', () => {
  it('sums worker-thread usage and flags soft/hard crossings', async () => {
    await seedTeamBudget({ softTokens: 100, hardTokens: 200 })
    const team = (await stores.teams.get('thr_mgr'))!
    const usage = { forThread: () => snap(150) }
    const report = computeTeamUsage(team, usage)
    expect(report.totalTokens).toBe(150)
    expect(report.perWorker).toEqual([
      { workerId: 'wrk_1', label: 'fixer', totalTokens: 150 }
    ])
    expect(report.softExceeded).toBe(true)
    expect(report.hardExceeded).toBe(false)
  })
})

describe('TeamBudgetGate', () => {
  it('notifies soft once, then repeats as soft-repeat', async () => {
    await seedTeamBudget({ softTokens: 100, hardTokens: 200 })
    const team = (await stores.teams.get('thr_mgr'))!
    const gate = new TeamBudgetGate({ forThread: () => snap(150) })
    expect(gate.check(team).exceeded).toBe('soft-first')
    expect(gate.check(team).exceeded).toBe('soft-repeat')
  })

  it('always reports hard crossings', async () => {
    await seedTeamBudget({ softTokens: 100, hardTokens: 200 })
    const team = (await stores.teams.get('thr_mgr'))!
    const gate = new TeamBudgetGate({ forThread: () => snap(250) })
    expect(gate.check(team).exceeded).toBe('hard')
    expect(gate.check(team).exceeded).toBe('hard')
  })
})

describe('budget enforcement (P3-15)', () => {
  it('worker_send refuses at the hard cap with the reason in userReport', async () => {
    await seedTeamBudget({ softTokens: 100, hardTokens: 200 })
    const { controls } = makeHarness(stores, {
      usageForThread: () => snap(250)
    })
    const result = await controls.workerSend(managerCtx(), {
      workerId: 'wrk_1',
      task: 'more work'
    })
    expect(result.ok).toBe(false)
    expect(result.refusal).toBe('budget_exceeded')
    expect(result.userReport).toContain('250/200')
    expect(await stores.dispatches.list('thr_mgr')).toHaveLength(0)
  })

  it('worker_send at the soft cap dispatches and enqueues exactly one notice', async () => {
    await seedTeamBudget({ softTokens: 100, hardTokens: 200 })
    const { controls } = makeHarness(stores, {
      usageForThread: () => snap(150)
    })
    const first = await controls.workerSend(managerCtx(), {
      workerId: 'wrk_1',
      task: 'soft work'
    })
    expect(first.ok).toBe(true)
    const notices = await stores.notices.list('thr_mgr')
    const budgetNotices = notices.filter((n) => n.kind === 'team_budget')
    expect(budgetNotices).toHaveLength(1)
    expect(budgetNotices[0]!.workerId).toBe('wrk_1')
    expect(budgetNotices[0]!.detail).toContain('150/100')
  })

  it('a later soft crossing enqueues no second notice', async () => {
    await seedTeamBudget({ softTokens: 100, hardTokens: 200 })
    const { controls } = makeHarness(stores, {
      usageForThread: () => snap(150)
    })
    await controls.workerSend(managerCtx(), { workerId: 'wrk_1', task: 'one' })
    await controls.workerSend(managerCtx(), { workerId: 'wrk_1', task: 'two' })
    const notices = (await stores.notices.list('thr_mgr'))
      .filter((n) => n.kind === 'team_budget')
    expect(notices).toHaveLength(1)
  })

  it('worker_create refuses at the hard cap before creating anything', async () => {
    await seedTeamBudget({ softTokens: 100, hardTokens: 200 })
    const { deps } = makeHarness(stores, {
      usageForThread: () => snap(250)
    })
    const runtime = new ManagerRuntime(deps)
    const result = await runtime.createWorker(managerCtx(), {
      label: 'helper', task: 'split the diff'
    }, { workspace: '/repo' } as never)
    expect(result.ok).toBe(false)
    expect(result.refusal).toBe('budget_exceeded')
    expect(result.userReport).toContain('250/200')
    expect((await stores.teams.get('thr_mgr'))!.workers).toHaveLength(1)
    expect(await stores.dispatches.list('thr_mgr')).toHaveLength(0)
  })

  it('guiDispatch refuses at the hard cap without creating a dispatch', async () => {
    await seedTeamBudget({ softTokens: 100, hardTokens: 200 })
    const { teamControls } = makeHarness(stores, {
      usageForThread: () => snap(250)
    })
    const result = await teamControls.guiDispatch('wrk_1', { task: 'gui work' })
    expect(result.ok).toBe(false)
    expect(result.refusal).toBe('budget_exceeded')
    expect(result.userReport).toContain('250/200')
    expect(await stores.dispatches.list('thr_mgr')).toHaveLength(0)
  })

  it('teamOverview reports the summed usage for the panel header', async () => {
    await seedTeamBudget({ softTokens: 100, hardTokens: 200 })
    const { teamControls } = makeHarness(stores, {
      usageForThread: () => snap(150)
    })
    const overview = await teamControls.teamOverview('thr_mgr')
    expect(overview?.usage?.totalTokens).toBe(150)
    expect(overview?.usage?.softExceeded).toBe(true)
    expect(overview?.usage?.hardExceeded).toBe(false)
  })
})
