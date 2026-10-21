import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterEach, expect, it, vi } from 'vitest'
import type { HarnessStatus } from '../contracts/harness.js'
import type { ServerRuntime } from '../server/routes/server-runtime.js'

const fixture = fileURLToPath(new URL('../runtime/acp/__fixtures__/fake-acp-agent.mjs', import.meta.url))
const dirs: string[] = []
const disposers: Array<() => void> = []
afterEach(async () => {
  for (const dispose of disposers.splice(0)) dispose()
  vi.resetModules()
  // A disposed probe process may still be logging its exit into the directory.
  for (const dir of dirs.splice(0)) await rm(dir, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 })
})

const scenario = (models: string[]) => ({ sessionId: 'probe-session',
  initialize: { protocolVersion: 1, agentInfo: { name: 'fixture-agent', version: '1.0.0' }, agentCapabilities: {} },
  newSession: { configOptions: [{ id: 'model', name: 'Model', category: 'model', type: 'select', currentValue: models[0],
    options: models.map((value) => ({ value, name: value })) }] } })

/** Stand-ins for installed OpenCode and CodeMaker: each start and exit is logged. */
async function agents() {
  const dir = await mkdtemp(join(tmpdir(), 'kun-model-catalog-restart-')); dirs.push(dir)
  const log = join(dir, 'spawns.log')
  await writeFile(log, '')
  const install = async (id: string, models: string[], body = '') => {
    const scenarioPath = join(dir, `${id}.json`)
    await writeFile(scenarioPath, JSON.stringify(scenario(models)))
    const command = join(dir, id)
    await writeFile(command, `#!/bin/sh\n${body}echo "start ${id}" >> '${log}'\n` +
      `FAKE_ACP_SCENARIO='${scenarioPath}' '${process.execPath}' '${fixture}' "$@"\necho "end ${id}" >> '${log}'\n`, { mode: 0o755 })
    return { command, scenarioPath }
  }
  const opencode = await install('opencode', ['opencode/big', 'opencode/small'])
  const codemaker = await install('codemaker', ['codemaker/pro', 'codemaker/lite'])
  const spawns = async () => (await readFile(log, 'utf8')).split('\n').filter(Boolean)
  return { dir, install, opencode, codemaker, spawns, store: join(dir, 'harness-model-catalogs.json') }
}

/** A fresh module graph and composition stand in for a new Runtime process on the same data directory. */
async function startRuntime(fixtureAgents: Awaited<ReturnType<typeof agents>>) {
  vi.resetModules()
  const [{ createHarnessComposition }, { WorkbenchHarnessService }, { codingAgentCatalog }, { HarnessesConfigSchema },
    { HarnessRouter, HarnessRuntimeMap }, { allSupportedStatuses }, { ModelConnectionSnapshotSchema }, { listHarnessModels }] = await Promise.all([
    import('./harness-runtime.js'), import('../workbench-bridge/harnesses.js'), import('../agents/agent-coding-agents.js'),
    import('../config/kun-config-harnesses.js'), import('./harness-router.js'), import('../contracts/harness-capabilities.js'),
    import('../contracts/model-connections.js'), import('../server/routes/harnesses.js')])
  const options = { dataDir: fixtureAgents.dir, harnesses: HarnessesConfigSchema.parse({
    binaryPaths: { opencode: fixtureAgents.opencode.command, codemaker: fixtureAgents.codemaker.command },
    enabledProfiles: [{ harnessId: 'opencode', credentialMode: 'native-login' }, { harnessId: 'codemaker', credentialMode: 'native-login' }] }) }
  const h = createHarnessComposition(() => options as never, { modelCatalogStorePath: fixtureAgents.store })
  disposers.push(() => h.acpModels.dispose())
  // Detection (`--version`, sign-in status) is a separate, metadata-only check; this covers model listing.
  const status = (id: string): HarnessStatus => ({ harnessId: id, installed: 'yes', login: 'signed-in', checkedAt: '2026-10-19T00:00:00.000Z' })
  const detector = { status: async (id: string) => status(id), cachedStatus: (id: string) => status(id) }
  const runtime = { handlesProvider: () => true, handlesRoute: () => true, capabilities: () => undefined,
    capabilitiesV2: () => ({ statuses: allSupportedStatuses(), facts: { sandbox: 'native', usageReporting: 'exact', compactionOwner: 'harness' } }),
    runTurn: async () => 'completed' } as never
  const runtimes = new HarnessRuntimeMap({ acp: runtime })
  const router = new HarnessRouter({ enabled: () => true, catalog: h.catalog, runtimes: () => runtimes.get(),
    readiness: { configurationSignature: () => 'fixture', prepareTurn: async () => undefined, releaseTurn: () => undefined } as never,
    providerKinds: () => ({ byId: {}, defaultKind: 'http' }), defaultModel: () => 'test-model', status })
  const snapshot = ModelConnectionSnapshotSchema.parse({ schemaVersion: 1, proxyRoutingVersion: 1, revision: 0, providers: [] })
  const service = new WorkbenchHarnessService({ catalog: h.catalog, detector, runtimes, router,
    probedModels: (definition) => h.probedModels(definition),
    probeModels: (definition) => h.probeModelsInBackground(definition),
    snapshot: async () => snapshot, defaultModel: () => ({ model: 'test-model' }),
    // Real processes under a loaded test run: never let the budget mark an engine as still detecting.
    discoveryBudgetMs: 12_000 })
  const listed = async () => Object.fromEntries((await codingAgentCatalog(service)).agents
    .map((agent) => [agent.harnessId, agent.models.map((route) => route.model)]))
  const models = async (id: string) => JSON.parse((await listHarnessModels({ harnesses: h } as unknown as ServerRuntime,
    new Request(`http://kun/v1/harnesses/${id}/models`), { id })).body) as { models: string[]; catalogStatus: { source: string; error?: { code: string } } }
  return { h, listed, models }
}

