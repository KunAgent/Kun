import { afterEach, describe, expect, it, vi } from 'vitest'
import type { HarnessStatus } from '../contracts/harness.js'
import { ModelConnectionSnapshotSchema } from '../contracts/model-connections.js'
import type { WorkbenchLink, WorkbenchRequest } from '../contracts/workbench-links.js'
import { allSupportedStatuses } from '../contracts/harness-capabilities.js'
import { HarnessCatalog } from '../harness/harness-catalog.js'
import type { HarnessDetector } from '../harness/harness-detector.js'
import { HarnessRouter, HarnessRuntimeMap } from '../harness/harness-router.js'
import type { DelegatedTurnRuntime } from '../runtime/delegated-turn-runtime.js'
import { WorkbenchHarnessService } from './harnesses.js'
import { workbenchFixture, type WorkbenchFixture } from './workbench-test-support.js'
import { confirmWorkbenchLink, requestWorkbenchCancel } from './actions.js'
import { validateExecution } from './execution.js'
import { outcomePrompt, reconcileWorkbench } from './reconcile.js'

const open: WorkbenchFixture[] = []
afterEach(async () => { for (const f of open.splice(0)) await f.cleanup() })

function harnessFixture(probeModels?: (definition: import('../contracts/harness.js').HarnessDefinition) => Promise<string[]>) {
  const disabled: string[] = []
  const catalog = new HarnessCatalog({ custom: () => [], disabled: () => disabled })
  const statuses = new Map<string, HarnessStatus>(catalog.list().map((def) => [def.id, {
    harnessId: def.id, installed: 'yes', login: 'signed-in', checkedAt: '2026-10-01T00:00:00.000Z'
  }]))
  const detector = { status: vi.fn(async (id: string) => statuses.get(id)!) } as HarnessDetector
  const runtime = { handlesProvider: () => true, handlesRoute: () => true, capabilities: () => undefined,
    capabilitiesV2: () => ({ statuses: allSupportedStatuses(), facts: { sandbox: 'native', usageReporting: 'exact', compactionOwner: 'harness' } }),
    runTurn: async () => 'completed' } as unknown as DelegatedTurnRuntime
  const runtimes = new HarnessRuntimeMap({ 'codex-app-server': runtime, 'agent-sdk': runtime, acp: runtime, 'cursor-sdk': runtime })
  let routerEnabled = true
  const router = new HarnessRouter({ enabled: () => routerEnabled, catalog, runtimes: () => runtimes.get(),
    providerKinds: () => ({ byId: { p1: 'http', cursor: 'cursor-sdk' }, defaultKind: 'http' }),
    defaultModel: () => 'test-model', status: (id) => statuses.get(id) })
  const snapshot = ModelConnectionSnapshotSchema.parse({ schemaVersion: 1, proxyRoutingVersion: 1, revision: 0,
    providers: [{ id: 'p1', accountId: 'account-1', name: 'API', kind: 'http', authType: 'api-key', endpointFormat: 'chat_completions',
      useProxy: false, configured: true, credentialStatus: 'ready', models: ['test-model'] },
    { id: 'cursor', accountId: 'cursor-account', name: 'Cursor', kind: 'cursor-sdk', authType: 'subscription', endpointFormat: 'chat_completions',
      useProxy: false, configured: true, models: ['cursor-model'] }] })
  const models = new Map<string, string[]>([['codex', ['codex-test']]])
  const service = new WorkbenchHarnessService({ catalog, detector, runtimes, router,
    ...(probeModels ? { probeModels: async (definition: import('../contracts/harness.js').HarnessDefinition) => {
      const discovered = await probeModels(definition); models.set(definition.id, discovered); return discovered
    } } : {}),
    probedModels: (def) => models.get(def.id),
    snapshot: async () => snapshot, defaultModel: () => ({ providerId: 'p1', model: 'test-model' }) })
  const native = { harnessId: 'codex', credentialMode: 'native-login' as const, model: 'codex-test' }
  const request = (model = native): WorkbenchRequest => ({ title: 'Fix tests', goal: 'Make tests pass',
    mode: 'agent', isolation: 'inherit', report: 'silent', execution: { mode: 'direct', model } })
  return { service, catalog, statuses, detector, disabled, runtimes, snapshot, native, request, disableRouter: () => { routerEnabled = false } }
}
async function fixture(options?: Parameters<typeof workbenchFixture>[0]) {
  const f = await workbenchFixture(options); open.push(f)
  const h = harnessFixture()
  f.bridge.attach({ harnesses: h.service })
  f.deps.modelSnapshot = async () => h.snapshot
  // The conversation itself cannot run native engines, but Code can.
  f.deps.unsupportedProviderIds = () => ['cursor']
  const project = await f.makeDirectory('code')
  f.addCodeThread('source-code', project)
  const create = async (call = 'create-native') => {
    const result = await f.run('create_code_task', { ...h.request(), projectRoot: project }, call)
    expect(result.isError).not.toBe(true)
    return (result.output as { linkId: string }).linkId
  }
  const row = async (id: string) => (await f.store.get<WorkbenchLink>('workbench_link', id))!
  const accept = async (id: string) => confirmWorkbenchLink(f.bridge, f.room.id, id, {
    clientRequestId: 'accept-' + id, expectedRevision: (await row(id)).revision })
  return { ...f, h, project, create, row, accept }
}

