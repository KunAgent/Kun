import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
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
import { shouldAdvertiseManagerTools } from '../domain/manager-tools.js'

const cleanup: Array<() => Promise<void>> = []
afterEach(async () => { for (const close of cleanup.splice(0)) await close() })

async function setup(mode: KunToolPermissionMode, rootHarness = 'kun', hardWorkers = 8,
  harnessDefaults?: import('./manager-runtime-deps.js').ManagerRuntimeDeps['harnessDefaults']) {
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
  const deliverer = new DispatchDeliverer({ teams, dispatches, threads, childRuns,
    taskWorkspaces: taskWorkspaces as never, delegation, turns: { interruptTurn: vi.fn() } as never })
  const disabled = new Set<string>()
  const service = new AgentDispatchService({ store: new FileAgentDispatchIntentStore(root),
    applicationSessionId: 'app', now: () => clock.now,
    review: async () => ({ decision: 'allow', reason: 'The assignment matches the user request.' }) })
  cleanup.push(async () => { await service.stop(); await rm(root, { recursive: true, force: true }) })
  const runtime = new ManagerRuntime({
    agentDispatchService: service, teams, dispatches, childRuns, threads,
    questions: new FileQuestionStore(root, nowIso), notices: new FileWorkerNoticeStore(root, nowIso),
    turns: { getTurn: async (id: string, turnId: string) => (await threads.get(id))?.turns.find((entry) => entry.id === turnId) ?? null } as never,
    sessionStore: { loadItems: async () => [] } as never,
    catalog: { get: (id: string) => { const base = BUILTIN_HARNESSES.find((entry) => entry.id === id)
      return base ? { ...base, staticModels: id === 'kun' ? [] : ['main-model', 'other-model'] } : undefined },
      list: () => BUILTIN_HARNESSES, isDisabled: (id: string) => disabled.has(id),
      isProfileEnabled: (route: { harnessId: string }) => !disabled.has(route.harnessId) } as never,
    detector: { status: async (harnessId: string) => ({ harnessId, installed: 'yes', login: 'signed-in', checkedAt: nowIso() }) } as never,
    capabilitiesForRoute: async () => KUN_NATIVE_CAPABILITIES,
    taskWorkspaces: taskWorkspaces as never, delegation, deliverer, nowIso,
    ids: { next: (prefix) => `${prefix}_unused` }, teamLimits: () => ({ hardWorkers, softWorkers: Math.min(4, hardWorkers) }),
    harnessDefaults,
    providerPool: async () => ({ models: ['main-model', 'other-model'] }), allowUnattendedFullAccess: () => true
  })
  await service.start()
  const context: ToolHostContext = { threadId: source.id, turnId: 'source-turn', workspace: '/repo', ...policy,
    activeToolCallId: 'worker-call', actingModelRoute: { model: 'main-model', providerId: 'test' },
    approvalIntent: 'Implement an independent task.', abortSignal: new AbortController().signal,
    awaitApproval: async () => 'deny', allowedWritePaths: ['src'] }
  const ctx = await runtime.toolContext({ threadId: source.id, turnId: 'source-turn', workspace: '/repo',
    signal: context.abortSignal, awaitApproval: context.awaitApproval })
  const assignment = { label: 'Independent task', task: 'Implement a bounded change and verify it.',
    context: { constraints: ['Existing behavior remains correct.'] }, workspace: { isolation: 'worktree' as const } }
  return { source, clock, context, ctx, runtime, service, teams, dispatches, childRuns,
    runChild, taskWorkspaces, disabled, threads, assignment, workspace }
}

async function startNow(fixture: Awaited<ReturnType<typeof setup>>, id: string) {
  const intent = (await fixture.service.get(id))!
  await fixture.service.act(id, { action: 'start_now', requestId: 'start', expectedRevision: intent.revision })
  await fixture.service.reconcile()
}

