import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { DispatchRecord, WorkerRecord } from '../contracts/ade.js'
import type { ThreadRecord } from '../contracts/threads.js'
import type { TaskWorkspaceRecord } from '../contracts/task-workspace.js'
import type { Turn } from '../contracts/turns.js'
import type { ChildRunRecord } from '../delegation/delegation-runtime-contracts.js'
import type { HarnessStatus } from '../contracts/harness.js'
import { FileDelegationStore } from '../delegation/delegation-runtime-contracts.js'
import { InMemoryThreadStore } from '../adapters/in-memory-thread-store.js'
import { createThreadRecord } from '../domain/thread.js'
import { BUILTIN_HARNESSES, KUN_NATIVE_CAPABILITIES } from '../harness/builtin-harnesses.js'
import { FileDispatchStore } from './dispatch-store.js'
import { FileTeamStore } from './team-store.js'
import { FileQuestionStore } from './question-store.js'
import { FileWorkerNoticeStore } from './worker-notice-store.js'
import { DispatchDeliverer, type DelivererDelegation } from './dispatch-deliverer.js'
import { ManagerRuntime, type ManagerRuntimeDeps, type ManagerToolContext } from './manager-runtime.js'
import { shouldAdvertiseManagerTools } from '../domain/manager-tools.js'

let dataDir: string
let teams: FileTeamStore
let dispatches: FileDispatchStore
let questions: FileQuestionStore
let notices: FileWorkerNoticeStore
let childRuns: FileDelegationStore
let threads: InMemoryThreadStore

const NOW = '2026-09-26T00:00:00.000Z'

beforeEach(async () => {
  dataDir = await mkdtemp(join(tmpdir(), 'kun-ade-manager-'))
  teams = new FileTeamStore(dataDir, () => NOW)
  dispatches = new FileDispatchStore(dataDir, () => NOW)
  questions = new FileQuestionStore(dataDir, () => NOW)
  notices = new FileWorkerNoticeStore(dataDir, () => NOW)
  childRuns = new FileDelegationStore(join(dataDir, 'child-runs'))
  threads = new InMemoryThreadStore()
})

afterEach(async () => {
  await rm(dataDir, { recursive: true, force: true })
})

