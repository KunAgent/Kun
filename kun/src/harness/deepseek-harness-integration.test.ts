import { spawn } from 'node:child_process'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterEach, expect, it, vi } from 'vitest'
import { DEEPSEEK_HARNESS_DEFINITION } from './deepseek-harness-definition.js'
import { DEEPSEEK_HARNESS_PRIVACY_PATCH } from './deepseek-harness-launch.js'
import { hasDeepSeekHarnessNativeKey } from './deepseek-harness-profile.js'
import { AcpModelProbe } from './acp-model-probe.js'
import { probeAcpHandshake } from './acp-handshake-probe.js'
import type { AcpSpawnFn } from '../runtime/acp/acp-process.js'

// Captured from official @deepseek-ai/dsh@0.2.0-rc.2 on 2026-10-03 in
// an empty HOME/DSH_HOME, with no credentials, no authenticate or prompts,
// discarded outbound proxy traffic, and the final privacy patch in place.
// Only the generated session id and presentation descriptions were omitted.
const scenario = fileURLToPath(new URL('./__fixtures__/deepseek-harness-0.2.0-rc.2.json', import.meta.url))
const agent = fileURLToPath(new URL('../runtime/acp/__fixtures__/fake-acp-agent.mjs', import.meta.url))
const directories: string[] = []
afterEach(async () => { vi.unstubAllEnvs(); for (const directory of directories.splice(0)) await rm(directory, { recursive: true, force: true }) })

it('replays the real unauthenticated ACP shape and enforces privacy at the actual process boundary', async () => {
  // Recreate the captured empty host, regardless of the test runner's heap flags or credentials.
  vi.stubEnv('NODE_OPTIONS', '')
  vi.stubEnv('DEEPSEEK_API_KEY', '')
  const directory = await mkdtemp(join(tmpdir(), 'kun-dsh-acp-test-'))
  directories.push(directory)
  const journal = join(directory, 'journal.jsonl')
  const definition = { ...DEEPSEEK_HARNESS_DEFINITION, launch: {
    ...DEEPSEEK_HARNESS_DEFINITION.launch!, env: { DSH_HOME: directory, FAKE_ACP_SCENARIO: scenario, FAKE_ACP_JOURNAL: journal }
  } }
  const launches: Array<{ args: readonly string[]; env: NodeJS.ProcessEnv }> = []
  const fixtureSpawn: AcpSpawnFn = async (_command, args, options) => {
    launches.push({ args, env: options.env as NodeJS.ProcessEnv })
    return spawn(process.execPath, [agent], { cwd: options.cwd, env: options.env as NodeJS.ProcessEnv, stdio: ['pipe', 'pipe', 'pipe'] })
  }
  const handshake = await probeAcpHandshake(definition, '/override/agent-binary', { spawn: fixtureSpawn })
  expect(handshake).toMatchObject({ ok: true, agent: { name: 'deepseek-harness-acp', version: '0.0.1' } })
  expect(handshake.authRequired).toBeUndefined()
  expect(handshake.authentication).not.toBe('verified')
  expect(hasDeepSeekHarnessNativeKey({ DSH_HOME: directory })).toBe(false)
  const catalog = await new AcpModelProbe({ spawn: fixtureSpawn }).probeCatalog(definition)
  expect(catalog.models).toEqual([
    '["deepseek-official","deepseek-v4-flash"]', '["deepseek-official","deepseek-flash"]', '["deepseek-official","deepseek-v4-pro"]'
  ])
  expect(catalog.modelInfo[0]?.reasoningEfforts).toEqual(['off', 'low', 'high', 'max'])
  for (const launch of launches) {
    expect(launch.env).toMatchObject({ DSH_TELEMETRY_DISABLED: '1', DSH_TELEMETRY_MODE: 'DISABLED' })
    expect(launch.args.at(-2)).toBe('--patch')
    expect(await readFile(launch.args.at(-1)!, 'utf8')).toBe(DEEPSEEK_HARNESS_PRIVACY_PATCH)
  }
  const methods = (await readFile(journal, 'utf8')).split('\n').filter(Boolean).map((line) => JSON.parse(line))
    .filter((entry) => entry.dir === 'in').map((entry) => entry.frame.method)
  expect(methods).toContain('initialize')
  expect(methods).toContain('session/new')
  expect(methods).not.toContain('authenticate')
  expect(methods).not.toContain('session/prompt')
})
