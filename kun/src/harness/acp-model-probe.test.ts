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
  })
})
