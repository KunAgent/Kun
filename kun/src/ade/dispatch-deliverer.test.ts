import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { DispatchRecord, WorkerRecord } from '../contracts/ade.js'
import type { ThreadExecutionUnit } from '../contracts/threads.js'
import type { TaskWorkspaceRecord } from '../contracts/task-workspace.js'
import type { Turn } from '../contracts/turns.js'
import type { ChildRunRecord } from '../delegation/delegation-runtime-contracts.js'
import { FileDelegationStore } from '../delegation/delegation-runtime-contracts.js'
import { InMemoryThreadStore } from '../adapters/in-memory-thread-store.js'
import { createThreadRecord } from '../domain/thread.js'
import { FileDispatchStore } from './dispatch-store.js'
import { FileTeamStore } from './team-store.js'
import { DispatchDeliverer, type DelivererDelegation } from './dispatch-deliverer.js'

let dataDir: string
let teams: FileTeamStore
let dispatches: FileDispatchStore
let childRuns: FileDelegationStore
let threads: InMemoryThreadStore

const NOW = '2026-09-26T00:00:00.000Z'

beforeEach(async () => {
  dataDir = await mkdtemp(join(tmpdir(), 'kun-ade-deliverer-'))
  teams = new FileTeamStore(dataDir, () => NOW)
  dispatches = new FileDispatchStore(dataDir, () => NOW)
  childRuns = new FileDelegationStore(join(dataDir, 'child-runs'))
  threads = new InMemoryThreadStore()
})

afterEach(async () => {
  await rm(dataDir, { recursive: true, force: true })
})

function workerRecord(overrides: Partial<WorkerRecord> = {}): WorkerRecord {
  return {
    workerId: 'wrk_1',
    label: 'implementer',
    route: { harnessId: 'kun', model: 'model-x', credentialMode: 'provider' },
    permissionMode: 'default',
    lifecycle: 'persistent',
    securitySnapshot: { sandboxRoot: '/tmp/ws', memoryEnabled: false },
    control: 'manager',
    state: 'active',
    createdAt: NOW,
    ...overrides
  }
}

function dispatchRecord(overrides: Partial<DispatchRecord> = {}): DispatchRecord {
  return {
    dispatchId: 'dsp_1',
    teamId: 'thr_mgr',
    workerId: 'wrk_1',
    parentTurnId: 'turn_mgr_1',
    title: 'fix login',
    task: 'repair the login redirect',
    mode: 'queue',
    state: 'pending',
    createdAt: NOW,
    updatedAt: NOW,
    ...overrides
  }
}

function turnRecord(overrides: Partial<Turn> = {}): Turn {
  return {
    id: 'turn_w1',
    threadId: 'wrk_1',
    status: 'running',
    orchestration: 'direct',
    prompt: 'p',
    steering: [],
    createdAt: NOW,
    items: [],
    attachmentIds: [],
    activeSkillIds: [],
    injectedMemoryIds: [],
    injectedMemorySummaries: [],
    injectedDirectiveIds: [],
    injectedDirectiveSummaries: [],
    injectedInstructionSources: [],
    ...overrides
  }
}

function workerThread(workerId: string, turns: Turn[] = []) {
  const thread = createThreadRecord({
    id: workerId,
    title: 'worker',
    workspace: '/tmp/ws',
    model: 'model-x',
    relation: 'side',
    parentThreadId: 'thr_mgr',
    executionUnit: {
      kind: 'worker',
      teamId: 'thr_mgr',
      managerThreadId: 'thr_mgr',
      label: 'implementer',
      lifecycle: 'persistent',
      control: 'manager'
    } satisfies ThreadExecutionUnit
  })
  thread.turns = turns
  return thread
}

function childRunRecord(overrides: Partial<ChildRunRecord> = {}): ChildRunRecord {
  return {
    id: 'wrk_1',
    parentThreadId: 'thr_mgr',
    parentTurnId: 'turn_mgr_1',
    prompt: 'assignment',
    approvalReviewer: 'user',
    status: 'running',
    returnFormat: 'summary',
    usage: { promptTokens: 0, completionTokens: 0, totalTokens: 0 },
    createdAt: NOW,
    updatedAt: NOW,
    ...overrides
  }
}

