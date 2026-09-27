import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { vi } from 'vitest'
import type { DispatchRecord, WorkerRecord } from '../contracts/ade.js'
import type { ThreadRecord } from '../contracts/threads.js'
import type { TaskWorkspaceRecord } from '../contracts/task-workspace.js'
import type { Turn } from '../contracts/turns.js'
import type { ChildRunRecord } from '../delegation/delegation-runtime-contracts.js'
import type { ApprovalActionEnvelope } from '../contracts/approvals.js'
import { FileDelegationStore } from '../delegation/delegation-runtime-contracts.js'
import { InMemoryThreadStore } from '../adapters/in-memory-thread-store.js'
import { InMemoryApprovalGate } from '../adapters/in-memory-approval-gate.js'
import { createApprovalRequest } from '../domain/approval.js'
import { createThreadRecord } from '../domain/thread.js'
import { BUILTIN_HARNESSES } from '../harness/builtin-harnesses.js'
import { FileDispatchStore } from './dispatch-store.js'
import { FileTeamStore } from './team-store.js'
import { FileQuestionStore } from './question-store.js'
import { FileWorkerNoticeStore } from './worker-notice-store.js'
import { DispatchDeliverer, type DelivererDelegation } from './dispatch-deliverer.js'
import { ManagerControls } from './manager-controls.js'
import { TeamControls } from './team-controls.js'
import { ManagerWorkerLifecycle } from './manager-worker-lifecycle.js'
import { QualityVerdicts } from './quality-verdict.js'
import { ReviewRequests } from './review-request.js'
import type { ManagerRuntimeDeps, ManagerToolContext } from './manager-runtime.js'

/** Shared fixtures for the P1-14 control-plane suites (09 §4.1/§9/§6.5). */

export const NOW = '2026-09-26T00:00:00.000Z'

export type AdeStores = {
  dataDir: string
  teams: FileTeamStore
  dispatches: FileDispatchStore
  questions: FileQuestionStore
  notices: FileWorkerNoticeStore
  childRuns: FileDelegationStore
  threads: InMemoryThreadStore
}

export async function setupAdeStores(limits?: { hardWorkers?: number }): Promise<AdeStores> {
  const dataDir = await mkdtemp(join(tmpdir(), 'kun-ade-controls-'))
  const stores: AdeStores = {
    dataDir,
    teams: new FileTeamStore(dataDir, () => NOW),
    dispatches: new FileDispatchStore(dataDir, () => NOW),
    questions: new FileQuestionStore(dataDir, () => NOW),
    notices: new FileWorkerNoticeStore(dataDir, () => NOW),
    childRuns: new FileDelegationStore(join(dataDir, 'child-runs')),
    threads: new InMemoryThreadStore()
  }
  await stores.teams.ensure('thr_mgr', limits)
  return stores
}

export async function teardownAdeStores(stores: AdeStores): Promise<void> {
  await rm(stores.dataDir, { recursive: true, force: true })
}