describe('Code harness discovery and validation', () => {
  it('uses live Code routes, excludes disabled, unavailable, incompatible and terminal engines', async () => {
    const h = harnessFixture()
    h.disabled.push('claude-code')
    h.statuses.get('gemini-cli')!.installed = 'no'
    const { agents } = await h.service.list()
    expect(agents.find((agent) => agent.harnessId === 'codex')).toMatchObject({ available: true,
      models: expect.arrayContaining([h.native]), executionModes: ['direct'], orchestration: ['direct'] })
    expect(agents.find((agent) => agent.harnessId === 'claude-code')).toMatchObject({ available: false, reason: 'Disabled in Code settings' })
    expect(agents.find((agent) => agent.harnessId === 'gemini-cli')?.available).toBe(false)
    expect(agents.find((agent) => agent.harnessId === 'kun')?.models).toEqual([
      { harnessId: 'kun', credentialMode: 'provider', providerId: 'p1', accountId: 'account-1', model: 'test-model' }
    ])
    expect(JSON.stringify(agents)).not.toMatch(/resolvedCommand|secretEnv|launch|apiKey/)
  })

  it('discovers a ready native Agent on a cold start without opening the Code picker', async () => {
    const probe = vi.fn(async (definition: import('../contracts/harness.js').HarnessDefinition) =>
      definition.id === 'devin' ? ['devin-cold-model'] : [])
    const h = harnessFixture(probe)
    const { agents } = await h.service.list()
    expect(probe).toHaveBeenCalledWith(expect.objectContaining({ id: 'devin' }))
    expect(agents.find((agent) => agent.harnessId === 'devin')).toMatchObject({ available: true,
      models: [{ harnessId: 'devin', credentialMode: 'native-login', model: 'devin-cold-model' }] })
  })

  it('does not probe external models while routing is disabled and honors cancellation', async () => {
    const probe = vi.fn(async () => [])
    const h = harnessFixture(probe)
    h.disableRouter()
    await h.service.list()
    expect(probe).not.toHaveBeenCalled()
    expect(h.detector.status).toHaveBeenCalledWith('kun')
    expect(vi.mocked(h.detector.status).mock.calls.every(([id]) => id === 'kun')).toBe(true)
    const controller = new AbortController()
    controller.abort(new Error('discovery stopped'))
    await expect(h.service.list(controller.signal)).rejects.toThrow('discovery stopped')
  })

  it('matches the shared Code sign-in admission gate for provider-backed engines', async () => {
    const h = harnessFixture()
    h.statuses.get('claude-code')!.login = 'signed-out'
    const request = h.request()
    request.execution!.model = { harnessId: 'claude-code', credentialMode: 'kun-gateway', providerId: 'p1', model: 'test-model' }
    await expect(h.service.resolve(request)).rejects.toThrow('signed out')
  })

  it('rejects unavailable engines, missing runtimes and disabled routing without falling back', async () => {
    const h = harnessFixture()
    h.statuses.get('codex')!.login = 'signed-out'
    await expect(h.service.resolve(h.request())).rejects.toThrow('unavailable')
    h.statuses.get('codex')!.login = 'signed-in'
    h.runtimes.replace({})
    await expect(h.service.resolve(h.request())).rejects.toThrow('No runtime registered')
    h.disableRouter()
    await expect(h.service.resolve(h.request())).rejects.toThrow('routing is disabled')
  })

  it('validates native/provider/gateway models and never mixes native sign-in with another account', async () => {
    const h = harnessFixture()
    await expect(h.service.resolve(h.request({ ...h.native, model: 'invented' }))).rejects.toThrow('model list')
    const native = h.request()
    native.execution!.model!.providerId = 'p1'
    await expect(h.service.resolve(native)).rejects.toThrow('unrelated provider')
    const gateway = h.request()
    gateway.execution!.model = { harnessId: 'claude-code', credentialMode: 'kun-gateway', providerId: 'p1', model: 'test-model' }
    expect(await h.service.resolve(gateway)).toMatchObject({ harnessId: 'claude-code', credentialMode: 'kun-gateway',
      providerId: 'p1', accountId: 'account-1', model: 'kun/p1/test-model' })
    gateway.execution!.model.model = 'kun/other/test-model'
    await expect(h.service.resolve(gateway)).rejects.toThrow('do not match')
    gateway.execution!.model = { harnessId: 'cursor', credentialMode: 'provider', providerId: 'cursor', model: 'cursor-model', accountId: 'stale-account' }
    await expect(h.service.resolve(gateway)).rejects.toThrow('account is unavailable')
  })

  it.each(['plan', 'auto', 'goal', 'graph'] as const)('rejects external %s work before creating a task', async (mode) => {
    const h = harnessFixture()
    const request = h.request()
    if (mode === 'graph') request.execution!.orchestration = 'graph'
    else request.execution!.mode = mode
    await expect(h.service.resolve(request)).rejects.toThrow('direct tasks only')
  })
})