function workspaceRecord(state: TaskWorkspaceRecord['state']): TaskWorkspaceRecord {
  return {
    workspaceId: 'tws_1',
    ownerThreadId: 'thr_mgr',
    unitId: 'wrk_1',
    label: 'fix login',
    isolation: 'worktree',
    sourceRoot: '/repo',
    repositoryRoot: '/repo',
    path: '/repo/.worktrees/fix-login',
    startFrom: { kind: 'default-branch' },
    state,
    setup: { status: 'skipped', steps: [] },
    changedFiles: [],
    createdAt: NOW,
    updatedAt: NOW
  } as TaskWorkspaceRecord
}

function makeDelegation(overrides: Partial<DelivererDelegation> = {}): {
  delegation: DelivererDelegation
  runChild: ReturnType<typeof vi.fn>
  resumeChild: ReturnType<typeof vi.fn>
} {
  const runChild = vi.fn(async (input: { childId?: string }) => childRunRecord({ id: input.childId ?? 'wrk_1' }))
  const resumeChild = vi.fn(async (input: { childId: string }) =>
    childRunRecord({ id: input.childId, resumeCount: 1 }))
  return { delegation: { runChild, resumeChild, ...overrides }, runChild, resumeChild }
}

function makeDeliverer(opts: {
  delegation?: DelivererDelegation
  workspace?: TaskWorkspaceRecord | null
  interruptTurn?: (input: { threadId: string; turnId: string }) => Promise<{ status: string }>
}): DispatchDeliverer {
  return new DispatchDeliverer({
    teams,
    dispatches,
    taskWorkspaces: {
      get: () => opts.workspace ?? null
    } as never,
    delegation: opts.delegation,
    childRuns,
    threads,
    turns: {
      interruptTurn: opts.interruptTurn ?? vi.fn(async () => ({ status: 'aborted' as const }))
    } as never
  })
}