export function managerCtx(overrides: Partial<ManagerToolContext> = {}): ManagerToolContext {
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

export function workerRecord(overrides: Partial<WorkerRecord> = {}): WorkerRecord {
  return {
    workerId: 'wrk_1',
    label: 'fixer',
    route: { harnessId: 'kun', model: 'model-x', credentialMode: 'provider' },
    permissionMode: 'default',
    lifecycle: 'persistent',
    taskWorkspaceId: 'tws_1',
    securitySnapshot: {
      sandboxRoot: '/repo/.worktrees/fix-login',
      allowedWritePaths: ['/repo/.worktrees/fix-login'],
      memoryEnabled: false
    },
    control: 'manager',
    state: 'active',
    createdAt: NOW,
    ...overrides
  }
}

export function workerThread(overrides: Partial<ThreadRecord> = {}): ThreadRecord {
  return createThreadRecord({
    id: 'wrk_1',
    title: 'fixer',
    workspace: '/repo/.worktrees/fix-login',
    model: 'model-x',
    providerId: 'prov-1',
    executionUnit: {
      kind: 'worker',
      teamId: 'thr_mgr',
      managerThreadId: 'thr_mgr',
      label: 'fixer',
      lifecycle: 'persistent',
      control: 'manager'
    },
    ...overrides
  })
}

export function turnRecord(overrides: Partial<Turn> = {}): Turn {
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

function workspaceRecord(): TaskWorkspaceRecord {
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
    state: 'ready',
    setup: { status: 'skipped', steps: [] },
    changedFiles: [],
    createdAt: NOW,
    updatedAt: NOW
  } as TaskWorkspaceRecord
}

export const INTERVAL_STAT = { changedFiles: 2, insertions: 9, deletions: 4 }

export function fileAction(
  path: string,
  extra: Partial<ApprovalActionEnvelope> = {}
): ApprovalActionEnvelope {
  return {
    version: 1,
    kind: 'file',
    toolName: 'write_file',
    effects: { network: false, externalWrite: false, processExecution: false, guiAutomation: false },
    arguments: { path },
    workspace: '/repo/.worktrees/fix-login',
    cwd: '/repo/.worktrees/fix-login',
    targets: [{ kind: 'file', value: path }],
    reason: 'worker wants to write',
    ...extra
  }
}

export function commandAction(): ApprovalActionEnvelope {
  return {
    version: 1,
    kind: 'command',
    toolName: 'run_command',
    effects: { network: false, externalWrite: false, processExecution: true, guiAutomation: false },
    arguments: { command: 'rm -rf x' },
    workspace: '/repo/.worktrees/fix-login',
    targets: [{ kind: 'command', value: 'rm -rf x' }],
    reason: 'worker wants a shell command'
  }
}

export function childRun(overrides: Partial<ChildRunRecord> = {}): ChildRunRecord {
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

export function makeHarness(stores: AdeStores, opts: {
  workspaceStat?: { changedFiles: number; insertions: number; deletions: number }
  mayApprove?: boolean
  /** Worker-selector inputs for review_request/worker_create tests (10 §5). */
  selector?: ManagerRuntimeDeps['selector']
  /** Harness defs the catalog lists (default: all builtins). */
  harnesses?: typeof BUILTIN_HARNESSES[number][]
  capabilities?: unknown
  statusFor?: (harnessId: string) => unknown
  reviewSnapshot?: unknown
} = {}) {
  const gate = new InMemoryApprovalGate()
  const recorded: unknown[] = []
  const delegation: DelivererDelegation = {
    runChild: vi.fn(async (input: { childId?: string }) =>
      childRun({ id: input.childId ?? 'wrk_1' })),
    resumeChild: vi.fn(async (input: { childId: string }) =>
      childRun({ id: input.childId, resumeCount: 1 })),
    abortChild: vi.fn(() => false)
  }
  const interruptTurn = vi.fn(async () => ({ status: 'aborted' as const }))
  const workspace = workspaceRecord()
  const taskWorkspaces = {
    get: vi.fn(() => workspace),
    list: vi.fn(() => [workspace]),
    integrate: vi.fn(async () => ({ outcome: 'applied' as const, record: workspace })),
    captureForDispatch: vi.fn(async () => ({
      record: workspace,
      stat: opts.workspaceStat ?? { changedFiles: 0, insertions: 0, deletions: 0 }
    })),
    discard: vi.fn(async () => workspace),
    snapshotBaseline: vi.fn(async () => 'tree_base1'),
    diffSinceBaseline: vi.fn(async () => INTERVAL_STAT),
    reviewSnapshot: vi.fn(async () => opts.reviewSnapshot)
  }
  const answerQuestion = vi.fn(async (input: {
    teamId: string
    questionId: string
    answer: string
    answeredBy: 'manager' | 'user'
  }) => stores.questions.update(input.teamId, input.questionId, {
    state: 'answered',
    answer: input.answer,
    answeredBy: input.answeredBy
  }))
  const activity = { register: vi.fn(), apply: vi.fn(), get: vi.fn(() => undefined) }
  const deliverer = new DispatchDeliverer({
    teams: stores.teams,
    dispatches: stores.dispatches,
    taskWorkspaces: taskWorkspaces as never,
    delegation,
    childRuns: stores.childRuns,
    threads: stores.threads,
    turns: { interruptTurn: interruptTurn as never } as never,
    language: () => 'en'
  })
  const deps: ManagerRuntimeDeps = {
    teams: stores.teams,
    dispatches: stores.dispatches,
    questions: stores.questions,
    notices: stores.notices,
    threads: stores.threads,
    turns: { getTurn: vi.fn(async () => null) } as never,
    sessionStore: { loadItems: vi.fn(async () => []) } as never,
    taskWorkspaces: taskWorkspaces as never,
    activity: activity as never,
    delegation,
    childRuns: stores.childRuns,
    catalog: {
      get: (id: string) => (opts.harnesses ?? BUILTIN_HARNESSES).find((def) => def.id === id),
      list: () => opts.harnesses ?? BUILTIN_HARNESSES,
      isDisabled: () => false
    } as never,
    detector: { status: vi.fn(async (id: string) => opts.statusFor?.(id) ?? null) } as never,
    capabilitiesForRoute: async () => (opts.capabilities ?? {}) as never,
    deliverer,
    ids: (() => { let seq = 0; return { next: (p: string) => `${p}_${(seq += 1)}` } })(),
    nowIso: () => NOW,
    language: () => 'en',
    workerCallbacks: { answerQuestion },
    approvalGate: gate,
    approvalEvents: { record: vi.fn(async (draft: unknown) => { recorded.push(draft) }) } as never,
    managerMayApprove: () => opts.mayApprove === true,
    ...(opts.selector ? { selector: opts.selector } : {})
  }
  const controls = new ManagerControls(deps)
  const teamControls = new TeamControls(deps, controls)
  const verdicts = new QualityVerdicts(deps)
  return {
    controls,
    teamControls,
    verdicts,
    reviews: new ReviewRequests(deps),
    lifecycle: new ManagerWorkerLifecycle(deps, teamControls, verdicts),
    gate,
    recorded,
    delegation,
    interruptTurn,
    taskWorkspaces,
    answerQuestion,
    activity,
    deps
  }
}

export async function seedWorker(
  stores: AdeStores,
  overrides: Partial<WorkerRecord> = {}
): Promise<WorkerRecord> {
  const worker = workerRecord(overrides)
  await stores.teams.upsertWorker('thr_mgr', worker)
  await stores.threads.upsert(workerThread())
  return worker
}

export async function busyWorker(stores: AdeStores): Promise<WorkerRecord> {
  const worker = await seedWorker(stores)
  await stores.threads.upsert({ ...workerThread(), turns: [turnRecord({ status: 'running' })] })
  return worker
}

export function seedDispatch(stores: AdeStores, overrides: Partial<DispatchRecord> = {}) {
  return stores.dispatches.create({
    dispatchId: 'dsp_held',
    teamId: 'thr_mgr',
    workerId: 'wrk_1',
    parentTurnId: 'turn_mgr_1',
    title: 'held',
    task: 'held work',
    mode: 'queue',
    state: 'pending',
    createdAt: NOW,
    updatedAt: NOW,
    ...overrides
  })
}

export function pendingApproval(
  gate: InMemoryApprovalGate,
  id: string,
  action?: ApprovalActionEnvelope,
  workerId = 'wrk_1'
): void {
  const approval = createApprovalRequest({
    id, threadId: workerId, turnId: 'turn_w1', toolName: action?.toolName ?? 'write_file', summary: 'x'
  })
  void gate.request({ ...approval, ...(action ? { action } : {}) })
}