function managerThread(): ThreadRecord {
  return createThreadRecord({
    id: 'thr_mgr',
    title: 'manager',
    workspace: '/repo',
    model: 'model-x',
    providerId: 'prov-1'
  })
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

function readyStatus(harnessId: string): HarnessStatus {
  return { harnessId: harnessId as HarnessStatus['harnessId'], installed: 'yes', login: 'signed-in', checkedAt: NOW }
}

function managerCtx(overrides: Partial<ManagerToolContext> = {}): ManagerToolContext {
  return {
    threadId: 'thr_mgr',
    turnId: 'turn_mgr_1',
    workspace: '/repo',
    authority: { kunPermissionMode: 'full-access', interactive: false },
    signal: new AbortController().signal,
    awaitApproval: vi.fn(async () => 'deny' as const),
    ...overrides
  }
}

function makeRuntime(opts: {
  workspaceState?: TaskWorkspaceRecord['state']
  runChild?: (input: { childId?: string; prompt?: string }) => Promise<ChildRunRecord>
  capabilities?: typeof KUN_NATIVE_CAPABILITIES
  teamLimits?: ManagerRuntimeDeps['teamLimits']
  selector?: ManagerRuntimeDeps['selector']
  providerPool?: ManagerRuntimeDeps['providerPool']
  probedModels?: ManagerRuntimeDeps['probedModels']
} = {}) {
  const workspace = workspaceRecord(opts.workspaceState ?? 'ready')
  const runChild = vi.fn(opts.runChild ?? (async (input: { childId?: string }) =>
    childRunRecord({ id: input.childId ?? 'wrk_1' })))
  const resumeChild = vi.fn(async (input: { childId: string }) =>
    childRunRecord({ id: input.childId, resumeCount: 1 }))
  const delegation: DelivererDelegation = { runChild, resumeChild }
  const taskWorkspaces = {
    create: vi.fn(async () => workspace),
    get: vi.fn(() => workspace),
    onChange: vi.fn(() => () => {}),
    captureForDispatch: vi.fn(async () => ({
      record: workspace,
      stat: { changedFiles: 1, insertions: 3, deletions: 2 }
    }))
  }
  const activity = { register: vi.fn(), apply: vi.fn(), get: vi.fn(() => undefined) }
  const turns = { getTurn: vi.fn(async () => null) }
  const deliverer = new DispatchDeliverer({
    teams,
    dispatches,
    taskWorkspaces: taskWorkspaces as never,
    delegation,
    childRuns,
    threads,
    turns: { interruptTurn: vi.fn(async () => ({ status: 'aborted' as const })) } as never,
    language: () => 'en'
  })
  const runtime = new ManagerRuntime({
    teams,
    dispatches,
    questions,
    notices,
    threads,
    turns: turns as never,
    sessionStore: { loadItems: vi.fn(async () => []) } as never,
    taskWorkspaces: taskWorkspaces as never,
    activity: activity as never,
    delegation,
    childRuns,
    catalog: {
      get: (id: string) => BUILTIN_HARNESSES.find((def) => def.id === id),
      list: () => BUILTIN_HARNESSES,
      isDisabled: () => false
    } as never,
    detector: { status: async (id: string) => readyStatus(id) } as never,
    capabilitiesForRoute: async () => opts.capabilities ?? KUN_NATIVE_CAPABILITIES,
    deliverer,
    ids: (() => { let seq = 0; return { next: (prefix: string) => `${prefix}_${(seq += 1)}` } })(),
    nowIso: () => NOW,
    language: () => 'en',
    allowUnattendedFullAccess: () => false,
    teamLimits: opts.teamLimits,
    providerPool: opts.providerPool,
    probedModels: opts.probedModels,
    ...(opts.selector ? { selector: opts.selector } : {})
  })
  return { runtime, deliverer, runChild, resumeChild, taskWorkspaces, activity, turns, workspace }
}

const TOOL_CONTEXT = { workspace: '/repo' } as never

describe('shouldAdvertiseManagerTools', () => {
  it('advertises only on native-loop ADE threads that are not workers or rooms', () => {
    expect(shouldAdvertiseManagerTools({
      workspaceMode: 'ade', harnessId: 'kun'
    })).toBe(true)
    expect(shouldAdvertiseManagerTools({
      workspaceMode: 'ade', harnessId: 'claude-code'
    })).toBe(false)
    expect(shouldAdvertiseManagerTools({
      workspaceMode: 'ade', harnessId: 'kun', executionUnitKind: 'worker'
    })).toBe(false)
    expect(shouldAdvertiseManagerTools({
      workspaceMode: 'ade', harnessId: 'kun', roomAgent: true
    })).toBe(false)
    expect(shouldAdvertiseManagerTools({
      workspaceMode: 'code', harnessId: 'kun'
    })).toBe(false)
  })
})

describe('ManagerRuntime.createWorker', () => {
  beforeEach(async () => {
    await threads.upsert(managerThread())
  })

  it('creates worker, registers activity, persists dispatch and delivers it', async () => {
    const { runtime, runChild, taskWorkspaces, activity } = makeRuntime()
    const result = await runtime.createWorker(managerCtx(), {
      label: 'fixer', task: 'repair login redirect'
    }, TOOL_CONTEXT)
    expect(result.ok).toBe(true)
    expect(result.dispatched).toBe(true)
    const worker = (await teams.get('thr_mgr'))!.workers[0]!
    expect(worker.workerId).toBe(result.workerId)
    expect(worker.control).toBe('manager')
    // The worker write root is the task workspace, not the manager's checkout.
    expect(worker.securitySnapshot.allowedWritePaths).toEqual(['/repo/.worktrees/fix-login'])
    expect(taskWorkspaces.create).toHaveBeenCalledTimes(1)
    expect(activity.register).toHaveBeenCalledWith(
      expect.objectContaining({ unitId: result.workerId, kind: 'worker', teamId: 'thr_mgr' })
    )
    // The preallocated child id is the worker thread id AND the run id.
    const runInput = runChild.mock.calls[0]![0] as Record<string, unknown>
    expect(runInput.childId).toBe(result.workerId)
    expect(runInput.clientRequestId).toBe(result.dispatchId)
    expect(result.userReport).toContain('fixer')
  })

  it('scopes the snapshot to the settled worktree path, not the provisional source root', async () => {
    // Regression: `create` returns before the checkout exists — its `path`
    // still points at the manager workspace. The snapshot must wait for
    // settlement or the worker can write nowhere (09 §7.1).
    const { runtime, runChild, taskWorkspaces } = makeRuntime()
    taskWorkspaces.create.mockResolvedValue({ ...workspaceRecord('creating'), path: '/repo' })
    taskWorkspaces.get.mockReturnValueOnce(workspaceRecord('ready'))
    const result = await runtime.createWorker(managerCtx(), {
      label: 'fixer', task: 'repair login redirect'
    }, TOOL_CONTEXT)
    expect(result.ok).toBe(true)
    const worker = (await teams.get('thr_mgr'))!.workers[0]!
    expect(worker.securitySnapshot.sandboxRoot).toBe('/repo/.worktrees/fix-login')
    expect(worker.securitySnapshot.allowedWritePaths).toEqual(['/repo/.worktrees/fix-login'])
    expect(runChild).toHaveBeenCalled()
  })

  it('refuses worker creation when the task workspace fails to materialize', async () => {
    const { runtime, runChild, taskWorkspaces } = makeRuntime()
    taskWorkspaces.create.mockResolvedValue({ ...workspaceRecord('creating'), path: '/repo' })
    taskWorkspaces.get.mockReturnValueOnce({
      ...workspaceRecord('failed'), lastError: 'source is not a git repository'
    })
    const result = await runtime.createWorker(managerCtx(), {
      label: 'fixer', task: 'repair login redirect'
    }, TOOL_CONTEXT)
    expect(result.ok).toBe(false)
    expect(result.refusal).toBe('workspace_unavailable')
    expect(result.userReport).toContain('not a git repository')
    expect((await teams.get('thr_mgr'))!.workers).toHaveLength(0)
    expect(runChild).not.toHaveBeenCalled()
  })

  it('routes omitted-agent creates through the selector and persists its decision', async () => {
    const { runtime, runChild } = makeRuntime({
      selector: {
        profiles: async () => [{
          kind: 'profile' as const,
          id: 'reviewer',
          source: 'configured' as const,
          profile: {
            mode: 'subagent' as const,
            toolPolicy: 'inherit' as const,
            name: 'Reviewer',
            description: 'reviews diffs',
            delegationNotes: 'login redirect specialist',
            harnessId: 'claude-code' as const,
            credentialMode: 'native-login' as const,
            model: 'claude-sonnet-5'
          }
        }],
        quota: async () => null,
        agentOrder: () => [],
        modelCostTier: () => 0 as const
      }
    })
    const result = await runtime.createWorker(managerCtx(), {
      label: 'fixer', role: 'reviewer', task: 'repair login redirect'
    }, TOOL_CONTEXT)
    expect(result.ok).toBe(true)
    const worker = (await teams.get('thr_mgr'))!.workers[0]!
    expect(worker.route).toMatchObject({
      harnessId: 'claude-code',
      credentialMode: 'native-login',
      model: 'claude-sonnet-5'
    })
    expect(worker.profileId).toBe('reviewer')
    expect(worker.selection).toMatchObject({ reason: expect.stringContaining('Reviewer') })
    expect(worker.selection!.score).toBeCloseTo(1, 5)
    expect(worker.selection!.alternatives.length).toBeGreaterThan(0)
    expect(result.selection?.reason).toBe(worker.selection!.reason)
    expect(result.userReport).toContain('Selected Reviewer')
    const runInput = runChild.mock.calls[0]![0] as Record<string, unknown>
    expect(runInput.profile).toBe('reviewer')
    expect(runInput.routing).toMatchObject({
      method: 'worker-selector',
      selectedKind: 'profile',
      selectedId: 'reviewer'
    })
    expect((runInput.routing as { candidates: unknown[] }).candidates.length)
      .toBeGreaterThan(0)
  })

  it('keeps the manager-route fallback when selector inputs are absent', async () => {
    const { runtime } = makeRuntime()
    const result = await runtime.createWorker(managerCtx(), {
      label: 'fixer', task: 'task'
    }, TOOL_CONTEXT)
    expect(result.ok).toBe(true)
    const worker = (await teams.get('thr_mgr'))!.workers[0]!
    expect(worker.route).toMatchObject({
      harnessId: 'kun', model: 'model-x', providerId: 'prov-1', credentialMode: 'provider'
    })
    expect(worker.profileId).toBeUndefined()
    expect(worker.selection).toBeUndefined()
  })

  it('returns a refusal when the selector finds no eligible route', async () => {
    const { runtime, taskWorkspaces } = makeRuntime({
      selector: {
        profiles: async () => [],
        quota: async () => null,
        agentOrder: () => [],
        modelCostTier: () => 0 as const
      },
      capabilities: {
        statuses: {},
        facts: { sandbox: 'none', usageReporting: 'none', compactionOwner: 'harness' }
      } as never
    })
    const result = await runtime.createWorker(managerCtx(), {
      label: 'fixer', task: 'task'
    }, TOOL_CONTEXT)
    expect(result.ok).toBe(false)
    expect(result.refusal).toBe('invalid_agent')
    expect(taskWorkspaces.create).not.toHaveBeenCalled()
  })

  it('refuses at the hard worker limit without touching workspaces', async () => {
    const { runtime, taskWorkspaces, runChild } = makeRuntime({
      teamLimits: () => ({ hardWorkers: 1 })
    })
    await teams.ensure('thr_mgr', { hardWorkers: 1 })
    await teams.upsertWorker('thr_mgr', {
      workerId: 'wrk_busy',
      label: 'busy',
      route: { harnessId: 'kun', model: 'model-x', credentialMode: 'provider' },
      permissionMode: 'default',
      lifecycle: 'persistent',
      securitySnapshot: { sandboxRoot: '/repo', memoryEnabled: false },
      control: 'manager',
      state: 'active',
      createdAt: NOW
    } as WorkerRecord)
    const result = await runtime.createWorker(managerCtx(), {
      label: 'fixer', task: 'task'
    }, TOOL_CONTEXT)
    expect(result.ok).toBe(false)
    expect(result.refusal).toBe('worker_limit')
    expect(taskWorkspaces.create).not.toHaveBeenCalled()
    expect(runChild).not.toHaveBeenCalled()
  })

  it('refuses admission when the harness misses required capabilities', async () => {
    const missing = structuredClone(KUN_NATIVE_CAPABILITIES)
    missing.statuses.structuredStreaming = {
      supported: false, reason: 'not-implemented', message: 'no stream'
    }
    const { runtime, taskWorkspaces } = makeRuntime({ capabilities: missing })
    const result = await runtime.createWorker(managerCtx(), {
      label: 'fixer', task: 'task', agent: { harnessId: 'kun' }
    }, TOOL_CONTEXT)
    expect(result.ok).toBe(false)
    expect(result.refusal).toBe('admission')
    expect(result.admission && !result.admission.ok && result.admission.missing.length).toBeTruthy()
    expect(taskWorkspaces.create).not.toHaveBeenCalled()
  })

  it('rejects a model outside the harness static model list', async () => {
    const { runtime } = makeRuntime()
    const result = await runtime.createWorker(managerCtx(), {
      label: 'fixer', task: 'task',
      agent: { harnessId: 'claude-code', model: 'not-a-model' }
    }, TOOL_CONTEXT)
    expect(result.ok).toBe(false)
    expect(result.refusal).toBe('invalid_agent')
    expect(result.userReport).toContain('not-a-model')
  })

  it('dispatches claude-code on a kun/<provider>/<model> gateway route', async () => {
    const { runtime } = makeRuntime({
      providerPool: async (providerId) =>
        providerId === 'deepseek'
          ? { kind: 'http', models: ['deepseek-chat', 'deepseek-reasoner'] }
          : undefined
    })
    const result = await runtime.createWorker(managerCtx(), {
      label: 'fixer', task: 'task',
      agent: {
        harnessId: 'claude-code',
        credentialMode: 'kun-gateway',
        model: 'kun/deepseek/deepseek-chat'
      }
    }, TOOL_CONTEXT)
    expect(result.ok).toBe(true)
    const worker = (await teams.get('thr_mgr'))!.workers[0]!
    expect(worker.route).toMatchObject({
      harnessId: 'claude-code',
      credentialMode: 'kun-gateway',
      providerId: 'deepseek',
      model: 'kun/deepseek/deepseek-chat'
    })
  })

  it('rejects a gateway route whose provider is not configured', async () => {
    const { runtime, taskWorkspaces } = makeRuntime({
      providerPool: async () => undefined
    })
    const result = await runtime.createWorker(managerCtx(), {
      label: 'fixer', task: 'task',
      agent: {
        harnessId: 'claude-code',
        credentialMode: 'kun-gateway',
        model: 'kun/ghost/some-model'
      }
    }, TOOL_CONTEXT)
    expect(result.ok).toBe(false)
    expect(result.refusal).toBe('invalid_agent')
    expect(result.userReport).toContain('"ghost"')
    expect(taskWorkspaces.create).not.toHaveBeenCalled()
  })

  it('clamps a requested permission mode past the manager authority', async () => {
    const { runtime, runChild } = makeRuntime()
    const result = await runtime.createWorker(
      managerCtx({ authority: { kunPermissionMode: 'approve-for-me', interactive: false } }),
      { label: 'fixer', task: 'task', permissionMode: 'full-access' },
      TOOL_CONTEXT
    )
    expect(result.ok).toBe(true)
    expect(result.permissionMode).toEqual({
      requested: 'full-access', effective: 'approve-for-me', downgraded: true
    })
    const worker = (await teams.get('thr_mgr'))!.workers[0]!
    expect(worker.permissionMode).toBe('approve-for-me')
    // Non-interactive turns never ask; the downgrade is silent.
    const runInput = runChild.mock.calls[0]![0] as Record<string, unknown>
    expect(runInput.childId).toBe(worker.workerId)
  })

  it('asks the user for full-access escalation and refuses when declined', async () => {
    const awaitApproval = vi.fn(async () => 'deny' as const)
    const { runtime, taskWorkspaces, runChild } = makeRuntime()
    const result = await runtime.createWorker(
      managerCtx({
        authority: { kunPermissionMode: 'approve-for-me', interactive: true },
        awaitApproval
      }),
      { label: 'fixer', task: 'task', permissionMode: 'full-access' },
      TOOL_CONTEXT
    )
    expect(result.ok).toBe(false)
    expect(result.refusal).toBe('escalation_declined')
    expect(awaitApproval).toHaveBeenCalledTimes(1)
    expect(taskWorkspaces.create).not.toHaveBeenCalled()
    expect(runChild).not.toHaveBeenCalled()
    expect(await teams.get('thr_mgr')).toMatchObject({ workers: [] })
  })

  it('runs at the requested mode once the user confirms escalation', async () => {
    const awaitApproval = vi.fn(async () => 'allow' as const)
    const { runtime } = makeRuntime()
    const result = await runtime.createWorker(
      managerCtx({
        authority: { kunPermissionMode: 'approve-for-me', interactive: true },
        awaitApproval
      }),
      { label: 'fixer', task: 'task', permissionMode: 'full-access' },
      TOOL_CONTEXT
    )
    expect(result.ok).toBe(true)
    expect(result.permissionMode?.effective).toBe('full-access')
    expect(result.permissionMode?.downgraded).toBe(false)
    const worker = (await teams.get('thr_mgr'))!.workers[0]!
    expect(worker.permissionMode).toBe('full-access')
  })

  it('reports workspace-pending and delivers once the workspace is ready', async () => {
    const { runtime, taskWorkspaces, runChild } = makeRuntime({ workspaceState: 'creating' })
    // createWorker settles the snapshot on the final path (first get → ready);
    // the store can still report mid-creation state when the deliverer looks
    // the workspace up.
    taskWorkspaces.get.mockReturnValueOnce(workspaceRecord('ready'))
    const result = await runtime.createWorker(managerCtx(), {
      label: 'fixer', task: 'task'
    }, TOOL_CONTEXT)
    expect(result.ok).toBe(true)
    expect(result.dispatched).toBe(false)
    expect(result.deliveryPending).toBe('workspace')
    expect(runChild).not.toHaveBeenCalled()
    // Workspace resolves → onChange → handleWorkspaceChange retries delivery.
    taskWorkspaces.get.mockReturnValue({ ...workspaceRecord('ready') })
    await runtime.handleWorkspaceChange(workspaceRecord('ready'))
    expect(runChild).toHaveBeenCalledTimes(1)
    expect((await dispatches.get('thr_mgr', result.dispatchId!))?.state).toBe('accepted')
  })

  it('keeps batch accounting: requested = created + failed + skipped', async () => {
    const { runtime } = makeRuntime({ teamLimits: () => ({ hardWorkers: 2 }) })
    await teams.ensure('thr_mgr', { hardWorkers: 2 })
    const result = await runtime.createWorkerBatch(managerCtx(), {
      items: [
        { label: 'a', task: 'ta' },
        { label: 'b', task: 'tb' },
        { label: 'c', task: 'tc' },
        { label: 'd', task: 'td' }
      ]
    }, TOOL_CONTEXT)
    expect(result.requested).toBe(4)
    expect(result.created).toBe(2)
    expect(result.failed).toBe(1)
    expect(result.skipped).toBe(1)
    expect(result.items[2]).toMatchObject({ index: 2, label: 'c' })
    expect(result.items[2]!.result).not.toBe('skipped')
    expect(result.items[3]).toEqual({ index: 3, label: 'd', result: 'skipped' })
    expect(result.requested).toBe(result.created + result.failed + result.skipped)
  })
})

describe('ManagerRuntime worker terminal handling', () => {
  beforeEach(async () => {
    await threads.upsert(managerThread())
  })

  async function createAndDeliver(opts: Parameters<typeof makeRuntime>[0] = {}) {
    const helpers = makeRuntime(opts)
    const result = await helpers.runtime.createWorker(managerCtx(), {
      label: 'fixer', task: 'task'
    }, TOOL_CONTEXT)
    return { ...helpers, result }
  }

  it('completes the dispatch, stores the capture stat and enqueues a notice', async () => {
    const { runtime, result } = await createAndDeliver()
    const workerId = result.workerId!
    const workerThread = createThreadRecord({
      id: workerId,
      title: 'worker',
      workspace: '/repo/.worktrees/fix-login',
      model: 'model-x',
      relation: 'side',
      parentThreadId: 'thr_mgr',
      executionUnit: {
        kind: 'worker', teamId: 'thr_mgr', managerThreadId: 'thr_mgr',
        label: 'fixer', lifecycle: 'persistent', control: 'manager'
      }
    })
    workerThread.turns = [
      turnRecord({ id: 'turn_w1', threadId: workerId, status: 'completed', clientRequestId: result.dispatchId })
    ]
    await threads.upsert(workerThread)
    await runtime.handleWorkerTurnTerminal(workerId, 'turn_w1', 'completed')
    const dispatch = await dispatches.get('thr_mgr', result.dispatchId!)
    expect(dispatch?.state).toBe('completed')
    expect(dispatch?.outcome).toBe('completed')
    expect(dispatch?.turnId).toBe('turn_w1')
    expect(dispatch?.capture).toEqual({ changedFiles: 1, insertions: 3, deletions: 2 })
    const pending = await notices.pending('thr_mgr')
    expect(pending).toHaveLength(1)
    expect(pending[0]!.kind).toBe('dispatch_completed')
    expect(pending[0]!.dispatchId).toBe(result.dispatchId)
  })

  it('ignores user-originated worker turns that carry no dispatch', async () => {
    const { runtime, result } = await createAndDeliver()
    const workerThread = createThreadRecord({
      id: result.workerId!,
      title: 'worker',
      workspace: '/repo/.worktrees/fix-login',
      model: 'model-x',
      relation: 'side',
      parentThreadId: 'thr_mgr',
      executionUnit: {
        kind: 'worker', teamId: 'thr_mgr', managerThreadId: 'thr_mgr',
        label: 'fixer', lifecycle: 'persistent', control: 'manager'
      }
    })
    workerThread.turns = [
      turnRecord({ id: 'turn_manual', threadId: result.workerId!, status: 'completed' })
    ]
    await threads.upsert(workerThread)
    await runtime.handleWorkerTurnTerminal(result.workerId!, 'turn_manual', 'completed')
    expect((await dispatches.get('thr_mgr', result.dispatchId!))?.state).toBe('accepted')
    expect(await notices.pending('thr_mgr')).toHaveLength(0)
  })

  it('backfills turnId on turn_started via the event observer', async () => {
    const { runtime, result } = await createAndDeliver()
    const workerId = result.workerId!
    const workerThread = createThreadRecord({
      id: workerId,
      title: 'worker',
      workspace: '/repo/.worktrees/fix-login',
      model: 'model-x',
      relation: 'side',
      parentThreadId: 'thr_mgr',
      executionUnit: {
        kind: 'worker', teamId: 'thr_mgr', managerThreadId: 'thr_mgr',
        label: 'fixer', lifecycle: 'persistent', control: 'manager'
      }
    })
    workerThread.turns = [
      turnRecord({ id: 'turn_w1', threadId: workerId, status: 'running', clientRequestId: result.dispatchId })
    ]
    await threads.upsert(workerThread)
    // The delegate is sync fire-and-forget; drive the async backfill directly.
    await (runtime as unknown as {
      lifecycle: { backfillDispatchTurnId(t: string, id: string): Promise<void> }
    }).lifecycle.backfillDispatchTurnId(workerId, 'turn_w1')
    expect((await dispatches.get('thr_mgr', result.dispatchId!))?.turnId).toBe('turn_w1')
  })

  it('reconcileOnStartup replays terminal handling for already-finished turns', async () => {
    const { runtime, result } = await createAndDeliver()
    const workerId = result.workerId!
    // Simulate crash: turn completed while the host was down, dispatch still
    // `accepted` without the terminal write.
    const workerThread = createThreadRecord({
      id: workerId,
      title: 'worker',
      workspace: '/repo/.worktrees/fix-login',
      model: 'model-x',
      relation: 'side',
      parentThreadId: 'thr_mgr',
      executionUnit: {
        kind: 'worker', teamId: 'thr_mgr', managerThreadId: 'thr_mgr',
        label: 'fixer', lifecycle: 'persistent', control: 'manager'
      }
    })
    workerThread.turns = [
      turnRecord({ id: 'turn_w1', threadId: workerId, status: 'completed', clientRequestId: result.dispatchId })
    ]
    await threads.upsert(workerThread)
    await runtime.reconcileOnStartup()
    const dispatch = await dispatches.get('thr_mgr', result.dispatchId!)
    expect(dispatch?.state).toBe('completed')
    expect(await notices.pending('thr_mgr')).toHaveLength(1)
  })
})
