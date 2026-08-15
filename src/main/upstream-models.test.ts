import { mkdir, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { homedir, tmpdir } from 'node:os'
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
import {
  fetchUpstreamModelIds,
  modelListFromSharedConnections,
  readConfiguredKunModelIds
} from './upstream-models'

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
    chatWelcomeMessage: '',
    codeAgentPresets: [],
    disabledSkillIds: []
  }
}

describe('upstream model picker list', () => {
  it('uses the latest configured name for a live custom provider', () => {
    const result = modelListFromSharedConnections({
      schemaVersion: 1,
      providers: [{
        id: 'custom-provider-10',
        name: 'custom-provider-10',
        configured: true,
        credentialStatus: 'ready',
        models: ['custom-model'],
        modelCapabilities: {
          'custom-model': {
            inputModalities: ['text', 'image'],
            outputModalities: ['text'],
            supportsToolCalling: true,
            messageParts: ['text', 'image_url']
          }
        }
      }]
    }, 'Kun API', new Map([['custom-provider-10', 'My Gateway']]))

    expect(result).toMatchObject({
      ok: true,
      modelGroups: [expect.objectContaining({
        providerId: 'custom-provider-10',
        label: 'My Gateway',
        modelIds: ['custom-model'],
        modelProfiles: {
          'custom-model': expect.objectContaining({
            inputModalities: ['text', 'image'],
            supportsToolCalling: true
          })
        }
      })]
    })
  })

  it('preserves the live label when no configured provider name matches', () => {
    const result = modelListFromSharedConnections({
      schemaVersion: 1,
      providers: [{
        id: 'runtime-only',
        name: 'Runtime Only',
        configured: true,
        credentialStatus: 'ready',
        models: ['runtime-model']
      }]
    }, 'Kun API', new Map([['other-provider', 'Other Provider']]))

    expect(result).toMatchObject({
      ok: true,
      modelGroups: [expect.objectContaining({
        providerId: 'runtime-only',
        label: 'Runtime Only',
        modelIds: ['runtime-model']
      })]
    })
  })

  it('preserves Codex preset identity and Fast service-tier capability from the live registry', () => {
    const result = modelListFromSharedConnections({
      schemaVersion: 1,
      providers: [{
        id: 'codex-2',
        name: 'ChatGPT subscription 2',
        presetSource: 'codex',
        configured: true,
        models: ['gpt-5.4'],
        modelCapabilities: {
          'gpt-5.4': {
            inputModalities: ['text', 'image'],
            outputModalities: ['text'],
            supportsToolCalling: true,
            messageParts: ['text', 'image_url'],
            serviceTiers: ['priority']
          }
        }
      }]
    })

    expect(result).toMatchObject({
      ok: true,
      modelGroups: [{
        providerId: 'codex-2',
        presetSource: 'codex',
        modelProfiles: {
          'gpt-5.4': { serviceTiers: ['priority'] }
        }
      }]
    })
  })

  it('excludes providers whose protected credential is missing or unreadable', () => {
    const result = modelListFromSharedConnections({
      schemaVersion: 1,
      providers: [
        {
          id: 'healthy',
          name: 'Healthy',
          configured: true,
          credentialStatus: 'ready',
          models: ['healthy-model']
        },
        {
          id: 'missing',
          name: 'Missing',
          configured: true,
          credentialStatus: 'missing',
          models: ['missing-model']
        },
        {
          id: 'unreadable',
          name: 'Unreadable',
          configured: true,
          credentialStatus: 'unreadable',
          credentialErrorCode: 'credential_unreadable',
          models: ['unreadable-model']
        }
      ],
      defaultModel: 'unreadable-model'
    })

    expect(result).toMatchObject({
      ok: true,
      modelIds: ['healthy-model'],
      modelGroups: [{ providerId: 'healthy', modelIds: ['healthy-model'] }]
    })
    expect(JSON.stringify(result)).not.toContain('missing-model')
    expect(JSON.stringify(result)).not.toContain('unreadable-model')
    expect(result).not.toHaveProperty('defaultModelId')
  })

  it('includes executable route aliases from the live registry', () => {
    const result = modelListFromSharedConnections({
      schemaVersion: 1,
      providers: [
        {
          id: 'kimi-code',
          name: 'Kimi Code',
          configured: true,
          credentialStatus: 'ready',
          models: ['k3'],
          modelCapabilities: {
            k3: {
              inputModalities: ['text', 'image'],
              outputModalities: ['text'],
              supportsToolCalling: true,
              messageParts: ['text', 'image_url'],
              contextWindowTokens: 262_144
            }
          }
        },
        {
          id: 'missing-provider',
          name: 'Missing Provider',
          configured: true,
          credentialStatus: 'missing',
          models: ['missing-model']
        }
      ],
      routePools: [
        {
          id: 'k3-route',
          name: 'K3 Route',
          modelId: 'k3-local',
          enabled: true,
          targets: [
            { id: 'kimi', providerId: 'kimi-code', modelId: 'k3', enabled: true, weight: 1 }
          ]
        },
        {
          id: 'missing-route',
          name: 'Missing Route',
          modelId: 'missing-local',
          enabled: true,
          targets: [
            { id: 'missing', providerId: 'missing-provider', modelId: 'missing-model', enabled: true, weight: 1 }
          ]
        },
        {
          id: 'disabled-route',
          name: 'Disabled Route',
          modelId: 'disabled-local',
          enabled: false,
          targets: [
            { id: 'kimi-disabled', providerId: 'kimi-code', modelId: 'k3', enabled: true, weight: 1 }
          ]
        }
      ]
    }, 'Team Relay')

    expect(result).toMatchObject({
      ok: true,
      modelIds: expect.arrayContaining(['k3', 'k3-local']),
      modelGroups: expect.arrayContaining([expect.objectContaining({
        providerId: 'route-gateway:local',
        label: 'Team Relay',
        modelIds: ['k3-local'],
        modelProfiles: {
          'k3-local': expect.objectContaining({
            inputModalities: ['text', 'image'],
            contextWindowTokens: 262_144
          })
        }
      })])
    })
    if (result?.ok) {
      expect(result.modelIds).not.toContain('missing-local')
      expect(result.modelIds).not.toContain('disabled-local')
    }
  })

  it('never reads the canonical legacy config as a model source', async () => {
    await expect(readConfiguredKunModelIds(
      settings(join(homedir(), '.deepseekgui', 'kun'))
    )).rejects.toThrow(/migration is required/)
  })

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
          modelIds: expect.arrayContaining(['kimi-for-coding'])
        }),
        expect.objectContaining({
          providerId: 'kimi-code-2',
          label: 'Kimi Code 2',
          modelIds: expect.arrayContaining(['kimi-for-coding'])
        })
      ]))
    }
  })

  it('projects Fast capability for a second ChatGPT subscription account', async () => {
    const dataDir = mkdtempSync(join(tmpdir(), 'deepseek-gui-models-'))
    await mkdir(dataDir, { recursive: true })
    const configured = settings(dataDir)
    const codex = getModelProviderPreset('codex')!
    const first = modelProviderPresetAccountProfile(codex, 'api', [])!
    const second = modelProviderPresetAccountProfile(codex, 'api', [first])!
    configured.provider.providers.push(first, second)

    const result = await fetchUpstreamModelIds(configured, '')

    expect(result.ok).toBe(true)
    if (result.ok) {
      const group = result.modelGroups?.find((candidate) => candidate.providerId === 'codex-2')
      expect(group).toMatchObject({
        presetSource: 'codex',
        modelProfiles: {
          'gpt-5.4': {
            serviceTiers: ['priority']
          }
        }
      })
      expect(group?.modelProfiles?.['gpt-5.4-mini']?.serviceTiers).toBeUndefined()
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
