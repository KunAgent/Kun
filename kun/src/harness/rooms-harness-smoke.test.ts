import { makeHarness } from '../../tests/helpers/acp-runtime-test-support.js'
import { acpSessionCatalog } from './acp-model-catalog.js'
import { createRequire } from 'node:module'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, expect, it, vi } from 'vitest'
import { HarnessesConfigSchema } from '../config/kun-config-harnesses.js'
import { ModelConnectionSnapshotSchema } from '../contracts/model-connections.js'
import type { DelegatedTurnRuntime } from '../runtime/delegated-turn-runtime.js'
import { listHarnesses, testHarness } from '../server/routes/harnesses.js'
import type { ServerRuntime } from '../server/routes/server-runtime.js'
import { WorkbenchHarnessService } from '../workbench-bridge/harnesses.js'
import { createHarnessComposition } from './harness-runtime.js'
import { HarnessRouter, HarnessRuntimeMap } from './harness-router.js'

const require = createRequire(import.meta.url)
const { configureRoomsHarnessFixture, writeRoomsHarnessStub } = require('../../../scripts/smoke-rooms-harness-fixture.cjs')
const { verifyRoomsHarnessReadiness } = require('../../../scripts/smoke-rooms-harness-controls.cjs')
const roots: string[] = []
afterEach(async () => {
  vi.unstubAllEnvs()
  for (const root of roots.splice(0)) await rm(root, { recursive: true, force: true })
})

async function fixture() {
  const root = await mkdtemp(join(tmpdir(), 'kun-rooms-readiness-')); roots.push(root)
  const audit = join(root, 'acp-methods.jsonl')
  const release = join(root, 'release')
  const command = await writeRoomsHarnessStub(root, release, audit)
  const settings = { agents: { kun: { harnesses: HarnessesConfigSchema.parse({ binaryPaths: { devin: command } }) } } }
  const environment: Record<string, string> = {}
  configureRoomsHarnessFixture(settings, environment)
  vi.stubEnv('WINDSURF_API_KEY', environment.WINDSURF_API_KEY)
  vi.stubEnv('HOME', root)
  vi.stubEnv('USERPROFILE', root)
  const options = { dataDir: root, model: 'offline-model', baseUrl: 'http://127.0.0.1:1', apiKey: '',
    harnesses: settings.agents.kun.harnesses }
  const harnesses = createHarnessComposition(() => options)
  const runtime = { harnesses, nowIso: () => new Date().toISOString() } as unknown as ServerRuntime
  const runtimeRequest = async (_page: unknown, path: string, method = 'GET', body?: unknown) => {
    const request = new Request(`http://localhost${path}`, { method,
      ...(body ? { headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) } : {}) })
    const response = method === 'POST' ? await testHarness(runtime, request, { id: 'devin' }) : await listHarnesses(runtime, request)
    expect(response.status).toBe(200)
    return JSON.parse(response.body)
  }
  const methods = async () => (await readFile(audit, 'utf8').catch(() => '')).trim().split('\n').filter(Boolean)
    .map((line) => JSON.parse(line).method as string)
  return { options, harnesses, runtimeRequest, methods, command, release }
}

it('the exact Rooms fixture earns real readiness before live Code discovery without any model prompt', async () => {
  const f = await fixture()
  const result = await verifyRoomsHarnessReadiness({ page: undefined, runtimeRequest: f.runtimeRequest,
    poll: async (condition: () => Promise<boolean>) => vi.waitFor(async () => expect(await condition()).toBe(true), { timeout: 30_000 }) })
  expect(result).toMatchObject({ ok: true, readiness: { usable: true, authentication: 'unverified' },
    handshake: { ok: true, protocol: 'acp', agent: { name: 'Devin offline fixture' } } })
  expect(result.handshake.models).toBeUndefined()
  const adapter = { handlesProvider: () => true, capabilities: () => undefined,
    runTurn: async () => 'completed' } as unknown as DelegatedTurnRuntime
  const runtimes = new HarnessRuntimeMap({ acp: adapter })
  const router = new HarnessRouter({ enabled: () => true, catalog: f.harnesses.catalog,
    readiness: f.harnesses.readiness, runtimes: () => runtimes.get(), providerKinds: () => ({ byId: {}, defaultKind: 'http' }),
    defaultModel: () => 'offline-model', status: (id) => f.harnesses.detector.cachedStatus(id) })
  const service = new WorkbenchHarnessService({ catalog: f.harnesses.catalog, detector: f.harnesses.detector,
    router, runtimes, probedModels: f.harnesses.probedModels, probeModels: (definition) => f.harnesses.acpModels.probe(definition),
    snapshot: async () => ModelConnectionSnapshotSchema.parse({ schemaVersion: 1, proxyRoutingVersion: 1, revision: 0, providers: [] }),
    defaultModel: () => ({ model: 'offline-model' }) })
  const { agents } = await service.list()
  expect(agents.find((agent) => agent.harnessId === 'devin')).toMatchObject({ available: true, models: expect.arrayContaining([
    { harnessId: 'devin', credentialMode: 'native-login', model: 'default' }
  ]) })
  expect(agents.filter((agent) => agent.harnessId !== 'kun').map((agent) => agent.harnessId)).toEqual(['devin'])
  const methods = await f.methods()
  expect(methods).toContain('initialize')
  expect(methods).not.toContain('session/new')
  expect(methods).not.toContain('session/prompt')
  expect(methods).not.toContain('authenticate')
}, 60_000)