describe('Code dispatch start decisions', { timeout: 30_000 }, () => {
  it.each(['ask-for-approval', 'approve-for-me', 'full-access'] as const)('uses source %s and deterministic child admission', async (mode) => {
    const f = await setup(mode)
    const result = await f.runtime.createWorker(f.ctx, f.assignment, f.context)
    expect(result.ok).toBe(true)
    expect(result.dispatchIntent).toMatchObject({ recommendation: { permissionMode: mode }, source: { toolCallId: 'worker-call' } })
    if (mode !== 'approve-for-me') {
      expect(f.runChild).not.toHaveBeenCalled(); expect(f.taskWorkspaces.create).not.toHaveBeenCalled()
    }
    if (mode === 'ask-for-approval') await startNow(f, result.dispatchIntentId!)
    if (mode === 'full-access') {
      f.clock.now += 59_000; await f.service.reconcile(); expect(f.runChild).not.toHaveBeenCalled()
      f.clock.now += 1_000
    }
    await f.service.reconcile(); await vi.waitFor(() => expect(f.runChild).toHaveBeenCalledTimes(1))
    expect(f.runChild.mock.calls[0][0]).toMatchObject({ ...kunToolPermissionModeSettings(mode),
      security: { allowedWritePaths: ['/repo/.worktrees/fix-login/src'] } })
    expect((await f.runtime.createWorker(f.ctx, f.assignment, f.context)).dispatchIntentId).toBe(result.dispatchIntentId)
    await f.service.reconcile(); expect(f.runChild).toHaveBeenCalledTimes(1)
  })

  it.each([['kun', 'claude-code'], ['claude-code', 'kun'], ['claude-code', 'codex']])('allows %s to dispatch %s', async (parent, worker) => {
    const f = await setup('ask-for-approval', parent)
    const result = await f.runtime.createWorker(f.ctx, { ...f.assignment,
      agent: { harnessId: worker, model: 'main-model', credentialMode: worker === 'kun' ? 'provider' : 'native-login' }
    }, f.context)
    expect(result.ok).toBe(true); expect(result.dispatchIntent?.recommendation.agentSelection).toBe('auto')
    await startNow(f, result.dispatchIntentId!)
    expect(f.runChild.mock.calls[0][0]).toMatchObject({ harnessId: worker })
  })

  it('starts a batch with one intervention window', async () => {
    const f = await setup('full-access')
    const result = await f.runtime.createWorkerBatch(f.ctx, { items: [f.assignment, { ...f.assignment, label: 'Second' }] }, f.context)
    expect(result.dispatchIntentId).toBeTruthy(); expect(await f.service.list('parent')).toHaveLength(1)
    expect(f.taskWorkspaces.create).not.toHaveBeenCalled()
    f.clock.now += 60_000; await f.service.reconcile(); expect(f.runChild).toHaveBeenCalledTimes(2)
  })

  it('applies edits after pausing and gives a fresh 60-second window', async () => {
    const f = await setup('full-access')
    const result = await f.runtime.createWorker(f.ctx, f.assignment, f.context)
    const paused = await f.service.act(result.dispatchIntentId!, { action: 'pause', requestId: 'pause', expectedRevision: 1 })
    f.clock.now += 70_000; await f.service.reconcile(); expect(f.runChild).not.toHaveBeenCalled()
    await f.service.act(paused.intentId, { action: 'update', requestId: 'edit', expectedRevision: paused.revision,
      recommendation: { title: 'Revised task', task: 'Perform the revised task.' } })
    f.clock.now += 60_000; await f.service.reconcile()
    expect(f.runChild.mock.calls[0][0]).toMatchObject({ prompt: expect.stringContaining('Perform the revised task.') })
  })

  it('revalidates disabled profiles before workspace creation', async () => {
    const f = await setup('full-access'); const result = await f.runtime.createWorker(f.ctx, f.assignment, f.context)
    f.disabled.add('kun'); f.clock.now += 60_000; await f.service.reconcile()
    expect(await f.service.get(result.dispatchIntentId!)).toMatchObject({ state: 'failed' })
    expect(f.runChild).not.toHaveBeenCalled(); expect(f.taskWorkspaces.create).not.toHaveBeenCalled()
  })

  it('narrows changed permissions and rejects recursive teams', async () => {
    const f = await setup('full-access'); const result = await f.runtime.createWorker(f.ctx, f.assignment, f.context)
    await f.threads.upsert({ ...f.source, ...kunToolPermissionModeSettings('approve-for-me') })
    f.clock.now += 60_000; await f.service.reconcile()
    expect(f.runChild.mock.calls[0][0]).toMatchObject(kunToolPermissionModeSettings('approve-for-me'))
    await f.threads.upsert({ ...f.source, parentThreadId: 'other', relation: 'side' })
    expect(await f.runtime.createWorker(f.ctx, f.assignment, { ...f.context, activeToolCallId: 'nested' }))
      .toMatchObject({ ok: false, refusal: 'collaboration_disabled' })
    expect(shouldAdvertiseManagerTools({ collaborationEnabled: true, harnessId: 'codex', managerToolBridgeAvailable: false })).toBe(false)
    expect(shouldAdvertiseManagerTools({ collaborationEnabled: true, harnessId: 'codex', managerToolBridgeAvailable: true })).toBe(true)
    expect(shouldAdvertiseManagerTools({ collaborationEnabled: true, harnessId: 'codex', managerToolBridgeAvailable: true, executionUnitKind: 'worker' })).toBe(false)
  })

  it('reports batch limit refusal and skipped entries instead of hanging in startup', async () => {
    const f = await setup('full-access', 'kun', 1)
    const result = await f.runtime.createWorkerBatch(f.ctx, { items: [f.assignment,
      { ...f.assignment, label: 'Second' }, { ...f.assignment, label: 'Third' }] }, f.context)
    f.clock.now += 60_000; await f.service.reconcile(); await f.service.reconcile()
    expect(f.runChild).toHaveBeenCalledTimes(1)
    expect(await f.service.get(result.dispatchIntentId!)).toMatchObject({ state: 'running', error: expect.stringContaining('limit') })
    const dispatches = await f.dispatches.list('parent')
    expect(dispatches.filter((entry) => entry.state === 'failed')).toHaveLength(2)
    expect(dispatches.find((entry) => entry.title === 'Third')?.failureReason).toContain('Skipped')
    const admitted = dispatches.find((entry) => entry.state === 'accepted')!
    await f.dispatches.update('parent', admitted.dispatchId, { state: 'completed' })
    await f.service.reconcile()
    expect(await f.service.get(result.dispatchIntentId!)).toMatchObject({ state: 'failed' })
  })

  it('replaces an automatically selected failed worker once after inspecting its checkout', async () => {
    const f = await setup('full-access')
    const result = await f.runtime.createWorker(f.ctx, f.assignment, f.context)
    f.clock.now += 60_000; await f.service.reconcile()
    const original = (await f.teams.get('parent'))!.workers[0]
    await f.teams.upsertWorker('parent', { ...original, selection: { reason: 'Automatic choice', score: 1,
      alternatives: [{ route: { harnessId: 'codex', model: 'main-model', credentialMode: 'native-login' }, label: 'Codex', score: 0.9 }] } })
    const dispatch = (await f.dispatches.list('parent'))[0]
    await f.dispatches.update('parent', dispatch.dispatchId, { state: 'failed', failureReason: 'Worker unavailable' })
    await f.childRuns.upsert({ ...(await f.childRuns.get(original.workerId))!, status: 'failed' })
    await f.service.reconcile()
    expect(await f.service.get(result.dispatchIntentId!)).toMatchObject({ state: 'countdown', replacementCount: 1,
      recommendation: { agentId: 'codex' }, previousTarget: { workerIds: [original.workerId] } })
    expect(f.taskWorkspaces.captureForDispatch).toHaveBeenCalledTimes(1)
    f.clock.now += 60_000; await f.service.reconcile()
    expect(f.runChild).toHaveBeenCalledTimes(2)
    expect(f.runChild.mock.calls[1][0]).toMatchObject({ harnessId: 'codex' })
    expect(f.runChild.mock.calls[1][0].childId).not.toBe(original.workerId)
  })

  it('keeps a user-pinned Agent fixed on failure', async () => {
    const f = await setup('full-access')
    const result = await f.runtime.createWorker(f.ctx, { ...f.assignment, agentSelection: 'user' }, f.context)
    f.clock.now += 60_000; await f.service.reconcile()
    const dispatch = (await f.dispatches.list('parent'))[0]
    await f.dispatches.update('parent', dispatch.dispatchId, { state: 'failed', failureReason: 'Pinned Agent failed' })
    await f.service.reconcile()
    expect(await f.service.get(result.dispatchIntentId!)).toMatchObject({ state: 'failed', replacementCount: 0 })
    expect(f.taskWorkspaces.captureForDispatch).not.toHaveBeenCalled()
  })


  it('cancels pending work when its source turn is stopped', async () => {
    const f = await setup('full-access')
    const result = await f.runtime.createWorker(f.ctx, f.assignment, f.context)
    await f.threads.upsert({ ...f.source, turns: [{ ...f.source.turns[0], status: 'aborted' }] })
    f.runtime.handleRuntimeEvent({ kind: 'turn_aborted', threadId: 'parent', turnId: 'source-turn' } as never)
    await vi.waitFor(async () => expect(await f.service.get(result.dispatchIntentId!)).toMatchObject({ state: 'cancelled' }))
    f.clock.now += 60_000; await f.service.reconcile()
    expect(f.runChild).not.toHaveBeenCalled(); expect(f.taskWorkspaces.create).not.toHaveBeenCalled()
  })

  it('transfers actual worker control on takeover and leaves running work accurately marked', async () => {
    const f = await setup('full-access')
    const result = await f.runtime.createWorker(f.ctx, f.assignment, f.context)
    f.clock.now += 60_000; await f.service.reconcile()
    const intent = (await f.service.get(result.dispatchIntentId!))!
    const workerId = intent.target!.workerIds![0]
    await f.service.act(intent.intentId, { action: 'takeover', requestId: 'takeover', expectedRevision: intent.revision })
    await f.service.reconcile()
    expect(await f.teams.worker('parent', workerId)).toMatchObject({ control: 'user' })
    expect(await f.service.get(intent.intentId)).toMatchObject({ state: 'running', takenOver: true, cancellationRequested: false })
  })

  it('recovers a partially admitted batch without duplicating its existing worker', async () => {
    const f = await setup('full-access')
    const result = await f.runtime.createWorkerBatch(f.ctx, { items: [f.assignment, { ...f.assignment, label: 'Second' }] }, f.context)
    f.taskWorkspaces.create.mockResolvedValueOnce(workspaceRecord('ready')).mockRejectedValueOnce(new Error('Runtime interrupted during workspace setup'))
    f.clock.now += 60_000; await f.service.reconcile()
    expect(f.runChild).toHaveBeenCalledTimes(1)
    await f.service.reconcile(); await f.service.reconcile()
    expect(f.runChild).toHaveBeenCalledTimes(2)
    expect(await f.service.get(result.dispatchIntentId!)).toMatchObject({ state: 'running' })
  })


  it('freezes lower native permission and local isolation defaults for a pinned Agent', async () => {
    const defaults = { permissionMode: 'default', isolation: 'local' as 'local' | 'worktree' }
    const f = await setup('full-access', 'kun', 8, (id) => id === 'claude-code' ? defaults : undefined)
    f.workspace.isolation = 'local'
    f.workspace.path = '/repo'
    const { workspace: _workspace, ...assignment } = f.assignment
    const result = await f.runtime.createWorker(f.ctx, { ...assignment,
      agent: { harnessId: 'claude-code', model: 'main-model', credentialMode: 'native-login' }
    }, f.context)
    expect(result.ok).toBe(true)
    const intent = (await f.service.get(result.dispatchIntentId!))!
    expect(intent).toMatchObject({ state: 'countdown', recommendation: {
      permissionMode: 'full-access', effectivePermissionMode: 'ask-for-approval'
    }, payload: { items: [{ input: { permissionMode: 'default', workspace: { isolation: 'local' } } }] } })
    expect(f.taskWorkspaces.create).not.toHaveBeenCalled()
    // Later native defaults cannot alter the concrete recommendation accepted by the card.
    defaults.permissionMode = 'bypassPermissions'
    defaults.isolation = 'worktree'
    f.clock.now += 60_000; await f.service.reconcile()
    expect(f.taskWorkspaces.create).toHaveBeenCalledWith(expect.objectContaining({ isolation: 'local' }), expect.anything())
    expect(f.runChild).toHaveBeenCalledTimes(1)
    expect(f.runChild.mock.calls[0][0]).toMatchObject(kunToolPermissionModeSettings('ask-for-approval'))
    expect((await f.teams.get('parent'))!.workers[0]).toMatchObject({ permissionMode: 'default' })
  })

})