const kept = async (store: string) => JSON.parse(await readFile(store, 'utf8')) as { catalogs: Array<{ harnessId: string }> }
const listedModels = { opencode: ['opencode/big', 'opencode/small'], codemaker: ['codemaker/pro', 'codemaker/lite'] }
/** Each case starts real Agent processes and two Runtime compositions. */
const SPAWNING_TEST_TIMEOUT_MS = 30_000

it('lists Agent models after a restart without starting any Agent CLI', async () => {
  const fixtureAgents = await agents()
  const first = await startRuntime(fixtureAgents)
  expect(await first.listed()).toEqual(listedModels)
  // Discovery starts one Agent at a time: each probe process exits before the next starts.
  const spawns = await fixtureAgents.spawns()
  expect(spawns).toHaveLength(4)
  for (let index = 0; index < spawns.length; index += 2) {
    expect(spawns[index + 1]).toBe(spawns[index]!.replace('start', 'end'))
  }
  // What a Runtime shutdown does; the debounced write would land a second later anyway.
  await first.h.modelCatalogs.flush()
  expect((await kept(fixtureAgents.store)).catalogs).toHaveLength(2)

  const restarted = await startRuntime(fixtureAgents)
  expect(await restarted.listed()).toEqual(listedModels)
  expect(restarted.h.probedModels(restarted.h.catalog.get('codemaker')!)).toEqual(listedModels.codemaker)
  expect(await fixtureAgents.spawns()).toEqual(spawns)
}, SPAWNING_TEST_TIMEOUT_MS)

it('re-lists only the Agent whose executable changed since the last launch', async () => {
  const fixtureAgents = await agents()
  const first = await startRuntime(fixtureAgents)
  await first.listed()
  await first.h.modelCatalogs.flush()
  expect((await kept(fixtureAgents.store)).catalogs).toHaveLength(2)
  // An in-place upgrade: same path, new file, new model list.
  await fixtureAgents.install('opencode', ['opencode/next'], '# upgraded\n')
  const before = (await fixtureAgents.spawns()).length

  const restarted = await startRuntime(fixtureAgents)
  expect(await restarted.listed()).toEqual({ ...listedModels, opencode: ['opencode/next'] })
  expect((await fixtureAgents.spawns()).slice(before)).toEqual(['start opencode', 'end opencode'])
}, SPAWNING_TEST_TIMEOUT_MS)

it('asks the Agent itself when its models are opened, keeping the last catalog if that fails', async () => {
  const fixtureAgents = await agents()
  const first = await startRuntime(fixtureAgents)
  await first.listed()
  await first.h.modelCatalogs.flush()
  expect((await kept(fixtureAgents.store)).catalogs).toHaveLength(2)
  const before = (await fixtureAgents.spawns()).length

  const restarted = await startRuntime(fixtureAgents)
  const opened = await restarted.models('codemaker')
  expect(opened.models).toEqual(listedModels.codemaker)
  expect(opened.catalogStatus.source).toBe('native')
  // Opened by the user: the probe process stays warm for per-model detail lookups.
  expect((await fixtureAgents.spawns()).slice(before)).toEqual(['start codemaker'])

  await writeFile(fixtureAgents.opencode.scenarioPath, JSON.stringify({ ...scenario([]),
    newSession: { error: { code: -32603, message: 'Failed to load team settings: fetch timed out' } } }))
  const failed = await restarted.models('opencode')
  expect(failed.models).toEqual(listedModels.opencode)
  expect(failed.catalogStatus).toMatchObject({ source: 'cache', error: { code: 'agent_error' } })
}, SPAWNING_TEST_TIMEOUT_MS)
