import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, expect, it, vi } from 'vitest'
import { HarnessesConfigSchema } from '../config/kun-config-harnesses.js'
import { HarnessCatalog } from './harness-catalog.js'
import { HarnessReadinessService } from './harness-readiness.js'
import { probeFxNativeCredentials } from './fx-native-credential-probe.js'

vi.mock('./fx-native-credential-probe.js', () => ({ probeFxNativeCredentials: vi.fn() }))
const directories: string[] = []
afterEach(async () => {
  vi.unstubAllEnvs(); vi.clearAllMocks()
  for (const path of directories.splice(0)) await rm(path, { recursive: true, force: true })
})

it.each([true, false, 'unknown'] as const)('admits fx Keychain configured=%s only with a successful native protocol check', async (configured) => {
  const home = await mkdtemp(join(tmpdir(), 'kun-fx-readiness-')); directories.push(home)
  vi.stubEnv('HOME', home); vi.stubEnv('AI_GATEWAY_API_KEY', ''); vi.stubEnv('VERCEL_OIDC_TOKEN', '')
  const command = join(home, 'fx'); await writeFile(command, 'fixture executable')
  const options = { harnesses: HarnessesConfigSchema.parse({ enabledProfiles: [{ harnessId: 'fx', credentialMode: 'native-login' }] }) }
  const catalog = new HarnessCatalog({ custom: () => [], enabledProfiles: () => options.harnesses.enabledProfiles })
  const handshake = vi.fn(async () => ({ ok: true, supported: true, protocol: 'acp' }))
  const service = new HarnessReadinessService({ options: () => options, catalog, handshake,
    detector: { status: async () => ({ harnessId: 'fx', installed: 'yes', resolvedCommand: command, login: 'unknown', checkedAt: '2026-10-06T00:00:00.000Z' }) } })
  vi.mocked(probeFxNativeCredentials).mockResolvedValue({ configured, authentication: configured === false ? 'missing' : 'unverified' })
  const result = await service.test(catalog.get('fx')!, { level: 'handshake', credentialMode: 'native-login', model: 'default' })
  expect(result.ok).toBe(configured === true)
  expect(result.readiness?.authentication).toBe(configured === true ? 'unverified' : 'missing')
  expect(probeFxNativeCredentials).toHaveBeenCalledWith(command, expect.objectContaining({
    signal: expect.any(AbortSignal), env: expect.objectContaining({ FX_AUTO_UPGRADE: '0' })
  }))
  expect(handshake).toHaveBeenCalledOnce()
})
