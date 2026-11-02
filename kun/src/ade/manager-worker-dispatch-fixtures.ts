import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, vi } from 'vitest'
import { InMemoryThreadStore } from '../adapters/in-memory-thread-store.js'
import { createThreadRecord } from '../domain/thread.js'
import { kunToolPermissionModeSettings, type KunToolPermissionMode } from '../contracts/policy.js'
import type { ToolHostContext } from '../ports/tool-host.js'
import { KUN_NATIVE_CAPABILITIES, BUILTIN_HARNESSES } from '../harness/builtin-harnesses.js'
import { FileDelegationStore } from '../delegation/delegation-runtime-contracts.js'
import { FileAgentDispatchIntentStore } from '../delegation/agent-dispatch-intent-store.js'
import { AgentDispatchService } from '../delegation/agent-dispatch-service.js'
import { FileTeamStore } from './team-store.js'
import { FileDispatchStore } from './dispatch-store.js'
import { FileQuestionStore } from './question-store.js'
import { FileWorkerNoticeStore } from './worker-notice-store.js'
import { DispatchDeliverer } from './dispatch-deliverer.js'
import { ManagerRuntime } from './manager-runtime.js'
import { childRunRecord, turnRecord, workspaceRecord } from './manager-runtime-fixtures.js'

const cleanup: Array<() => Promise<void>> = []
afterEach(async () => { for (const close of cleanup.splice(0)) await close() })

