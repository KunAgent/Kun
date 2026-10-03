import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, expect, it } from 'vitest'
import { deepSeekHarnessProfileFingerprint, hasDeepSeekHarnessNativeKey } from './deepseek-harness-profile.js'
import { nativeHarnessCredentialEnv } from './harness-secret-env.js'
const dirs: string[] = []
afterEach(async () => { for (const dir of dirs.splice(0)) await rm(dir, { recursive: true, force: true }) })
async function context() {
  const dir = await mkdtemp(join(tmpdir(), 'kun-dsh-profile-'))
  dirs.push(dir)
  return { dir, env: { DSH_HOME: dir } }
}
it('reads presence of the exact stock key without claiming authentication or exporting it', async () => {
  const { dir, env } = await context()
  expect(hasDeepSeekHarnessNativeKey(env)).toBe(false)
  await writeFile(join(dir, '.credentials.yaml'), 'DEEPSEEK_API_KEY: test-secret\n')
  expect(hasDeepSeekHarnessNativeKey(env)).toBe(true)
  await writeFile(join(dir, '.credentials.yaml'), 'UNRELATED_KEY: test-secret\n')
  expect(hasDeepSeekHarnessNativeKey(env)).toBe(false)
  await writeFile(join(dir, '.env'), 'export DEEPSEEK_API_KEY="dotenv-secret"\n')
  expect(hasDeepSeekHarnessNativeKey(env)).toBe(true)
})
it('does not execute tagged YAML or accept oversized credential stores', async () => {
  const { dir, env } = await context()
  for (const text of ['DEEPSEEK_API_KEY: !!js process.exit(1)', ' '.repeat(70_000)]) {
    await writeFile(join(dir, '.credentials.yaml'), text)
    expect(hasDeepSeekHarnessNativeKey(env)).toBe(false)
  }
})
it('changes its bounded opaque fingerprint on credential and composition edits', async () => {
  const { dir, env } = await context()
  const before = deepSeekHarnessProfileFingerprint(env)
  expect(deepSeekHarnessProfileFingerprint(env)).toBe(before)
  await writeFile(join(dir, '.credentials.yaml'), 'DEEPSEEK_API_KEY: secret-before\n')
  const credential = deepSeekHarnessProfileFingerprint(env)
  expect(credential).not.toBe(before)
  expect(credential).toMatch(/^[a-f0-9]{64}$/)
  await writeFile(join(dir, 'cordis.patch.yml'), '- id: hmr\n  disabled: false\n')
  expect(deepSeekHarnessProfileFingerprint(env)).not.toBe(credential)
  expect(deepSeekHarnessProfileFingerprint({ ...env, DEEPSEEK_API_KEY: 'rotated' })).not.toBe(credential)
})
it('injects only credentials for the selected native engine', () => {
  const base = { DEEPSEEK_API_KEY: 'native-key', OPENAI_API_KEY: 'other-key', KUN_BROWSER_USE_BRIDGE_TOKEN: 'host-token' }
  expect(nativeHarnessCredentialEnv({ id: 'deepseek-harness' }, base)).toEqual({ DEEPSEEK_API_KEY: 'native-key' })
  expect(nativeHarnessCredentialEnv({ id: 'custom-agent' }, base)).toEqual({})
})

it('keeps first-run stock profile bootstrap and unrelated runtime state stable', async () => {
  const { dir, env } = await context()
  const before = deepSeekHarnessProfileFingerprint(env)
  const profile = join(dir, 'profiles', 'acp')
  await mkdir(profile, { recursive: true })
  await writeFile(join(profile, 'package.json'), JSON.stringify({ name: 'dsh-profile-acp', private: true, dependencies: {},
    dsh: { profile: { bundles: ['@deepseek-ai/dsh-base', '@deepseek-ai/dsh-acp-app'] } } }, null, 2))
  await writeFile(join(profile, 'cordis.patch.yml'), '# Default user layer\n[]\n')
  await writeFile(join(profile, 'pnpm-workspace.yaml'), 'packages:\n  - .\n\nnodeLinker: hoisted\nautoInstallPeers: false\n')
  await mkdir(join(dir, 'cache'))
  expect(deepSeekHarnessProfileFingerprint(env)).toBe(before)
})