describe('DispatchDeliverer.tryDeliver', () => {
  beforeEach(async () => {
    await teams.ensure('thr_mgr')
    await teams.upsertWorker('thr_mgr', workerRecord())
  })

  it('delivers a pending dispatch via runChild with the dispatch id as idempotency key', async () => {
    await dispatches.create(dispatchRecord())
    const { delegation, runChild } = makeDelegation()
    const deliverer = makeDeliverer({ delegation })
    const outcome = await deliverer.tryDeliver('thr_mgr', 'dsp_1')
    expect(outcome.accepted).toBe(true)
    expect(runChild).toHaveBeenCalledTimes(1)
    const input = runChild.mock.calls[0]![0] as Record<string, unknown>
    expect(input.clientRequestId).toBe('dsp_1')
    expect(input.launcher).toBe('manager-worker')
    expect(input.childId).toBe('wrk_1')
    expect(input.detach).toBe(true)
    expect((input.executionUnit as ThreadExecutionUnit).kind).toBe('worker')
    expect((input.executionUnit as ThreadExecutionUnit).teamId).toBe('thr_mgr')
    expect(input.prompt).toContain('<kun_assignment dispatch="dsp_1"')
    expect((await dispatches.get('thr_mgr', 'dsp_1'))?.state).toBe('accepted')
  })

  it('keeps the dispatch pending while its workspace is not ready', async () => {
    await teams.upsertWorker('thr_mgr', workerRecord({ taskWorkspaceId: 'tws_1' }))
    await dispatches.create(dispatchRecord())
    const { delegation, runChild } = makeDelegation()
    const deliverer = makeDeliverer({ delegation, workspace: workspaceRecord('creating') })
    const outcome = await deliverer.tryDeliver('thr_mgr', 'dsp_1')
    expect(outcome).toEqual({ accepted: false, pendingReason: 'workspace' })
    expect(runChild).not.toHaveBeenCalled()
    expect((await dispatches.get('thr_mgr', 'dsp_1'))?.state).toBe('pending')
  })

  it('fails the dispatch when its workspace setup failed', async () => {
    await teams.upsertWorker('thr_mgr', workerRecord({ taskWorkspaceId: 'tws_1' }))
    await dispatches.create(dispatchRecord())
    const { delegation } = makeDelegation()
    const deliverer = makeDeliverer({
      delegation,
      workspace: { ...workspaceRecord('failed'), lastError: 'setup exited 1' }
    })
    const outcome = await deliverer.tryDeliver('thr_mgr', 'dsp_1')
    expect(outcome.accepted).toBe(false)
    const dispatch = await dispatches.get('thr_mgr', 'dsp_1')
    expect(dispatch?.state).toBe('failed')
    expect(dispatch?.failureReason).toContain('setup exited 1')
  })

  it('queues behind an active worker turn and delivers after it clears', async () => {
    const worker = workerThread('wrk_1', [turnRecord({ status: 'running' })])
    await threads.upsert(worker)
    await dispatches.create(dispatchRecord())
    const { delegation, runChild } = makeDelegation()
    const deliverer = makeDeliverer({ delegation })
    expect(await deliverer.tryDeliver('thr_mgr', 'dsp_1'))
      .toEqual({ accepted: false, pendingReason: 'worker-busy' })
    expect(runChild).not.toHaveBeenCalled()
    // The turn ends; the terminal path retries through tryDeliverNext.
    worker.turns = [turnRecord({ status: 'completed', finishedAt: NOW })]
    await threads.upsert(worker)
    await deliverer.tryDeliverNext('thr_mgr', 'wrk_1')
    expect(runChild).toHaveBeenCalledTimes(1)
    expect((await dispatches.get('thr_mgr', 'dsp_1'))?.state).toBe('accepted')
  })

  it('interrupts the active worker turn for interrupt-mode dispatches', async () => {
    const worker = workerThread('wrk_1', [turnRecord({ status: 'running' })])
    await threads.upsert(worker)
    await dispatches.create(dispatchRecord({ mode: 'interrupt' }))
    const { delegation } = makeDelegation()
    const interruptTurn = vi.fn(async (input: { threadId: string; turnId: string }) => {
      worker.turns = worker.turns.map((turn) =>
        turn.id === input.turnId ? { ...turn, status: 'aborted' as const } : turn)
      await threads.upsert(worker)
      return { status: 'aborted' as const }
    })
    const deliverer = makeDeliverer({ delegation, interruptTurn })
    const outcome = await deliverer.tryDeliver('thr_mgr', 'dsp_1')
    expect(interruptTurn).toHaveBeenCalledWith({ threadId: 'wrk_1', turnId: 'turn_w1' })
    expect(outcome.accepted).toBe(true)
  })

  it('stays queued when the interrupted worker turn is still unwinding', async () => {
    const worker = workerThread('wrk_1', [turnRecord({ status: 'running' })])
    await threads.upsert(worker)
    await dispatches.create(dispatchRecord({ mode: 'interrupt' }))
    const { delegation, runChild } = makeDelegation()
    const deliverer = makeDeliverer({ delegation })
    expect(await deliverer.tryDeliver('thr_mgr', 'dsp_1'))
      .toEqual({ accepted: false, pendingReason: 'worker-busy' })
    expect(runChild).not.toHaveBeenCalled()
  })

  it('marks failed when the run rejects before any turn was admitted', async () => {
    await dispatches.create(dispatchRecord())
    const runChild = vi.fn(async () => { throw new Error('invalid profile') })
    const deliverer = makeDeliverer({ delegation: { runChild, resumeChild: vi.fn() } })
    await deliverer.tryDeliver('thr_mgr', 'dsp_1')
    const dispatch = await dispatches.get('thr_mgr', 'dsp_1')
    expect(dispatch?.state).toBe('failed')
    expect(dispatch?.failureReason).toContain('invalid profile')
  })

  it('marks uncertain when the run rejects after a turn was admitted', async () => {
    await dispatches.create(dispatchRecord())
    const worker = workerThread('wrk_1')
    const runChild = vi.fn(async () => {
      worker.turns = [turnRecord({ clientRequestId: 'dsp_1', status: 'running' })]
      await threads.upsert(worker)
      throw new Error('stream died')
    })
    const deliverer = makeDeliverer({ delegation: { runChild, resumeChild: vi.fn() } })
    await deliverer.tryDeliver('thr_mgr', 'dsp_1')
    expect((await dispatches.get('thr_mgr', 'dsp_1'))?.state).toBe('uncertain')
  })

  it('holds dispatches for user-controlled workers until hand-back', async () => {
    await teams.upsertWorker('thr_mgr', workerRecord({ control: 'user' }))
    await dispatches.create(dispatchRecord())
    const { delegation, runChild } = makeDelegation()
    const deliverer = makeDeliverer({ delegation })
    const outcome = await deliverer.tryDeliver('thr_mgr', 'dsp_1')
    expect(outcome).toEqual({ accepted: false, pendingReason: 'user-control' })
    const dispatch = await dispatches.get('thr_mgr', 'dsp_1')
    expect(dispatch?.state).toBe('pending')
    expect(runChild).not.toHaveBeenCalled()
  })

  it('cancels dispatches for released workers', async () => {
    await teams.upsertWorker('thr_mgr', workerRecord({ state: 'released' }))
    await dispatches.create(dispatchRecord())
    const { delegation, runChild } = makeDelegation()
    const deliverer = makeDeliverer({ delegation })
    await deliverer.tryDeliver('thr_mgr', 'dsp_1')
    const dispatch = await dispatches.get('thr_mgr', 'dsp_1')
    expect(dispatch?.state).toBe('cancelled')
    expect(dispatch?.failureReason).toContain('released')
    expect(runChild).not.toHaveBeenCalled()
  })

  it('fails fast when the delegation runtime is absent', async () => {
    await dispatches.create(dispatchRecord())
    const deliverer = makeDeliverer({ delegation: undefined })
    await deliverer.tryDeliver('thr_mgr', 'dsp_1')
    expect((await dispatches.get('thr_mgr', 'dsp_1'))?.state).toBe('failed')
  })

  it('resumes through resumeChild when the worker already has a run record', async () => {
    await childRuns.upsert(childRunRecord({ resumeCount: 2 }))
    await dispatches.create(dispatchRecord({ dispatchId: 'dsp_2' }))
    const { delegation, runChild, resumeChild } = makeDelegation()
    const deliverer = makeDeliverer({ delegation })
    expect((await deliverer.tryDeliver('thr_mgr', 'dsp_2')).accepted).toBe(true)
    expect(runChild).not.toHaveBeenCalled()
    const input = resumeChild.mock.calls[0]![0] as Record<string, unknown>
    expect(input.childId).toBe('wrk_1')
    expect(input.expectedResumeCount).toBe(2)
    expect(input.expectedLaunchers).toEqual(['manager-worker'])
    expect(input.clientRequestId).toBe('dsp_2')
  })

  it('serializes concurrent deliveries for the same team', async () => {
    await dispatches.create(dispatchRecord())
    const { delegation, runChild } = makeDelegation()
    const deliverer = makeDeliverer({ delegation })
    const [a, b] = await Promise.all([
      deliverer.tryDeliver('thr_mgr', 'dsp_1'),
      deliverer.tryDeliver('thr_mgr', 'dsp_1')
    ])
    expect(a.accepted || b.accepted).toBe(true)
    expect(runChild).toHaveBeenCalledTimes(1)
  })
})

