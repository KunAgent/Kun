import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { createAcpCredentialEnv } from './acp-credential-env.js'
import { HarnessTokenService } from '../../harness/harness-token-service.js'
import { BUILTIN_HARNESSES } from '../../harness/builtin-harnesses.js'
import type { HarnessId } from '../../contracts/harness.js'

const dirs: string[] = []

function makeResolver(harnessId: HarnessId, endpoint = 'http://127.0.0.1:18899/') {
  const configDir = mkdtempSync(join(tmpdir(), 'acp-gateway-'))
  dirs.push(configDir)
  const tokens = new HarnessTokenService({ secret: Buffer.alloc(32, 7) })
  const env = createAcpCredentialEnv({
    tokens,
    endpoint: () => endpoint,
    configDir: () => configDir
  })
  const gateway = BUILTIN_HARNESSES.find((d) => d.id === harnessId)?.gateway
  return { configDir, tokens, env, gateway }
}

afterEach(() => {
  while (dirs.length) rmSync(dirs.pop()!, { recursive: true, force: true })
})

describe('createAcpCredentialEnv', () => {
  const base = {
    threadId: 'thr_1',
    turnId: 'turn_1',
    credentialIdentity: 'kun-gateway:x'
  } as const

  it('returns nothing for native-login', async () => {
    const { env } = makeResolver('opencode')
    await expect(
      env({ ...base, harnessId: 'opencode', credentialMode: 'native-login' })
    ).resolves.toEqual({})
  })

  it('rejects non-gateway modes and missing endpoint/route inputs', async () => {
    const { env } = makeResolver('opencode')
    const input = {
      ...base,
      harnessId: 'opencode' as const,
      credentialMode: 'provider' as const
    }
    await expect(env(input)).rejects.toThrow('credentialMode')
    const { env: offline, gateway } = makeResolver('opencode', '')
    await expect(
      offline({ ...base, harnessId: 'opencode', credentialMode: 'kun-gateway', providerId: 'deepseek', model: 'deepseek-chat', gateway })
    ).rejects.toThrow('serve-hosted')
    await expect(
      env({ ...base, harnessId: 'opencode', credentialMode: 'kun-gateway', gateway })
    ).rejects.toThrow('provider/model')
    await expect(
      env({ ...base, harnessId: 'gemini-cli', credentialMode: 'kun-gateway', providerId: 'deepseek', model: 'deepseek-chat' })
    ).rejects.toThrow('no gateway surface')
  })

  it('issues a route-restricted grant and a provider-only opencode config', async () => {
    const { env, tokens, gateway } = makeResolver('opencode')
    const child = await env({
      ...base,
      harnessId: 'opencode',
      credentialMode: 'kun-gateway',
      providerId: 'deepseek',
      model: 'deepseek-chat',
      gateway
    })
    expect(child).toMatchObject({
      KUN_GATEWAY_BASE_URL: 'http://127.0.0.1:18899/v1'
    })
    const token = child.KUN_GATEWAY_TOKEN ?? ''
    expect(token.startsWith('kgw_')).toBe(true)
    const grant = tokens.verifyScope(token, 'gateway')
    expect(grant).toMatchObject({
      threadId: 'thr_1',
      harnessId: 'opencode',
      routes: [{ providerId: 'deepseek', model: 'deepseek-chat', role: 'main' }]
    })
    const config = JSON.parse(readFileSync(child.OPENCODE_CONFIG!, 'utf8')) as {
      provider: { kun: { npm: string; options: { baseURL: string; apiKey: string }; models: Record<string, unknown> } }
      model: string
    }
    expect(config.provider.kun.npm).toBe('@ai-sdk/openai-compatible')
    expect(config.provider.kun.options).toEqual({
      baseURL: 'http://127.0.0.1:18899/v1',
      // The token stays an env reference — never materialized on disk.
      apiKey: '{env:KUN_GATEWAY_TOKEN}'
    })
    expect(config.provider.kun.models['kun/deepseek/deepseek-chat']).toBeDefined()
    expect(config.model).toBe('kun/kun/deepseek/deepseek-chat')
    expect(readFileSync(child.OPENCODE_CONFIG!, 'utf8')).not.toContain(token)
  })

  it('parses kun/<provider>/<model> routes back to a bare grant pair', async () => {
    const { env, tokens, gateway } = makeResolver('opencode')
    const child = await env({
      ...base,
      harnessId: 'opencode',
      credentialMode: 'kun-gateway',
      model: 'kun/deepseek/deepseek-chat',
      gateway
    })
    const grant = tokens.verifyScope(child.KUN_GATEWAY_TOKEN!, 'gateway')
    expect(grant?.routes).toEqual([
      { providerId: 'deepseek', model: 'deepseek-chat', role: 'main' }
    ])
  })

  it('generates a CODEX_HOME config.toml wiring a responses provider', async () => {
    const { env, gateway } = makeResolver('codex')
    const child = await env({
      ...base,
      harnessId: 'codex',
      credentialMode: 'kun-gateway',
      providerId: 'openai',
      model: 'gpt-5.2-codex',
      gateway
    })
    expect(child.CODEX_HOME).toBeTruthy()
    const toml = readFileSync(join(child.CODEX_HOME!, 'config.toml'), 'utf8')
    expect(toml).toContain('model_provider = "kun"')
    expect(toml).toContain('model = "kun/openai/gpt-5.2-codex"')
    expect(toml).toContain('base_url = "http://127.0.0.1:18899/v1"')
    expect(toml).toContain('env_key = "KUN_GATEWAY_TOKEN"')
    expect(toml).toContain('wire_api = "responses"')
    expect(toml).not.toContain(child.KUN_GATEWAY_TOKEN!)
  })

  it('is byte-stable for the same identity so the connection pool reuses it', async () => {
    const { env, gateway } = makeResolver('opencode')
    const input = {
      ...base,
      harnessId: 'opencode' as const,
      credentialMode: 'kun-gateway' as const,
      providerId: 'deepseek',
      model: 'deepseek-chat',
      gateway
    }
    expect(await env(input)).toEqual(await env(input))
  })
})
