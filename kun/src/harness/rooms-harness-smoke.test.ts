import { createRequire } from 'node:module'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
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
  const command = await writeRoomsHarnessStub(root, join(root, 'release'), audit)
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
  return { options, harnesses, runtimeRequest, methods }
}

it('the exact Rooms fixture earns real readiness before live Code discovery without any model prompt', async () => {
  const f = await fixture()
  const result = await verifyRoomsHarnessReadiness({ page: undefined, runtimeRequest: f.runtimeRequest,
    poll: async (condition: () => Promise<boolean>) => vi.waitFor(async () => expect(await condition()).toBe(true), { timeout: 30_000 }) })
  expect(result).toMatchObject({ ok: true, readiness: { usable: true, authentication: 'unverified' },
    handshake: { ok: true, protocol: 'acp', agent: { name: 'Devin offline fixture' },
      models: ['devin-fixture-model', 'devin-fixture-alternative'] } })
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
    { harnessId: 'devin', credentialMode: 'native-login', model: 'devin-fixture-model' }
  ]) })
  expect(agents.filter((agent) => agent.harnessId !== 'kun').map((agent) => agent.harnessId)).toEqual(['devin'])
  const methods = await f.methods()
  expect(methods).toContain('initialize')
  expect(methods).toContain('session/new')
  expect(methods).not.toContain('session/prompt')
  expect(methods).not.toContain('authenticate')
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
  expect(result.readiness).toMatchObject({ usable: false, authentication: 'missing',
    checks: expect.arrayContaining([{ id: 'credentials', ok: false, detail: expect.any(String) }]) })
  expect(await f.harnesses.readiness.readyProfiles('devin')).toEqual([])
  expect(await f.methods()).toEqual([])
}, 60_000)