export async function setup(mode: KunToolPermissionMode, rootHarness = 'kun', hardWorkers = 8,
  harnessDefaults?: import('./manager-runtime-deps.js').ManagerRuntimeDeps['harnessDefaults'],
  roster?: import('./manager-runtime-deps.js').ManagerRuntimeDeps['roster'], withoutTaskWorkspaces = false) {
  const root = await mkdtemp(join(tmpdir(), 'kun-worker-dispatch-'))
  const clock = { now: Date.parse('2026-10-07T00:00:00.000Z') }
  const nowIso = () => new Date(clock.now).toISOString()
  const policy = kunToolPermissionModeSettings(mode)
  const threads = new InMemoryThreadStore()
  const source = createThreadRecord({ id: 'parent', workspace: '/repo', title: 'Parent',
    model: 'main-model', providerId: 'test', harnessId: rootHarness,
    collaboration: { enabled: true }, ...policy })
  source.turns = [turnRecord({ id: 'source-turn', threadId: 'parent', status: 'completed',
    model: 'main-model', harnessId: rootHarness, clientSurface: 'gui', ...policy })]
  await threads.upsert(source)
  const teams = new FileTeamStore(root, nowIso)
  const dispatches = new FileDispatchStore(root, nowIso)
  const childRuns = new FileDelegationStore(join(root, 'children'))
  const workspace = workspaceRecord('ready')
  const taskWorkspaces = { create: vi.fn(async () => workspace), get: () => workspace,
    onChange: () => () => undefined, bindUnit: vi.fn(), snapshotBaseline: vi.fn(async () => 'baseline'),
    captureForDispatch: vi.fn(async () => ({ record: workspace, stat: { changedFiles: 0, insertions: 0, deletions: 0 } })) }
  const runChild = vi.fn(async (input: { childId?: string }) => {
    const record = childRunRecord({ id: input.childId!, parentThreadId: 'parent', parentTurnId: 'source-turn' })
    await childRuns.upsert(record); return record
  })
  const delegation = { runChild, resumeChild: vi.fn(), abortChild: vi.fn(() => false) }
  const notices = new FileWorkerNoticeStore(root, nowIso)
  let sink: import('./worker-notice-store.js').WorkerNoticeSink = notices
  const noticeSink = { enqueue: (notice: import('../contracts/ade.js').WorkerNotice) => sink.enqueue(notice) }
  const delivererDeps = { teams, dispatches, threads, childRuns, notices: noticeSink,
    taskWorkspaces: taskWorkspaces as never, delegation, turns: { interruptTurn: vi.fn() } as never }
  const deliverer = new DispatchDeliverer(delivererDeps)
  const disabled = new Set<string>()
  const store = new FileAgentDispatchIntentStore(root)
  const service = new AgentDispatchService({ store,
    applicationSessionId: 'app', now: () => clock.now,
    review: async () => ({ decision: 'allow', reason: 'The assignment matches the user request.' }) })
  cleanup.push(async () => { await service.stop(); await rm(root, { recursive: true, force: true }) })
  const capabilitiesForRoute = vi.fn<import('./manager-runtime-deps.js').ManagerRuntimeDeps['capabilitiesForRoute']>(
    async () => KUN_NATIVE_CAPABILITIES)
  const locale = { value: 'en' }
  const runtimeDeps: import('./manager-runtime-deps.js').ManagerRuntimeDeps = {
    language: () => locale.value,
    agentDispatchService: service, teams, dispatches, childRuns, threads,
    questions: new FileQuestionStore(root, nowIso), notices: noticeSink,
    turns: { getTurn: async (id: string, turnId: string) => (await threads.get(id))?.turns.find((entry) => entry.id === turnId) ?? null } as never,
    sessionStore: { loadItems: async () => [] } as never,
    catalog: { get: (id: string) => { const base = BUILTIN_HARNESSES.find((entry) => entry.id === id)
      return base ? { ...base, staticModels: id === 'kun' ? [] : ['main-model', 'other-model'] } : undefined },
      list: () => BUILTIN_HARNESSES, isDisabled: (id: string) => disabled.has(id),
      isProfileEnabled: (route: { harnessId: string }) => !disabled.has(route.harnessId) } as never,
    detector: { status: async (harnessId: string) => ({ harnessId, installed: 'yes', login: 'signed-in', checkedAt: nowIso() }) } as never,
    capabilitiesForRoute,
    taskWorkspaces: withoutTaskWorkspaces ? undefined : taskWorkspaces as never, delegation, deliverer, nowIso,
    ids: { next: (prefix) => `${prefix}_unused` }, teamLimits: () => ({ hardWorkers, softWorkers: Math.min(4, hardWorkers) }),
    harnessDefaults, ...(roster ? { roster } : {}),
    providerPool: async () => ({ models: ['main-model', 'other-model'] }), allowUnattendedFullAccess: () => true
  }
  const runtime = new ManagerRuntime(runtimeDeps)
  await service.start()
  const context: ToolHostContext = { threadId: source.id, turnId: 'source-turn', workspace: '/repo', ...policy,
    activeToolCallId: 'worker-call', actingModelRoute: { model: 'main-model', providerId: 'test' },
    approvalIntent: 'Implement an independent task.', abortSignal: new AbortController().signal,
    awaitApproval: async () => 'deny', allowedWritePaths: ['src'] }
  const ctx = await runtime.toolContext({ threadId: source.id, turnId: 'source-turn', workspace: '/repo',
    signal: context.abortSignal, awaitApproval: context.awaitApproval })
  const assignment = { label: 'Independent task', task: 'Implement a bounded change and verify it.',
    context: { constraints: ['Existing behavior remains correct.'] }, workspace: { isolation: 'worktree' as const } }
  return { runtimeDeps, delivererDeps, wireNotices: (next: typeof sink) => { sink = next }, locale, root, notices, source, clock, context, ctx, runtime, service, teams, dispatches, childRuns,
    runChild, taskWorkspaces, disabled, threads, assignment, workspace, deliverer, capabilitiesForRoute, store }
}

export async function startNow(fixture: Awaited<ReturnType<typeof setup>>, id: string) {
  const intent = (await fixture.service.get(id))!
  await fixture.service.act(id, { action: 'start_now', requestId: 'start', expectedRevision: intent.revision })
  await fixture.service.reconcile()
}
