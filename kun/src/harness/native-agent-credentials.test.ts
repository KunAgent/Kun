import { mkdir, mkdtemp, rm, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { nativeAgentCredentialFiles, nativeAgentCredentialsConfigured } from './native-agent-credentials.js'
import { nativeHarnessCredentialEnv } from './harness-secret-env.js'
import { readinessFingerprint } from './harness-readiness-profile.js'
import { HarnessCatalog } from './harness-catalog.js'

const dirs: string[] = []
afterEach(async () => { for (const dir of dirs.splice(0)) await rm(dir, { recursive: true, force: true }) })
async function fixture(id: string) {
  const dir = await mkdtemp(join(tmpdir(), 'kun-native-credentials-')); dirs.push(dir)
  const env = { HOME: dir, USERPROFILE: dir, XDG_CONFIG_HOME: join(dir, '.config'), APPDATA: join(dir, 'AppData') }
  const files = nativeAgentCredentialFiles(id, env)
  for (const path of files) await mkdir(dirname(path), { recursive: true })
  return { dir, env, files }
}

describe('known native Agent credential evidence', () => {
  it.each([
    ['gemini-cli', 'GEMINI_API_KEY'], ['copilot', 'COPILOT_GITHUB_TOKEN'],
    ['goose', 'OPENAI_API_KEY'], ['droid', 'FACTORY_API_KEY'],
    ['qoder', 'QODER_PERSONAL_ACCESS_TOKEN'], ['qoder-cn', 'QODERCN_PERSONAL_ACCESS_TOKEN']
  ])('recognizes only the selected %s token and forwards it under that profile', async (id, key) => {
    const f = await fixture(id)
    const env = { ...f.env, [key]: 'fixture-key', UNRELATED_API_KEY: 'unrelated' }
    expect(nativeAgentCredentialsConfigured(id, env)).toBe(true)
    expect(nativeAgentCredentialsConfigured('unknown-agent', env)).toBe(false)
    expect(nativeHarnessCredentialEnv({ id }, env)).toMatchObject({ [key]: 'fixture-key' })
    expect(nativeHarnessCredentialEnv({ id: 'unknown-agent' }, env)).toEqual({})
    expect(nativeHarnessCredentialEnv({ id }, env)).not.toHaveProperty('UNRELATED_API_KEY')
  })

  it('requires both real Gemini OAuth token fields, never an account name alone', async () => {
    const f = await fixture('gemini-cli')
    await writeFile(f.files[0]!, JSON.stringify({ access_token: 'fixture-access', refresh_token: 'fixture-refresh' }))
    expect(nativeAgentCredentialsConfigured('gemini-cli', f.env)).toBe(true)
    await writeFile(f.files[0]!, JSON.stringify({ account: 'account', access_token: '' }))
    expect(nativeAgentCredentialsConfigured('gemini-cli', f.env)).toBe(false)
  })

  it('does not borrow a global Qoder token for the independent Qoder CN account', async () => {
    const f = await fixture('qoder-cn')
    expect(nativeAgentCredentialsConfigured('qoder-cn', { ...f.env, QODER_PERSONAL_ACCESS_TOKEN: 'global-token' })).toBe(false)
    expect(nativeHarnessCredentialEnv({ id: 'qoder-cn' }, { ...f.env, QODER_PERSONAL_ACCESS_TOKEN: 'global-token' })).toEqual({})
  })

  it('reads Kimi provider keys, explicit environment references and its OAuth file', async () => {
    const f = await fixture('kimi')
    expect(nativeAgentCredentialsConfigured('kimi', { ...f.env, KIMI_API_KEY: 'ambient-only' })).toBe(false)
    await writeFile(f.files[0]!, '[providers.test]\napi_key_env = "MY_KIMI_KEY"\n')
    const env = { ...f.env, MY_KIMI_KEY: 'configured-key' }
    expect(nativeAgentCredentialsConfigured('kimi', env)).toBe(true)
    expect(nativeHarnessCredentialEnv({ id: 'kimi' }, env)).toEqual({ MY_KIMI_KEY: 'configured-key' })
    await writeFile(f.files[0]!, '[models.test]\napi_key = "not-a-provider-key"\n')
    expect(nativeAgentCredentialsConfigured('kimi', f.env)).toBe(false)
    await writeFile(f.files[1]!, JSON.stringify({ access_token: 'access', refresh_token: 'refresh' }))
    expect(nativeAgentCredentialsConfigured('kimi', f.env)).toBe(true)
  })

  it('does not treat retired Kimi credentials as the new CLI login', async () => {
    const f = await fixture('kimi')
    const legacy = join(f.dir, '.kimi', 'credentials', 'kimi-code.json')
    await mkdir(dirname(legacy), { recursive: true })
    await writeFile(legacy, JSON.stringify({ access_token: 'old-access', refresh_token: 'old-refresh' }))
    expect(nativeAgentCredentialsConfigured('kimi', f.env)).toBe(false)
  })

  it('recognizes Goose file-based secrets but rejects ordinary provider settings', async () => {
    const f = await fixture('goose')
    await writeFile(f.files[0]!, 'OPENAI_API_KEY: fixture-key\n')
    expect(nativeAgentCredentialsConfigured('goose', f.env)).toBe(true)
    await writeFile(f.files[0]!, 'active_provider: openai\nconfigured: true\n')
    expect(nativeAgentCredentialsConfigured('goose', f.env)).toBe(false)
  })

  it('checks the selected Cline provider without borrowing a different provider credential', async () => {
    const f = await fixture('cline')
    await writeFile(f.files[0]!, JSON.stringify({ lastUsedProvider: 'selected', providers: {
      selected: { settings: { apiKey: 'selected-key' } }, other: { settings: { apiKey: 'other-key' } }
    } }))
    expect(nativeAgentCredentialsConfigured('cline', f.env)).toBe(true)
    await writeFile(f.files[0]!, JSON.stringify({ lastUsedProvider: 'missing', providers: { other: { settings: { apiKey: 'other-key' } } } }))
    expect(nativeAgentCredentialsConfigured('cline', f.env)).toBe(false)
  })

  it('checks MiniMax BYOK and native auth fields without accepting model metadata', async () => {
    const f = await fixture('minimax-code')
    await writeFile(f.files[0]!, 'defaultModel: custom_provider:test/model\ncustom_provider:\n  test:\n    options:\n      apiKey: fixture-key\n')
    expect(nativeAgentCredentialsConfigured('minimax-code', f.env)).toBe(true)
    await writeFile(f.files[0]!, 'defaultModel: model\nminimax_api:\n  apiKey: ""\n')
    expect(nativeAgentCredentialsConfigured('minimax-code', f.env)).toBe(false)
    await writeFile(f.files[1]!, JSON.stringify({ version: 1, auth: { accessToken: 'fixture-token' } }))
    expect(nativeAgentCredentialsConfigured('minimax-code', f.env)).toBe(true)
  })

  it('rejects linked and oversized credential files', async () => {
    const f = await fixture('gemini-cli')
    const target = join(f.dir, 'linked.json')
    await writeFile(target, JSON.stringify({ access_token: 'access', refresh_token: 'refresh' }))
    await symlink(target, f.files[0]!)
    expect(nativeAgentCredentialsConfigured('gemini-cli', f.env)).toBe(false)
    await rm(f.files[0]!)
    await writeFile(f.files[0]!, ' '.repeat(65 * 1024))
    expect(nativeAgentCredentialsConfigured('gemini-cli', f.env)).toBe(false)
  })

  it('changes readiness identity when a native credential file rotates', async () => {
    const f = await fixture('kimi')
    const base = new HarnessCatalog().get('opencode')!
    const definition = { ...base, id: 'kimi', launch: { command: 'kimi', args: ['acp'], env: f.env } }
    const input = { options: {}, definition, route: { harnessId: 'kimi', credentialMode: 'native-login' as const, model: 'default' }, secretEnv: {} }
    const before = readinessFingerprint(input)
    await writeFile(f.files[1]!, JSON.stringify({ access_token: 'access', refresh_token: 'refresh' }))
    expect(readinessFingerprint(input)).not.toBe(before)
  })
})

it('cannot select private host control tokens through a provider environment reference', async () => {
  const f = await fixture('kimi')
  await mkdir(dirname(f.files[0]!), { recursive: true })
  await writeFile(f.files[0]!, '[providers.selected]\napi_key_env = "KUN_RUNTIME_TOKEN"\n')
  const env = { ...f.env, KUN_RUNTIME_TOKEN: 'private-control-token' }
  expect(nativeHarnessCredentialEnv({ id: 'kimi' }, env)).not.toHaveProperty('KUN_RUNTIME_TOKEN')
  const { nativeHasKey } = await import('./harness-readiness-profile.js')
  const definition = new HarnessCatalog().get('kimi')!
  expect(nativeHasKey({ ...definition, launch: { ...definition.launch!, env } }, {})).toBe(false)
})
