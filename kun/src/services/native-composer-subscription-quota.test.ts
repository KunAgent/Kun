import { describe, expect, it, vi } from 'vitest'
import { nativeComposerSubscriptionProfile } from './native-composer-subscription-quota.js'
import { CODEX_DEFINITION } from '../harness/providers/codex.js'
import { CLAUDE_CODE_DEFINITION } from '../harness/providers/claude-code.js'
import { homedir } from 'node:os'

function files(values: Record<string, unknown>) {
  return vi.fn(async (path: string) => typeof values[path] === 'string' ? values[path] as string : values[path] ? JSON.stringify(values[path]) : '')
}
const codexAuth = { auth_mode: 'chatgpt', tokens: { access_token: 'fake-codex-oauth', account_id: 'fake-account' } }
const claudeAuth = { claudeAiOauth: { accessToken: 'sk-ant-oat01-fake-local' } }

describe('spawn-free native subscription identity', () => {
  it('uses Codex launch and secret env precedence for its actual auth directory', async () => {
    const readText = files({ '/selected/auth.json': codexAuth, '/home/.codex/auth.json': { OPENAI_API_KEY: 'fake-api' } })
    const profile = await nativeComposerSubscriptionProfile({ definition: { ...CODEX_DEFINITION,
      launch: { ...CODEX_DEFINITION.launch!, env: { CODEX_HOME: '/launch' }, secretEnv: [{ name: 'CODEX_HOME', secretRef: 'opaque-ref' }] } },
      resolveSecretEnv: async () => '/selected', baseEnv: { HOME: '/home', CODEX_HOME: '/ambient' }, readText })
    expect(profile).toMatchObject({ id: 'native:codex', apiKey: 'fake-codex-oauth', headers: { 'chatgpt-account-id': 'fake-account' } })
    expect(readText).toHaveBeenCalledWith('/selected/auth.json')
    expect(readText).not.toHaveBeenCalledWith('/home/.codex/auth.json')
  })

  it('uses ambient CODEX_HOME when no later launch override changes it', async () => {
    const readText = files({ '/codex-home/auth.json': codexAuth })
    expect(await nativeComposerSubscriptionProfile({ definition: CODEX_DEFINITION,
      baseEnv: { HOME: '/home', CODEX_HOME: '/codex-home' }, readText })).toMatchObject({ presetId: 'codex' })
    expect(readText).toHaveBeenCalledWith('/codex-home/auth.json')
  })

  it.each([
    { baseEnv: { HOME: '/home', OPENAI_API_KEY: 'fake-api' }, config: '' },
    { baseEnv: { HOME: '/home', OPENAI_BASE_URL: 'https://relay.example.test' }, config: '' },
    { baseEnv: { HOME: '/home' }, config: 'model_provider = "custom"' },
    { baseEnv: { HOME: '/home' }, config: '[model_providers.openai]\nbase_url = "https://relay.example.test/v1"' },
    { baseEnv: { HOME: '/home' }, config: '[model_providers.openai]\nenv_key = "ANOTHER_API_KEY"' }
  ])('does not claim a Codex subscription for API/custom routing', async ({ baseEnv, config }) => {
    expect(await nativeComposerSubscriptionProfile({ definition: CODEX_DEFINITION, baseEnv,
      readText: files({ '/home/.codex/config.toml': config, '/home/.codex/auth.json': codexAuth }) })).toBeUndefined()
  })

  it('does not reuse old OAuth tokens from an auth file switched to API-key mode', async () => {
    expect(await nativeComposerSubscriptionProfile({ definition: CODEX_DEFINITION, baseEnv: { HOME: '/home' },
      readText: files({ '/home/.codex/auth.json': { ...codexAuth, auth_mode: 'apikey', OPENAI_API_KEY: 'fake-api' } }) })).toBeUndefined()
  })

  it('matches the Claude SDK launch which strips unused config and OAuth environment overrides', async () => {
    const readText = files({ '/home/.claude/.credentials.json': claudeAuth,
      '/unused/.credentials.json': { claudeAiOauth: { accessToken: 'sk-ant-oat01-other' } } })
    const readClaudeKeychain = vi.fn(async () => '')
    const profile = await nativeComposerSubscriptionProfile({ definition: { ...CLAUDE_CODE_DEFINITION,
      launch: { command: 'claude', args: [], env: { CLAUDE_CONFIG_DIR: '/unused' } } },
      baseEnv: { HOME: '/home', CLAUDE_CONFIG_DIR: '/ambient', CLAUDE_CODE_OAUTH_TOKEN: 'sk-ant-oat01-unused' },
      readText, readClaudeKeychain, platform: 'linux' })
    expect(profile?.apiKey).toBe('sk-ant-oat01-fake-local')
    expect(readText).toHaveBeenCalledWith('/home/.claude/.credentials.json')
    expect(readText).not.toHaveBeenCalledWith('/unused/.credentials.json')
    expect(readClaudeKeychain).not.toHaveBeenCalled()
  })

  it('respects CLAUDE_CONFIG_DIR for a transport that actually receives that launch env', async () => {
    const readText = files({ '/native-config/.credentials.json': claudeAuth })
    const profile = await nativeComposerSubscriptionProfile({ definition: { ...CLAUDE_CODE_DEFINITION, transport: 'acp',
      launch: { command: 'claude-acp', args: [], env: { CLAUDE_CONFIG_DIR: '/native-config' } } },
      baseEnv: { HOME: '/home' }, readText, platform: 'linux' })
    expect(profile?.apiKey).toBe('sk-ant-oat01-fake-local')
    expect(readText).toHaveBeenCalledWith('/native-config/.credentials.json')
  })

  it.each([
    { apiKeyHelper: 'never execute this' },
    { env: { ANTHROPIC_API_KEY: 'fake-api' } },
    { env: { CLAUDE_CODE_USE_BEDROCK: '1' } },
    { env: { CLAUDE_CODE_USE_VERTEX: true } },
    { env: { ANTHROPIC_BASE_URL: 'https://relay.example.test' } }
  ])('hides quota when project Claude settings change the billing route', async (settings) => {
    const profile = await nativeComposerSubscriptionProfile({ definition: { ...CLAUDE_CODE_DEFINITION, transport: 'acp' },
      baseEnv: { HOME: '/home' }, workspaceRoot: '/workspace', platform: 'linux',
      readText: files({ '/home/.claude/.credentials.json': claudeAuth, '/workspace/.claude/settings.json': settings }) })
    expect(profile).toBeUndefined()
  })

  it('does not read any fallback account when custom native credentials are absent', async () => {
    const readText = files({ '/home/.codex/auth.json': codexAuth })
    expect(await nativeComposerSubscriptionProfile({ definition: CODEX_DEFINITION,
      baseEnv: { HOME: '/home', CODEX_HOME: '/missing' }, readText })).toBeUndefined()
    expect(readText).not.toHaveBeenCalledWith('/home/.codex/auth.json')
  })

  it('uses macOS Keychain over a stale credential file and never crosses accounts on expired Keychain data', async () => {
    const home = homedir()
    const readText = files({ [`${home}/.claude/.credentials.json`]: claudeAuth })
    const readClaudeKeychain = vi.fn(async () => JSON.stringify({ claudeAiOauth: { accessToken: 'sk-ant-oat01-keychain', expiresAt: Date.now() + 60_000 } }))
    const options = { definition: CLAUDE_CODE_DEFINITION, baseEnv: { HOME: home }, platform: 'darwin' as const, readText, readClaudeKeychain }
    expect((await nativeComposerSubscriptionProfile(options))?.apiKey).toBe('sk-ant-oat01-keychain')
    expect(readText).not.toHaveBeenCalledWith(`${home}/.claude/.credentials.json`)
    readClaudeKeychain.mockResolvedValue(JSON.stringify({ claudeAiOauth: { accessToken: 'sk-ant-oat01-keychain', expiresAt: 1 } }))
    expect(await nativeComposerSubscriptionProfile(options)).toBeUndefined()
    expect(readText).not.toHaveBeenCalledWith(`${home}/.claude/.credentials.json`)
  })

  it('does not let ignored SDK settingSources hide a valid native subscription', async () => {
    const readText = files({ '/home/.claude/.credentials.json': claudeAuth,
      '/home/.claude/settings.json': '{invalid', '/workspace/.claude/settings.json': { env: { CLAUDE_CODE_USE_BEDROCK: '1' } } })
    expect(await nativeComposerSubscriptionProfile({ definition: CLAUDE_CODE_DEFINITION, baseEnv: { HOME: '/home' },
      workspaceRoot: '/workspace', readText, platform: 'linux' })).toMatchObject({ apiKey: 'sk-ant-oat01-fake-local' })
    expect(readText).not.toHaveBeenCalledWith('/workspace/.claude/settings.json')
  })

  it('ignores unselected Codex providers, profiles and MCP credentials', async () => {
    const readText = files({ '/home/.codex/auth.json': codexAuth, '/home/.codex/config.toml': [
      'model_provider = "openai"', '[model_providers.unused]', 'base_url = "https://relay.example.test"', 'env_key = "API_KEY"',
      '[profiles.unused]', 'model_provider = "unused"', '[mcp_servers.lookup]', 'env_key = "MCP_API_KEY"'
    ].join('\n') })
    expect(await nativeComposerSubscriptionProfile({ definition: CODEX_DEFINITION, baseEnv: { HOME: '/home' }, readText }))
      .toMatchObject({ presetId: 'codex' })
    expect(await nativeComposerSubscriptionProfile({ definition: { ...CODEX_DEFINITION,
      launch: { ...CODEX_DEFINITION.launch!, args: ['app-server', '--profile', 'unused'] } }, baseEnv: { HOME: '/home' }, readText })).toBeUndefined()
  })
})