it('discovers fixture models only when the actual offline turn creates its session', async () => {
  const f = await fixture()
  const definition = f.harnesses.catalog.get('devin')!
  expect(await f.harnesses.acpModels.probe(definition)).toEqual([])
  await writeFile(f.release, 'complete fixture\n')
  const h = await makeHarness('basic-chat.json', {
    definition: { ...definition, acpPermission: undefined },
    thread: { harnessId: 'devin' },
    turn: { harnessId: 'devin', model: 'default', credentialMode: 'native-login',
      approvalPolicy: 'auto', sandboxMode: 'danger-full-access' },
    deps: {
      binaryPath: () => f.command,
      harnessDefaults: () => ({ permissionMode: 'bypass' }),
      onNativeSession: (nativeDefinition, session) =>
        f.harnesses.acpModels.seed(nativeDefinition, acpSessionCatalog(nativeDefinition, session))
    }
  })
  expect(await h.runtime.runTurn('thread_1', 'turn_1', new AbortController().signal)).toBe('completed')
  expect(await f.harnesses.acpModels.probe(definition)).toEqual(['devin-fixture-model', 'devin-fixture-alternative'])
  const methods = await f.methods()
  expect(methods.filter((method) => method === 'session/new')).toHaveLength(1)
  expect(methods.indexOf('session/new')).toBeLessThan(methods.indexOf('session/prompt'))
  expect(methods).not.toContain('authenticate')
  expect(h.deltas.map(({ delta }) => delta).join('')).toContain('Model: devin-fixture-model')
}, 60_000)

it('installed Rooms fixtures cannot become ready without consent or without the offline credential sentinel', async () => {
  const f = await fixture()
  f.options.harnesses.enabledProfiles = []
  const route = { harnessId: 'devin', credentialMode: 'native-login' as const, model: 'devin-fixture-model' }
  await expect(f.harnesses.readiness.assertReady(route)).rejects.toThrow('disabled')
  expect(await f.methods()).toEqual([])
  f.options.harnesses.enabledProfiles = [{ harnessId: 'devin', credentialMode: 'native-login' }]
  vi.stubEnv('WINDSURF_API_KEY', '')
  const result = await f.harnesses.readiness.test(f.harnesses.catalog.get('devin')!, { level: 'handshake', ...route })
  expect(result.ok).toBe(false)
  // Without the sentinel the stub refuses to start, so the session never opens;
  // missing local evidence alone is a diagnostic, not the failure.
  expect(result.readiness).toMatchObject({ usable: false,
    checks: expect.arrayContaining([expect.objectContaining({ id: 'protocol', ok: false })]) })
  expect(await f.harnesses.readiness.readyProfiles('devin')).toEqual([])
  expect(await f.methods()).toEqual([])
}, 60_000)

it('keeps real Devin admission valid across native default aliases and background revalidation', async () => {
  const f = await fixture()
  const native = { harnessId: 'devin', credentialMode: 'native-login' as const, model: 'devin-fixture-model' }
  const accepted = { ...native, providerId: 'default' }
  const readiness = f.harnesses.readiness
  const signal = new AbortController().signal
  expect(readiness.configurationSignature(accepted)).toBe(readiness.configurationSignature(native))
  await Promise.all([
    readiness.prepareTurn('rooms-native', 'turn', native, readiness.configurationSignature(native), signal),
    readiness.prepareTurn('rooms-accepted', 'turn', accepted, readiness.configurationSignature(accepted), signal)
  ])
  readiness.warmProfiles('devin')
  await vi.waitFor(() => expect(readiness.checking('devin')).toBe(false), { timeout: 30_000 })
  await expect(readiness.validateTurn('rooms-native', 'turn', signal, accepted)).resolves.toMatch(/^[a-f0-9]{64}$/)
  await expect(readiness.validateTurn('rooms-accepted', 'turn', signal, native)).resolves.toMatch(/^[a-f0-9]{64}$/)
  expect(await readiness.readyProfiles('devin')).toHaveLength(1)
  expect(await f.methods()).toContain('initialize')
  expect(await f.methods()).not.toContain('session/prompt')
}, 60_000)
