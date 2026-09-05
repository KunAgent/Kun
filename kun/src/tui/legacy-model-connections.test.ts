import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { readGuiSharedSettings } from '../cli/gui-settings-bridge.js'
import { createLegacyModelConnectionTransport } from './legacy-model-connections.js'

describe('legacy model connection transport', () => {
  const roots: string[] = []

  afterEach(async () => {
    await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })))
  })

  it('connects from the TUI, persists only encrypted credentials, and hot-applies the active runtime', async () => {
    const fixture = await createFixture()
    const settings = await readGuiSharedSettings({
      env: { KUN_GUI_SETTINGS_PATH: fixture.settingsPath },
      platform: 'darwin',
      homeDir: fixture.root
    })
    expect(settings).not.toBeNull()
    const applyRuntimeConfig = vi.fn(async () => ({ ok: true as const }))
    const notices: string[] = []
    const transport = await createLegacyModelConnectionTransport({
      dataDir: fixture.dataDir,
      guiSettings: settings!,
      disableOsKeychain: true,
      applyRuntimeConfig,
      notify: (message) => notices.push(message)
    })

    const before = await transport.modelConnections()
    expect(before.providers).toMatchObject([{ id: 'deepseek', configured: false }])
    const connected = await transport.connectModel({
      expectedRevision: before.revision,
      id: 'openai',
      name: 'OpenAI',
      kind: 'http',
      authType: 'api-key',
      baseUrl: 'https://api.openai.com/v1',
      endpointFormat: 'chat_completions',
      credential: 'sk-tui-secret',
      models: ['gpt-5.4'],
      selectedModel: 'gpt-5.4',
      probe: false,
      select: true
    })

    expect(connected).toMatchObject({ defaultProviderId: 'openai', defaultModel: 'gpt-5.4' })
    expect(connected.providers.find((provider) => provider.id === 'openai')?.configured).toBe(true)
    expect(connected.providers.find((provider) => provider.id === 'openai')
      ?.modelCapabilities?.['gpt-5.4']?.reasoning).toEqual({
        supportedEfforts: ['low', 'medium', 'high', 'max'],
        defaultEffort: 'high',
        requestProtocol: 'openai-responses'
      })
    expect(applyRuntimeConfig).toHaveBeenCalledTimes(1)
    expect(JSON.stringify(applyRuntimeConfig.mock.calls)).not.toContain('sk-tui-secret')
    expect(notices).toContain('Provider connection updated in the active runtime.')

    const settingsText = await readFile(fixture.settingsPath, 'utf8')
    const configText = await readFile(join(fixture.dataDir, 'config.json'), 'utf8')
    const credentialText = await readFile(join(fixture.dataDir, 'credentials', 'credentials.enc.json'), 'utf8')
    expect(settingsText).not.toContain('sk-tui-secret')
    expect(configText).not.toContain('sk-tui-secret')
    expect(credentialText).not.toContain('sk-tui-secret')
    expect(JSON.parse(settingsText).provider.providers.find((provider: { id: string }) => provider.id === 'openai'))
      .toMatchObject({ apiKey: '', models: ['gpt-5.4'] })
    expect(JSON.parse(configText).serve).toMatchObject({
      credentialSourceId: 'settings:provider:openai',
      model: 'gpt-5.4',
      providers: {
        openai: { apiKey: '', credentialSourceId: 'settings:provider:openai' }
      }
    })

    const removed = await transport.deleteModel('openai', connected.revision)
    expect(removed.providers.some((provider) => provider.id === 'openai')).toBe(false)
    expect(JSON.parse(await readFile(fixture.settingsPath, 'utf8')).provider.providers)
      .not.toEqual(expect.arrayContaining([expect.objectContaining({ id: 'openai' })]))
    const bindings = JSON.parse(await readFile(
      join(fixture.dataDir, 'extensions', 'legacy-credential-migrations.json'),
      'utf8'
    ))
    expect(bindings.entries['settings:provider:openai']).toBeUndefined()
    await transport.close()
  })

  it('delegates ChatGPT device authorization to the same OAuth coordinator', async () => {
    const fixture = await createFixture()
    const settings = await readGuiSharedSettings({
      env: { KUN_GUI_SETTINGS_PATH: fixture.settingsPath },
      platform: 'darwin',
      homeDir: fixture.root
    })
    const fetchImpl = vi.fn(async () => Response.json({
      device_auth_id: 'device-1',
      user_code: 'ABCD-EFGH',
      interval: 3
    })) as unknown as typeof fetch
    const transport = await createLegacyModelConnectionTransport({
      dataDir: fixture.dataDir,
      guiSettings: settings!,
      fetch: fetchImpl,
      disableOsKeychain: true,
      applyRuntimeConfig: async () => ({ ok: true })
    })
    const snapshot = await transport.modelConnections()
    const oauth = await transport.startModelOAuth({
      expectedRevision: snapshot.revision,
      provider: 'chatgpt',
      select: true
    })
    expect(oauth).toMatchObject({
      provider: 'chatgpt',
      status: 'pending',
      userCode: 'ABCD-EFGH',
      url: 'https://auth.openai.com/codex/device'
    })
    expect(fetchImpl).toHaveBeenCalledTimes(1)
    await transport.cancelModelOAuth(oauth.sessionId)
    await transport.close()
  })

  it('submits a pasted Grok callback through the legacy coordinator without writing the secret to GUI settings', async () => {
    const fixture = await createFixture()
    const settings = await readGuiSharedSettings({
      env: { KUN_GUI_SETTINGS_PATH: fixture.settingsPath },
      platform: 'darwin',
      homeDir: fixture.root
    })
    const accessToken = `x.${Buffer.from(JSON.stringify({ sub: 'grok-user' })).toString('base64url')}.x`
    const fetchImpl = vi.fn<typeof fetch>()
      .mockResolvedValueOnce(Response.json({
        authorization_endpoint: 'https://auth.x.ai/authorize',
        token_endpoint: 'https://auth.x.ai/oauth/token'
      }))
      .mockResolvedValueOnce(Response.json({
        access_token: accessToken,
        refresh_token: 'legacy-grok-refresh-secret',
        expires_in: 3600
      }))
    const transport = await createLegacyModelConnectionTransport({
      dataDir: fixture.dataDir,
      guiSettings: settings!,
      fetch: fetchImpl,
      disableOsKeychain: true,
      applyRuntimeConfig: async () => ({ ok: true })
    })
    const snapshot = await transport.modelConnections()
    const oauth = await transport.startModelOAuth({
      expectedRevision: snapshot.revision,
      provider: 'grok',
      select: true
    })
    const state = new URL(oauth.url!).searchParams.get('state')
    const completed = await transport.submitModelOAuth(
      oauth.sessionId,
      `http://127.0.0.1:65534/callback?code=legacy-browser-secret&state=${state}`
    )

    expect(completed).toMatchObject({
      status: 'connected',
      snapshot: {
        defaultProviderId: 'grok-subscription',
        defaultModel: 'grok-4.5'
      }
    })
    const settingsText = await readFile(fixture.settingsPath, 'utf8')
    expect(settingsText).not.toContain('legacy-browser-secret')
    expect(settingsText).not.toContain('legacy-grok-refresh-secret')
    expect(settingsText).toContain('grok-subscription')
    await transport.close()
  })

  it('creates a custom endpoint from a standalone TUI and projects it back to legacy GUI settings', async () => {
    const fixture = await createFixture()
    const settings = await readGuiSharedSettings({
      env: { KUN_GUI_SETTINGS_PATH: fixture.settingsPath },
      platform: 'darwin',
      homeDir: fixture.root
    })
    const applyRuntimeConfig = vi.fn(async () => ({ ok: true as const }))
    const transport = await createLegacyModelConnectionTransport({
      dataDir: fixture.dataDir,
      guiSettings: settings!,
      disableOsKeychain: true,
      applyRuntimeConfig
    })
    const before = await transport.modelConnections()
    const connected = await transport.connectModel({
      expectedRevision: before.revision,
      id: 'company-proxy',
      name: 'Company Proxy',
      kind: 'http',
      authType: 'api-key',
      baseUrl: 'https://models.company.test/v1/responses',
      endpointFormat: 'custom_endpoint',
      credential: 'company-proxy-secret',
      models: ['company-fast', 'company-reasoning'],
      selectedModel: 'company-fast',
      probe: false,
      select: true
    })

    expect(connected).toMatchObject({
      defaultProviderId: 'company-proxy',
      defaultModel: 'company-fast'
    })
    expect(connected.providers.find((provider) => provider.id === 'company-proxy')).toMatchObject({
      name: 'Company Proxy',
      endpointFormat: 'custom_endpoint',
      useProxy: false,
      configured: true,
      models: ['company-fast', 'company-reasoning']
    })
    expect(JSON.stringify(connected)).not.toContain('company-proxy-secret')
    const settingsText = await readFile(fixture.settingsPath, 'utf8')
    const configText = await readFile(join(fixture.dataDir, 'config.json'), 'utf8')
    expect(settingsText).not.toContain('company-proxy-secret')
    expect(configText).not.toContain('company-proxy-secret')
    expect(JSON.parse(settingsText).provider.providers.find(
      (provider: { id: string }) => provider.id === 'company-proxy'
    )).toMatchObject({
      name: 'Company Proxy',
      apiKey: '',
      models: ['company-fast', 'company-reasoning']
    })
    expect(JSON.parse(configText).serve.providers['company-proxy']).toMatchObject({
      apiKey: '',
      credentialSourceId: 'settings:provider:company-proxy',
      endpointFormat: 'custom_endpoint',
      models: ['company-fast', 'company-reasoning']
    })
    expect(applyRuntimeConfig).toHaveBeenCalledTimes(1)
    expect(JSON.stringify(applyRuntimeConfig.mock.calls)).not.toContain('company-proxy-secret')
    await transport.close()
  })

  async function createFixture(): Promise<{ root: string; dataDir: string; settingsPath: string }> {
    const root = await mkdtemp(join(tmpdir(), 'kun-legacy-connect-'))
    roots.push(root)
    const dataDir = join(root, '.kun', 'data')
    const settingsPath = join(root, 'Library', 'Application Support', 'Kun', 'kun-settings.json')
    await mkdir(dataDir, { recursive: true })
    await mkdir(join(settingsPath, '..'), { recursive: true })
    await writeFile(settingsPath, JSON.stringify({
      provider: {
        apiKey: '',
        providers: [{
          id: 'deepseek', name: 'DeepSeek', apiKey: '',
          baseUrl: 'https://api.deepseek.com', endpointFormat: 'chat_completions',
          models: ['deepseek-chat']
        }]
      },
      agents: {
        kun: {
          dataDir, providerId: 'deepseek', model: 'deepseek-chat',
          port: 18899, runtimeToken: 'legacy-runtime-token'
        }
      }
    }), 'utf8')
    await writeFile(join(dataDir, 'config.json'), JSON.stringify({
      serve: {
        apiKey: '', baseUrl: 'https://api.deepseek.com', model: 'deepseek-chat',
        endpointFormat: 'chat_completions', providers: {}
      }
    }), 'utf8')
    return { root, dataDir, settingsPath }
  }
})
