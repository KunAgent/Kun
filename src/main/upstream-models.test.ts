import { mkdir, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { mkdtempSync } from 'node:fs'
import { describe, expect, it, vi } from 'vitest'
import {
  defaultClawSettings,
  defaultDesignSettings,
  defaultKeyboardShortcuts,
  defaultKunRuntimeSettings,
  defaultModelProviderSettings,
  defaultScheduleSettings,
  defaultWorkflowSettings,
  defaultWriteSettings,
  defaultTerminalSettings,
  getModelProviderPreset,
  modelProviderPresetAccountProfile,
  type AppSettingsV1
} from '../shared/app-settings'
import { fetchUpstreamModelIds, readConfiguredKunModelIds } from './upstream-models'

function settings(dataDir: string, model = 'settings-model'): AppSettingsV1 {
  const provider = defaultModelProviderSettings()
  return {
    version: 1,
    locale: 'en',
    theme: 'system',
    uiFontScale: 0.82,
    chatContentMaxWidthPx: 896,
    composerSendKey: 'enter',
    provider: {
      ...provider,
      providers: [
        ...provider.providers,
        {
          id: 'custom-provider',
          name: 'Custom Provider',
          apiKey: 'sk-custom',
          baseUrl: 'https://custom.example/v1',
          endpointFormat: 'responses',
          models: ['custom-provider-model'],
          modelProfiles: {}
        }
      ]
    },
    agents: {
      kun: {
        ...defaultKunRuntimeSettings(),
        dataDir,
        model,
        providerId: 'custom-provider'
      }
    },
    workspaceRoot: '/tmp/workspace',
    conversationWorkspaceRoot: '~/Documents/Kun',
    log: { enabled: false, retentionDays: 7 },
    checkpointCleanup: { createEnabled: false, enabled: false, intervalDays: 3 },
    notifications: { turnComplete: true },
    appBehavior: { openAtLogin: false, startMinimized: false, closeToTray: false },
    keyboardShortcuts: defaultKeyboardShortcuts(),
    write: defaultWriteSettings(),
    claw: defaultClawSettings(),
    schedule: defaultScheduleSettings(),
    workflow: defaultWorkflowSettings(),
    design: defaultDesignSettings(),
    terminal: defaultTerminalSettings(),
    guiUpdate: { channel: 'stable' },
    codePromptPrefix: '',
    disabledSkillIds: []
  }
}

describe('upstream model picker list', () => {
  it('includes Kun config model profiles, aliases, and the configured agent model', async () => {
    const dataDir = mkdtempSync(join(tmpdir(), 'deepseek-gui-models-'))
    await mkdir(dataDir, { recursive: true })
    await writeFile(
      join(dataDir, 'config.json'),
      JSON.stringify({
        contextCompaction: {
          modelProfiles: {
            'legacy-model': {}
          }
        },
        models: {
          profiles: {
            'custom-model': {
              aliases: ['vendor/custom-model']
            }
          }
        }
      }),
      'utf8'
    )

    const ids = await readConfiguredKunModelIds(settings(dataDir))

    expect(ids).toEqual(expect.arrayContaining([
      'deepseek-v4-pro',
      'deepseek-v4-flash',
      'settings-model',
      'legacy-model',
      'custom-model',
      'vendor/custom-model'
    ]))
    expect(ids).not.toContain('auto')
  })

  it('falls back to configured model ids when upstream cannot be queried', async () => {
    const dataDir = mkdtempSync(join(tmpdir(), 'deepseek-gui-models-'))
    await mkdir(dataDir, { recursive: true })
    await writeFile(
      join(dataDir, 'config.json'),
      JSON.stringify({
        models: {
          profiles: {
            'deepseek-v4-flash': {
              aliases: ['deepseek-chat', 'deepseek-reasoner']
            }
          }
        }
      }),
      'utf8'
    )
    const result = await fetchUpstreamModelIds(settings(dataDir, 'local-only-model'), '')

    expect(result).toMatchObject({ ok: true })
    if (result.ok) {
      expect(result.modelIds).toContain('local-only-model')
      expect(result.modelIds).toContain('custom-provider-model')
      expect(result.modelIds).toContain('deepseek-chat')
      expect(result.modelIds).not.toContain('auto')
      expect(result.defaultModelId).toBe('local-only-model')
      expect(result.defaultModel).toEqual({
        providerId: 'custom-provider',
        modelId: 'local-only-model'
      })
      expect(result.modelGroups).toEqual(expect.arrayContaining([
        expect.objectContaining({
          providerId: 'custom-provider',
          label: 'Custom Provider',
          modelIds: expect.arrayContaining(['custom-provider-model'])
        }),
        expect.objectContaining({
          providerId: 'deepseek',
          label: 'DeepSeek',
          modelIds: expect.arrayContaining(['deepseek-v4-flash'])
        })
      ]))
      const deepseekGroup = result.modelGroups?.find((group) => group.providerId === 'deepseek')
      expect(deepseekGroup?.modelIds).not.toContain('deepseek-chat')
      expect(deepseekGroup?.modelIds).not.toContain('deepseek-reasoner')
    }
  })

  it('keeps a chat model when another provider uses the same id for media', async () => {
    const dataDir = mkdtempSync(join(tmpdir(), 'deepseek-gui-models-'))
    await mkdir(dataDir, { recursive: true })
    const configured = settings(dataDir)
    const chatProvider = configured.provider.providers.find((provider) => provider.id === 'custom-provider')!
    chatProvider.models.push('gemini-3.5-flash')
    chatProvider.modelProfiles['gemini-3.5-flash'] = {
      inputModalities: ['text', 'image'],
      outputModalities: ['text'],
      supportsToolCalling: true,
      messageParts: ['text', 'image_url']
    }
    configured.provider.providers.push({
      id: 'speech-provider',
      name: 'Speech Provider',
      apiKey: 'sk-speech',
      baseUrl: 'https://speech.example/v1',
      endpointFormat: 'chat_completions',
      models: ['speech-model'],
      modelProfiles: {},
      speech: {
        protocol: 'openai-transcriptions',
        baseUrl: 'https://speech.example/v1',
        models: ['gemini-3.5-flash']
      }
    })

    const result = await fetchUpstreamModelIds(configured)

    expect(result).toMatchObject({ ok: true })
    if (result.ok) {
      expect(result.modelIds).toContain('gemini-3.5-flash')
      expect(result.modelGroups?.find((group) => group.providerId === 'custom-provider')?.modelIds)
        .toContain('gemini-3.5-flash')
    }
  })

  it('groups multiple route aliases under one local gateway provider', async () => {
    const dataDir = mkdtempSync(join(tmpdir(), 'deepseek-gui-models-'))
    await mkdir(dataDir, { recursive: true })
    const routed = settings(dataDir)
    const deepseek = routed.provider.providers.find((provider) => provider.id === 'deepseek')!
    routed.provider.localGateway = { enabled: true, name: 'Team Relay' }
    routed.provider.routePools = [
      {
        id: 'general',
        name: 'General',
        modelId: 'team-general',
        enabled: true,
        strategy: 'priority',
        targets: [{ id: 'general-primary', providerId: deepseek.id, modelId: deepseek.models[0], enabled: true, weight: 1 }],
        failurePolicy: { failoverHttpStatusCodes: [429, 503], failoverOnNetworkError: true, failoverOnTimeout: true, failoverOnAuthError: true },
        healthPolicy: { failureThreshold: 3, cooldownMs: 60_000, halfOpenMaxAttempts: 1 }
      },
      {
        id: 'coding',
        name: 'Coding',
        modelId: 'team-coding',
        enabled: true,
        strategy: 'adaptive',
        targets: [{ id: 'coding-primary', providerId: 'custom-provider', modelId: 'custom-provider-model', enabled: true, weight: 1 }],
        failurePolicy: { failoverHttpStatusCodes: [429, 503], failoverOnNetworkError: true, failoverOnTimeout: true, failoverOnAuthError: true },
        healthPolicy: { failureThreshold: 3, cooldownMs: 60_000, halfOpenMaxAttempts: 1 }
      }
    ]

    const result = await fetchUpstreamModelIds(routed, '')

    expect(result.ok).toBe(true)
    if (result.ok) {
      const routeGroups = result.modelGroups?.filter((group) =>
        group.providerId === 'route-gateway:local'
      )
      expect(routeGroups).toHaveLength(1)
      expect(routeGroups?.[0]).toMatchObject({
        label: 'Team Relay',
        modelIds: ['team-coding', 'team-general']
      })
      expect(result.modelGroups?.some((group) => group.providerId.startsWith('route-pool:'))).toBe(false)
    }
  })

  it('keeps duplicate subscription accounts as separate composer provider groups', async () => {
    const dataDir = mkdtempSync(join(tmpdir(), 'deepseek-gui-models-'))
    await mkdir(dataDir, { recursive: true })
    const configured = settings(dataDir)
    const kimi = getModelProviderPreset('kimi-code')!
    const first = modelProviderPresetAccountProfile(kimi, 'api', [])!
    const second = modelProviderPresetAccountProfile(kimi, 'api', [first])!
    configured.provider.providers.push(first, second)

    const result = await fetchUpstreamModelIds(configured, '')

    expect(result.ok).toBe(true)
    if (result.ok) {
      expect(result.modelGroups).toEqual(expect.arrayContaining([
        expect.objectContaining({
          providerId: 'kimi-code',
          label: 'Kimi Code',
          modelIds: ['kimi-for-coding']
        }),
        expect.objectContaining({
          providerId: 'kimi-code-2',
          label: 'Kimi Code 2',
          modelIds: ['kimi-for-coding']
        })
      ]))
    }
  })

  it('keeps the configured provider on a default model id shared by multiple providers', async () => {
    const dataDir = mkdtempSync(join(tmpdir(), 'deepseek-gui-models-'))
    await mkdir(dataDir, { recursive: true })
    const configured = settings(dataDir, 'shared-model')
    configured.provider.providers = configured.provider.providers.map((provider) =>
      provider.id === 'deepseek'
        ? { ...provider, models: [...provider.models, 'shared-model'] }
        : provider.id === 'custom-provider'
          ? { ...provider, models: [...provider.models, 'shared-model'] }
          : provider
    )

    const result = await fetchUpstreamModelIds(configured)

    expect(result).toMatchObject({
      ok: true,
      defaultModel: {
        providerId: 'custom-provider',
        modelId: 'shared-model'
      }
    })
  })

  it('never queries the upstream /v1/models catalog for the composer picker (issue #337)', async () => {
    const dataDir = mkdtempSync(join(tmpdir(), 'deepseek-gui-models-'))
    await mkdir(dataDir, { recursive: true })
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      text: async () => JSON.stringify({
        data: [{ id: 'upstream-only-model' }, { id: 'another-upstream-model' }]
      })
    })
    vi.stubGlobal('fetch', fetchMock)

    try {
      const result = await fetchUpstreamModelIds(settings(dataDir), 'sk-custom')

      expect(result).toMatchObject({ ok: true })
      if (result.ok) {
        // The configured provider models are present...
        expect(result.modelIds).toContain('custom-provider-model')
        // ...but the upstream catalog is never pulled in, so a preset
        // provider's full model list no longer floods the picker.
        expect(result.modelIds).not.toContain('upstream-only-model')
        expect(result.modelIds).not.toContain('another-upstream-model')
        expect(result.modelIds).not.toContain('auto')
        const customGroup = result.modelGroups?.find((group) => group.providerId === 'custom-provider')
        expect(customGroup?.modelIds).toEqual(['custom-provider-model'])
      }
      expect(fetchMock).not.toHaveBeenCalled()
    } finally {
      vi.unstubAllGlobals()
    }
  })

  it('uses configured model ids without fetching models for custom full endpoint providers', async () => {
    const dataDir = mkdtempSync(join(tmpdir(), 'deepseek-gui-models-'))
    await mkdir(dataDir, { recursive: true })
    const fetchMock = vi.fn()
    vi.stubGlobal('fetch', fetchMock)
    const customSettings = settings(dataDir, 'custom-provider-model')
    customSettings.provider.providers = customSettings.provider.providers.map((provider) =>
      provider.id === 'custom-provider'
        ? { ...provider, baseUrl: 'https://gateway.example/custom-path', endpointFormat: 'custom_endpoint' }
        : provider
    )

    try {
      const result = await fetchUpstreamModelIds(customSettings, 'sk-custom')

      expect(result).toMatchObject({ ok: true })
      if (result.ok) {
        expect(result.modelIds).toContain('custom-provider-model')
        expect(result.defaultModelId).toBe('custom-provider-model')
      }
      expect(fetchMock).not.toHaveBeenCalled()
    } finally {
      vi.unstubAllGlobals()
    }
  })

  it('excludes configured non-text (image-output) models from the composer picker', async () => {
    const dataDir = mkdtempSync(join(tmpdir(), 'deepseek-gui-models-'))
    await mkdir(dataDir, { recursive: true })
    const base = settings(dataDir)
    const imageCapableSettings: AppSettingsV1 = {
      ...base,
      design: defaultDesignSettings(),
      provider: {
        ...base.provider,
        providers: base.provider.providers.map((provider) =>
          provider.id === 'custom-provider'
            ? {
                ...provider,
                models: [...provider.models, 'banana-canvas'],
                modelProfiles: {
                  'banana-canvas': {
                    inputModalities: ['text'],
                    outputModalities: ['image'],
                    supportsToolCalling: false,
                    messageParts: ['text']
                  }
                }
              }
            : provider
        )
      }
    }
    const fetchMock = vi.fn()
    vi.stubGlobal('fetch', fetchMock)

    try {
      const result = await fetchUpstreamModelIds(imageCapableSettings, 'sk-custom')

      expect(result).toMatchObject({ ok: true })
      if (result.ok) {
        const customGroup = result.modelGroups?.find((group) => group.providerId === 'custom-provider')
        expect(customGroup?.modelIds).toContain('custom-provider-model')
        // An image-output model added to a provider stays out of the text
        // composer picker, whether in the flat list or the provider submenu.
        expect(customGroup?.modelIds).not.toContain('banana-canvas')
        expect(result.modelIds).not.toContain('banana-canvas')
      }
      expect(fetchMock).not.toHaveBeenCalled()
    } finally {
      vi.unstubAllGlobals()
    }
  })
})