describe('Rooms handoff to Code harnesses', () => {
  it('discovers routes through scoped tools and freezes a native route before confirmation and dispatch', async () => {
    const f = await fixture()
    const list = await f.run('list_code_harnesses', {})
    expect(list.output).toMatchObject({ authority: 'reference_only', agents: expect.arrayContaining([
      expect.objectContaining({ harnessId: 'codex', available: true })]) })
    const id = await f.create()
    expect((await f.row(id)).value).toMatchObject({ status: 'awaiting_confirmation', request: { execution: { model: f.h.native } } })
    expect(f.stub.calls.enqueued).toHaveLength(0)
    await f.accept(id)
    await reconcileWorkbench(f.bridge); await reconcileWorkbench(f.bridge); await reconcileWorkbench(f.bridge)
    expect(f.stub.calls.enqueued).toHaveLength(1)
    expect(f.stub.calls.created[0].request).toMatchObject({ harnessId: 'codex', credentialMode: 'native-login', model: 'codex-test', collaboration: { enabled: false } })
    expect(f.stub.calls.enqueued[0].request).toMatchObject(f.h.native)
    expect(f.stub.calls.enqueued[0].request.providerId).toBeUndefined()
    const thread = f.stub.threads.get((await f.row(id)).value.threadId!)!
    expect(thread).toMatchObject({ approvalPolicy: 'on-request', sandboxMode: 'workspace-write' })
    const view = await f.run('get_code_task', { linkId: id })
    expect(view.output).toMatchObject({ task: { execution: { model: f.h.native } } })
  })

  it('allows a Code-only provider but preserves confirmation, persona and permission boundaries', async () => {
    const f = await fixture()
    const created = await f.run('create_code_task', { title: 'Use Cursor', goal: 'Fix', projectRoot: f.project,
      execution: { mode: 'direct', model: { harnessId: 'cursor', credentialMode: 'provider', providerId: 'cursor', model: 'cursor-model' } } })
    expect(created.isError).not.toBe(true)
    const id = (created.output as { linkId: string }).linkId
    await expect(confirmWorkbenchLink(f.bridge, f.room.id, id, { clientRequestId: 'escalate', expectedRevision: (await f.row(id)).revision,
      edits: { execution: { mode: 'direct', model: f.h.native, permission: 'full-access' } } })).rejects.toThrow('exceeds')
    const rejected = await f.run('create_code_task', { title: 'Escalate', goal: 'Fix', projectRoot: f.project,
      execution: { mode: 'direct', model: f.h.native, permission: 'full-access' } }, 'escalate-tool')
    expect(rejected.isError).toBe(true)
    expect(f.stub.calls.enqueued).toHaveLength(0)
  })

  it('fails a queued route if the engine becomes unavailable and never admits a fallback', async () => {
    const f = await fixture()
    const id = await f.create(); await f.accept(id)
    f.h.disabled.push('codex')
    await reconcileWorkbench(f.bridge)
    expect((await f.row(id)).value).toMatchObject({ status: 'failed', error: expect.stringContaining('disabled') })
    expect(f.stub.calls.created).toHaveLength(0)
    expect(f.stub.calls.enqueued).toHaveLength(0)
  })

  it('carries native progress, approval attention, cancellation and final results through the existing bridge', async () => {
    const f = await fixture()
    const id = await f.create(); await f.accept(id)
    await reconcileWorkbench(f.bridge); await reconcileWorkbench(f.bridge)
    const thread = f.stub.threads.get((await f.row(id)).value.threadId!)!
    thread.turns[0].status = 'running'
    f.stub.services.approvals.pending = () => [{ summary: 'Approve a command', toolName: 'shell' }]
    await reconcileWorkbench(f.bridge)
    expect((await f.row(id)).value).toMatchObject({ status: 'needs_attention', attention: { kind: 'approval' } })
    await requestWorkbenchCancel(f.bridge, f.room.id, id)
    await reconcileWorkbench(f.bridge)
    expect((await f.row(id)).value.status).toBe('cancelled')
    expect(f.stub.calls.interrupted).toEqual(['turn-1'])

    const finished = await f.create('second-native'); await f.accept(finished)
    await reconcileWorkbench(f.bridge); await reconcileWorkbench(f.bridge)
    const target = f.stub.threads.get((await f.row(finished)).value.threadId!)!
    target.turns[0].status = 'completed'
    f.stub.services.sessions.loadItems = async () => [{ id: 'answer', turnId: target.turns[0].id, kind: 'assistant_text',
      text: 'Implemented and checked the fix.' }]
    await reconcileWorkbench(f.bridge)
    const link = (await f.row(finished)).value
    expect(link).toMatchObject({ status: 'completed', result: { finalExcerpt: 'Implemented and checked the fix.' } })
    expect(outcomePrompt(link)).toContain('"harnessId":"codex"')
  })

  it('does not expand Work tasks to external Code routes', async () => {
    const f = await fixture()
    await expect(validateExecution(f.bridge, f.room.id, f.h.request(), false)).rejects.toThrow('routing is unavailable')
    await expect(validateExecution(f.bridge, f.room.id, { ...f.h.request(), execution: { mode: 'direct',
      model: { providerId: 'cursor', model: 'cursor-model' } } }, false)).rejects.toThrow('scoped Agent tools')
  })

  it('hides and rejects discovery when Code is disabled', async () => {
    const f = await fixture({ policy: { code: 'off' } })
    expect((await f.run('list_code_harnesses', {})).isError).toBe(true)
  })
})
