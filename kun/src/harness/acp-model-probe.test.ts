import { spawn } from 'node:child_process'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterEach, describe, expect, it } from 'vitest'
import { BUILTIN_HARNESSES } from './builtin-harnesses.js'
import { AcpModelProbe, acpModelProbeError } from './acp-model-probe.js'
import type { AcpSpawnFn } from '../runtime/acp/acp-process.js'
import { AcpError } from '../runtime/acp/acp-schema.js'

const devin = BUILTIN_HARNESSES.find((entry) => entry.id === 'devin')!
const opencode = BUILTIN_HARNESSES.find((entry) => entry.id === 'opencode')!
const antigravity = BUILTIN_HARNESSES.find((entry) => entry.id === 'antigravity')!
const fixture = fileURLToPath(new URL('../runtime/acp/__fixtures__/fake-acp-agent.mjs', import.meta.url))
const scenarioPath = fileURLToPath(new URL('../runtime/acp/__fixtures__/scenarios/auth-advertised.json', import.meta.url))
const dirs: string[] = []
afterEach(async () => { for (const dir of dirs.splice(0)) await rm(dir, { recursive: true, force: true }) })

const TEAM_SETTINGS_TIMEOUT = { code: -32603, message: 'Failed to load team settings: fetch timed out after 10000ms' }

/** Each spawn consumes the next scenario, mirroring one process per probe attempt. */
async function sequence(...overrides: Array<Record<string, unknown>>) {
  const dir = await mkdtemp(join(tmpdir(), 'kun-acp-model-probe-')); dirs.push(dir)
  const base = JSON.parse(await readFile(scenarioPath, 'utf8'))
  const paths = await Promise.all(overrides.map(async (override, index) => {
    const path = join(dir, `scenario-${index}.json`)
    await writeFile(path, JSON.stringify({ ...base, ...override }))
    return path
  }))
  let spawned = 0
  const spawnFixture: AcpSpawnFn = async (_command, _args, options) => {
    const path = paths[Math.min(spawned, paths.length - 1)]!
    spawned += 1
    return spawn(process.execPath, [fixture], {
      env: { ...(options.env as NodeJS.ProcessEnv), FAKE_ACP_SCENARIO: path },
      cwd: options.cwd,
      stdio: ['pipe', 'pipe', 'pipe']
    })
  }
  return { spawnFixture, spawned: () => spawned }
}

const failing = { newSession: { error: TEAM_SETTINGS_TIMEOUT } }
const working = {}