describe('DispatchDeliverer.reconcileTeam', () => {
  beforeEach(async () => {
    await teams.ensure('thr_mgr')
    await teams.upsertWorker('thr_mgr', workerRecord())
  })

  it('adopts a delivering dispatch whose turn exists (backfills turnId)', async () => {
    await dispatches.create(dispatchRecord({ state: 'delivering' }))
    await threads.upsert(
      workerThread('wrk_1', [turnRecord({ id: 'turn_w9', clientRequestId: 'dsp_1', status: 'running' })])
    )
    const { delegation, runChild } = makeDelegation()
    const deliverer = makeDeliverer({ delegation })
    await deliverer.reconcileTeam('thr_mgr')
    const dispatch = await dispatches.get('thr_mgr', 'dsp_1')
    expect(dispatch?.state).toBe('accepted')
    expect(dispatch?.turnId).toBe('turn_w9')
    expect(runChild).not.toHaveBeenCalled()
  })

  it('redelivers a stuck dispatch under the same idempotency key', async () => {
    await dispatches.create(dispatchRecord({ state: 'delivering' }))
    const { delegation, runChild } = makeDelegation()
    const deliverer = makeDeliverer({ delegation })
    await deliverer.reconcileTeam('thr_mgr')
    expect(runChild).toHaveBeenCalledTimes(1)
    expect((runChild.mock.calls[0]![0] as Record<string, unknown>).clientRequestId).toBe('dsp_1')
  })
})
