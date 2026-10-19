import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, expect, it, vi } from 'vitest'
import type { HarnessStatus } from '../contracts/harness.js'
import type { HarnessReadinessDeps } from './harness-readiness.js'

const dirs: string[] = []
afterEach(async () => {
  vi.resetModules()
  for (const dir of dirs.splice(0)) await rm(dir, { recursive: true, force: true })
})

/** A fresh module graph stands in for a new Runtime process: module-level salts are regenerated. */
async function freshProcess() {
  vi.resetModules()
  const [{ HarnessReadinessService }, { HarnessCatalog }, { HarnessesConfigSchema }] = await Promise.all([
    import('./harness-readiness.js'), import('./harness-catalog.js'), import('../config/kun-config-harnesses.js')
  ])
  return { HarnessReadinessService, HarnessCatalog, HarnessesConfigSchema }
}

it('keeps restored proofs across a Runtime restart instead of re-spawning the Agent', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'kun-readiness-restart-')); dirs.push(dir)
  const command = join(dir, 'opencode'); await writeFile(command, '#!/bin/sh\nexit 0\n')
  const proofStorePath = join(dir, 'harness-readiness.json')
  const handshake = vi.fn<NonNullable<HarnessReadinessDeps['handshake']>>(async () => ({ ok: true, supported: true, protocol: 'acp' }))
  const detector = { status: vi.fn(async (): Promise<HarnessStatus> => ({ harnessId: 'opencode', installed: 'yes' as const,
    login: 'unknown' as const, ready: 'yes' as const, resolvedCommand: command, checkedAt: '2026-10-19T00:00:00.000Z' })) }
  const start = async () => {
    const modules = await freshProcess()
    const options = { model: 'model-a', providers: {
      'account-a': { kind: 'http' as const, apiKey: 'secret-a', baseUrl: 'https://api.example.com', models: ['model-a'] }
    }, harnesses: modules.HarnessesConfigSchema.parse({ binaryPaths: { opencode: command },
      defaults: { opencode: { credentialMode: 'kun-gateway', providerId: 'account-a', model: 'model-a' } },
      enabledProfiles: [{ harnessId: 'opencode', credentialMode: 'kun-gateway', providerId: 'account-a' }] }) }
    const catalog = new modules.HarnessCatalog({ custom: () => [], enabledProfiles: () => options.harnesses.enabledProfiles })
    return new modules.HarnessReadinessService({ options: () => options, catalog, detector, handshake, revision: () => 1, proofStorePath })
  }

  const first = await start()
  first.warmProfiles('opencode')
  await vi.waitFor(() => expect(first.checking('opencode')).toBe(false))
  await vi.waitFor(async () => expect(JSON.parse(await readFile(proofStorePath, 'utf8')).proofs).toHaveLength(1), { timeout: 3_000 })
  expect(handshake).toHaveBeenCalledTimes(1)

  const restarted = await start()
  expect(await restarted.readyProfiles('opencode')).toHaveLength(1)
  restarted.warmProfiles('opencode')
  await vi.waitFor(() => expect(restarted.checking('opencode')).toBe(false))
  expect(handshake).toHaveBeenCalledTimes(1)
})

it('derives the DeepSeek harness profile fingerprint the same way in every process', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'kun-dsh-fingerprint-')); dirs.push(dir)
  const env = { DSH_HOME: dir, DEEPSEEK_API_KEY: 'test-key' }
  vi.resetModules()
  const before = (await import('./deepseek-harness-profile.js')).deepSeekHarnessProfileFingerprint(env)
  vi.resetModules()
  const after = (await import('./deepseek-harness-profile.js')).deepSeekHarnessProfileFingerprint(env)
  expect(after).toBe(before)
  expect((await import('./deepseek-harness-profile.js')).deepSeekHarnessProfileFingerprint({ ...env, DEEPSEEK_API_KEY: 'rotated' }))
    .not.toBe(before)
})

it('changes the network identity when the proxy changes, but not between processes', async () => {
  const definition = { id: 'opencode', transport: 'acp', launch: { command: 'opencode', args: ['acp'] } } as never
  vi.resetModules()
  const first = (await import('./native-agent-network.js')).nativeAgentNetworkIdentity(definition, {})
  vi.resetModules()
  const network = await import('./native-agent-network.js')
  expect(network.nativeAgentNetworkIdentity(definition, {})).toBe(first)
  expect(network.nativeAgentNetworkIdentity(definition, { HTTPS_PROXY: 'http://127.0.0.1:7890' })).not.toBe(first)
  expect(network.nativeAgentNetworkStatus(definition, {}).networkFingerprint).not.toBe(first)
})