describe('AcpModelProbe', () => {
  it('retries a transient session/new failure once and returns the live catalog', async () => {
    const f = await sequence(failing, working)
    const probe = new AcpModelProbe({ spawn: f.spawnFixture, retryDelayMs: 0, log: () => undefined })
    const catalog = await probe.probeCatalog(devin)
    expect(catalog.models).toEqual(['available-model'])
    expect(catalog.error).toBeUndefined()
    expect(f.spawned()).toBe(2)
  })

  it('lists switchable native Agents only for harnesses that publish them', async () => {
    const modes = { currentModeId: 'build', availableModes: [{ id: 'build', name: 'build', description: 'Default agent' }, { id: 'plan', name: 'plan' }] }
    const base = JSON.parse(await readFile(scenarioPath, 'utf8'))
    const f = await sequence({ newSession: { ...base.newSession, modes } })
    const probe = new AcpModelProbe({ spawn: f.spawnFixture, retryDelayMs: 0, log: () => undefined })
    const catalog = await probe.probeCatalog(opencode)
    expect(catalog.agents).toEqual([{ id: 'build', name: 'build', description: 'Default agent' }, { id: 'plan', name: 'plan' }])
    expect(catalog.defaultAgentId).toBe('build')
    const other = new AcpModelProbe({ spawn: f.spawnFixture, retryDelayMs: 0, log: () => undefined })
    expect((await other.probeCatalog(devin)).agents).toBeUndefined()
    probe.dispose()
    other.dispose()
  })

  it('serves a catalog seeded by the readiness handshake without starting the Agent', async () => {
    const f = await sequence(working)
    const recorded: Array<{ models: string[] }> = []
    const probe = new AcpModelProbe({ spawn: f.spawnFixture, retryDelayMs: 0, log: () => undefined,
      onCatalog: (_definition, catalog) => recorded.push(catalog) })
    probe.seed(opencode, { models: ['seeded-model'], modelInfo: [{ id: 'seeded-model' }] })
    expect(probe.peek(opencode)).toEqual(['seeded-model'])
    expect((await probe.probeCatalog(opencode)).models).toEqual(['seeded-model'])
    expect(f.spawned()).toBe(0)
    // A catalog read by a real session is kept for the next Runtime.
    expect(recorded).toEqual([{ models: ['seeded-model'], modelInfo: [{ id: 'seeded-model' }] }])
    probe.seed(devin, { models: [], modelInfo: [] })
    expect(probe.peek(devin)).toBeUndefined()
    expect(recorded).toHaveLength(1)
    probe.dispose()
  })

  it('reports the categorical agent error instead of an indistinguishable empty list', async () => {
    const f = await sequence(failing, failing)
    const lines: string[] = []
    const probe = new AcpModelProbe({ spawn: f.spawnFixture, retryDelayMs: 0, log: (line) => lines.push(line) })
    const catalog = await probe.probeCatalog(devin)
    expect(catalog.models).toEqual([])
    expect(catalog.error).toMatchObject({ code: 'agent_error', message: expect.stringContaining('team settings') })
    expect(lines.join('\n')).toContain('devin model catalog probe failed')
  })

  it('does not retry a login rejection', async () => {
    const f = await sequence({ newSession: { error: { code: -32000, message: 'Authentication required' } } }, working)
    const probe = new AcpModelProbe({ spawn: f.spawnFixture, retryDelayMs: 0, log: () => undefined })
    expect((await probe.probeCatalog(devin)).error).toMatchObject({ code: 'auth_required' })
    expect(f.spawned()).toBe(1)
  })

  it('backs off repeated failures instead of respawning a broken Agent every 30 seconds', async () => {
    const rejected = { newSession: { error: { code: -32000, message: 'Authentication required' } } }
    const f = await sequence(rejected, rejected, rejected, rejected)
    let now = 0
    const probe = new AcpModelProbe({ spawn: f.spawnFixture, retryDelayMs: 0, log: () => undefined, nowMs: () => now })
    await probe.probeCatalog(devin)
    now = 31_000
    await probe.probeCatalog(devin)
    expect(f.spawned()).toBe(2)
    // The second failure is cached for 60s, not 30s.
    now = 31_000 + 59_000
    await probe.probeCatalog(devin)
    expect(f.spawned()).toBe(2)
    now = 31_000 + 61_000
    await probe.probeCatalog(devin)
    expect(f.spawned()).toBe(3)
    // An explicit refresh is never held back by the backoff.
    probe.invalidate('devin')
    await probe.probeCatalog(devin)
    expect(f.spawned()).toBe(4)
  })

  it('keeps the last good catalog, marked with the error, when a refresh fails', async () => {
    const f = await sequence(working, failing, failing)
    const probe = new AcpModelProbe({ spawn: f.spawnFixture, retryDelayMs: 0, log: () => undefined })
    expect((await probe.probeCatalog(devin)).models).toEqual(['available-model'])
    probe.invalidate('devin')
    const refreshed = await probe.probeCatalog(devin)
    expect(refreshed.models).toEqual(['available-model'])
    expect(refreshed.error).toMatchObject({ code: 'agent_error' })
  })

  it('invalidates only the requested harness', async () => {
    const f = await sequence(working)
    const probe = new AcpModelProbe({ spawn: f.spawnFixture, retryDelayMs: 0, log: () => undefined })
    const other = { ...devin, id: 'opencode' as const }
    await probe.probeCatalog(devin)
    await probe.probeCatalog(other)
    probe.invalidate('opencode')
    expect(probe.peek(devin)).toEqual(['available-model'])
    expect(probe.peek(other)).toBeUndefined()
  })

  it('classifies transport failures without echoing process output', () => {
    expect(acpModelProbeError(new AcpError('request_timeout', 'session/new timed out'))).toMatchObject({ code: 'timeout' })
    expect(acpModelProbeError(new AcpError('harness_protocol_error', 'bad frame'))).toMatchObject({ code: 'protocol_error' })
    expect(acpModelProbeError(new Error('spawn devin ENOENT'))).toMatchObject({ code: 'spawn_failed' })
    // A process that dies during startup (e.g. an incompatible plugin) is reported, not respawned.
    expect(acpModelProbeError(new AcpError('harness_crashed', 'opencode exited with code 1'))).toMatchObject({ code: 'spawn_failed' })
  })

  it('reuses one warm Agent process for the catalog and per-model detail lookups', async () => {
    const f = await sequence(working)
    const probe = new AcpModelProbe({ spawn: f.spawnFixture, retryDelayMs: 0, log: () => undefined })
    try {
      expect((await probe.probeCatalog(devin)).models).toEqual(['available-model'])
      expect((await probe.probeCatalog(devin, 'available-model')).models).toEqual(['available-model'])
      expect(f.spawned()).toBe(1)
      probe.invalidate('devin')
      await probe.probeCatalog(devin)
      expect(f.spawned()).toBe(2)
    } finally { probe.dispose() }
  })

  it('closes an idle probe process and starts a fresh one on the next lookup', async () => {
    const f = await sequence(working)
    const probe = new AcpModelProbe({ spawn: f.spawnFixture, retryDelayMs: 0, idleMs: 10, cacheMs: 0, log: () => undefined })
    try {
      await probe.probeCatalog(devin)
      await new Promise((resolve) => setTimeout(resolve, 50))
      await probe.probeCatalog(devin)
      expect(f.spawned()).toBe(2)
    } finally { probe.dispose() }
  })

  it('probes every Antigravity model effort up front, restores the initial model, and preserves learned efforts across seed', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'kun-acp-agy-probe-')); dirs.push(dir)
    const journalPath = join(dir, 'journal.jsonl')
    const modelOptions = [
      { value: 'gemini-pro-orchestrator-neon', name: 'Orchestrator (Neon)' },
      { value: 'gemini-4-carbon', name: 'Gemini 4 Carbon' },
      { value: 'gemini-4-hydrogen', name: 'Gemini 4 Hydrogen' },
      { value: 'claude-sonnet-4-6', name: 'Claude Sonnet 4.6' }
    ]
    const selector = (currentValue: string) => ({
      id: 'model', name: 'Model', category: 'model', type: 'select', currentValue, options: modelOptions
    })
    const thought = (currentValue: string, values: string[]) => ({
      id: 'effort', name: 'Thinking', category: 'thought_level', type: 'select', currentValue,
      options: values.map((value) => ({ value, name: value }))
    })
    const f = await sequence({
      newSession: { configOptions: [selector('gemini-pro-orchestrator-neon')] },
      onSetConfigOption: {
        'gemini-4-carbon': { configOptions: [selector('gemini-4-carbon'), thought('high', ['low', 'medium', 'high'])] },
        'gemini-4-hydrogen': { configOptions: [selector('gemini-4-hydrogen'), thought('xhigh', ['xhigh'])] },
        'claude-sonnet-4-6': { configOptions: [selector('claude-sonnet-4-6')] },
        'gemini-pro-orchestrator-neon': { configOptions: [selector('gemini-pro-orchestrator-neon')] }
      }
    })
    const probe = new AcpModelProbe({
      spawn: async (cmd, args, opts) => f.spawnFixture(cmd, args, { ...opts, env: { ...opts.env, FAKE_ACP_JOURNAL: journalPath } }),
      retryDelayMs: 0,
      log: () => undefined
    })
    try {
      // Seed from a partial turn session first: probeCatalog must still complete the unprobed models once.
      probe.seed(antigravity, {
        models: modelOptions.map((item) => item.value),
        modelInfo: [{ id: 'gemini-pro-orchestrator-neon', isDefault: true, reasoningEfforts: [] }, { id: 'gemini-4-carbon' }, { id: 'gemini-4-hydrogen' }, { id: 'claude-sonnet-4-6' }]
      })
      const catalog = await probe.probeCatalog(antigravity)
      expect(catalog.modelInfo).toEqual([
        { id: 'gemini-pro-orchestrator-neon', displayName: 'Orchestrator (Neon)', isDefault: true, reasoningEfforts: [] },
        { id: 'gemini-4-carbon', displayName: 'Gemini 4 Carbon', reasoningEfforts: ['low', 'medium', 'high'], defaultReasoningEffort: 'high' },
        { id: 'gemini-4-hydrogen', displayName: 'Gemini 4 Hydrogen', reasoningEfforts: ['xhigh'], defaultReasoningEffort: 'xhigh' },
        { id: 'claude-sonnet-4-6', displayName: 'Claude Sonnet 4.6', reasoningEfforts: [] }
      ])
      // Verify the initial default model was restored so `agy` settings are not mutated.
      const lines = (await readFile(journalPath, 'utf8')).trim().split('\n').map((line) => JSON.parse(line))
      const setCalls = lines.filter((entry) => entry.frame?.kind === 'configSet').map((entry) => entry.frame.params.value)
      expect(setCalls).toEqual(['gemini-4-carbon', 'gemini-4-hydrogen', 'claude-sonnet-4-6', 'gemini-pro-orchestrator-neon'])
      // Later single-model turn seeds must not wipe out the other models' learned reasoningEfforts.
      probe.seed(antigravity, {
        models: modelOptions.map((item) => item.value),
        modelInfo: [
          { id: 'gemini-pro-orchestrator-neon', reasoningEfforts: [] },
          { id: 'gemini-4-carbon', isDefault: true, reasoningEfforts: ['low', 'medium', 'high'], defaultReasoningEffort: 'medium' },
          { id: 'gemini-4-hydrogen' },
          { id: 'claude-sonnet-4-6' }
        ]
      })
      expect(probe.peekInfo(antigravity)?.find((entry) => entry.id === 'gemini-4-hydrogen')?.reasoningEfforts).toEqual(['xhigh'])
      expect(probe.peekInfo(antigravity)?.find((entry) => entry.id === 'claude-sonnet-4-6')?.reasoningEfforts).toEqual([])
    } finally { probe.dispose() }
  })
})
