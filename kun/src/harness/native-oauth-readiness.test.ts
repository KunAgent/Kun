import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { tmpdir } from 'node:os'
import { afterEach, describe, expect, it } from 'vitest'
import { HarnessCatalog } from './harness-catalog.js'
import { nativeCredentialFiles, nativeHasKey, readinessFingerprint } from './harness-readiness-profile.js'
import { HarnessReadinessService } from './harness-readiness.js'

const dirs: string[] = []
afterEach(async () => { for (const dir of dirs.splice(0)) await rm(dir, { recursive: true, force: true }) })
async function fixture(id: string) {
  const dir = await mkdtemp(join(tmpdir(), 'native-oauth-readiness-')); dirs.push(dir)
  const env = { HOME: dir, USERPROFILE: dir, APPDATA: dir, XDG_DATA_HOME: dir, PI_CODING_AGENT_DIR: dir }
  const catalog = new HarnessCatalog()
  const definition = { ...catalog.get(id)!, launch: { command: id, args: [], env } }
  const path = nativeCredentialFiles(definition)[0]!
  await mkdir(dirname(path), { recursive: true })
  return { definition, path, env, catalog }
}

describe('native credential evidence', () => {
  it.each(['pi', 'opencode'])('accepts complete %s OAuth as configured but unverified', async (id) => {
    const f = await fixture(id)
    await writeFile(f.path, JSON.stringify({ provider: { type: 'oauth', access: 'fixture-access', refresh: 'fixture-refresh', expires: Date.now() + 60_000 } }))
    expect(nativeHasKey(f.definition, f.env)).toBe(true)
    const service = new HarnessReadinessService({ options: () => ({}), catalog: { get: () => f.definition,
      isProfileEnabled: () => false } as unknown as HarnessCatalog,
      detector: { status: async () => ({ harnessId: id, installed: 'yes', login: 'unknown', checkedAt: new Date().toISOString() }) },
      handshake: async () => ({ ok: true, supported: true, protocol: id }) })
    const result = await service.test(f.definition, { level: 'handshake', credentialMode: 'native-login' })
    expect(result).toMatchObject({ ok: true, readiness: { authentication: 'unverified' } })
    for (const value of [{}, { type: 'oauth' }, { type: 'oauth', access: '', refresh: 'fixture', expires: 10 }]) {
      await writeFile(f.path, JSON.stringify({ provider: value }))
      expect(nativeHasKey(f.definition, f.env)).toBe(false)
    }
  })
  it('invalidates Devin readiness when its native credential file changes', async () => {
    const f = await fixture('devin')
    const input = { options: {}, definition: f.definition, route: { harnessId: 'devin', credentialMode: 'native-login' as const, model: 'default' }, secretEnv: {} }
    const initial = readinessFingerprint(input)
    await writeFile(f.path, 'token = "fixture-one"')
    const loggedIn = readinessFingerprint(input)
    expect(loggedIn).not.toBe(initial)
    await writeFile(f.path, 'token = "fixture-two"')
    expect(readinessFingerprint(input)).not.toBe(loggedIn)
  })
})
