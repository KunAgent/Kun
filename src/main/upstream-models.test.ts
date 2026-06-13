import { mkdir, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { mkdtempSync } from 'node:fs'
import { describe, expect, it, vi } from 'vitest'
import {
  defaultClawSettings,
  defaultKeyboardShortcuts,
  defaultKunRuntimeSettings,
  defaultModelProviderSettings,
  defaultScheduleSettings,
  defaultWriteSettings,
  type AppSettingsV1
} from '../shared/app-settings'
import { fetchUpstreamModelIds, readConfiguredKunModelIds } from './upstream-models'

function settings(dataDir: string, model = 'settings-model'): AppSettingsV1 {
  const provider = defaultModelProviderSettings()
  return {
    version: 1,
    locale: 'en',
    theme: 'system',
    uiFontScale: 'small',
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
    log: { enabled: false, retentionDays: 7 },
    notifications: { turnComplete: true },
    appBehavior: { openAtLogin: false, startMinimized: false, closeToTray: false },
    keyboardShortcuts: defaultKeyboardShortcuts(),
    write: defaultWriteSettings(),
    claw: defaultClawSettings(),
    schedule: defaultScheduleSettings(),
    guiUpdate: { channel: 'stable' },
    codePromptPrefix: ''
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
      expect(result.modelIds).not.toContain('auto')
      expect(result.defaultModelId).toBe('local-only-model')
      expect(result.modelGroups).toEqual(expect.arrayContaining([
        expect.objectContaining({
          providerId: 'custom-provider',
          label: 'Custom Provider',
          modelIds: expect.arrayContaining(['custom-provider-model'])
        }),
        expect.objectContaining({
          providerId: 'deepseek',
          label: 'DeepSeek',
          modelIds: expect.arrayContaining(['deepseek-chat', 'deepseek-reasoner'])
        })
      ]))
    }
  })

  it('filters speech-only upstream models out of the composer picker', async () => {
    const dataDir = mkdtempSync(join(tmpdir(), 'deepseek-gui-models-'))
    await mkdir(dataDir, { recursive: true })
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      text: async () => JSON.stringify({
        data: [
          { id: 'chat-capable-model' },
          { id: 'mimo-v2.5-asr' },
          { id: 'whisper-1' }
        ]
      })
    })
    vi.stubGlobal('fetch', fetchMock)

    try {
      const result = await fetchUpstreamModelIds(settings(dataDir), 'sk-custom')

      expect(result).toMatchObject({ ok: true })
      if (result.ok) {
        expect(result.modelIds).toContain('chat-capable-model')
        expect(result.modelIds).not.toContain('mimo-v2.5-asr')
        expect(result.modelIds).not.toContain('whisper-1')
        expect(result.modelIds).not.toContain('auto')
        expect(result.defaultModelId).toBe('settings-model')
        expect(result.modelGroups).toEqual(expect.arrayContaining([
          expect.objectContaining({
            providerId: 'custom-provider',
            modelIds: expect.arrayContaining(['chat-capable-model'])
          })
        ]))
      }
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

  it('filters image-generation and other non-text models out of the composer picker', async () => {
    const dataDir = mkdtempSync(join(tmpdir(), 'deepseek-gui-models-'))
    await mkdir(dataDir, { recursive: true })
    const base = settings(dataDir)
    const imageCapableSettings: AppSettingsV1 = {
      ...base,
      provider: {
        ...base.provider,
        providers: base.provider.providers.map((provider) =>
          provider.id === 'custom-provider'
            ? {
                ...provider,
                models: [...provider.models, 'paint-house', 'banana-canvas'],
                modelProfiles: {
                  'banana-canvas': {
                    inputModalities: ['text'],
                    outputModalities: ['image'],
                    supportsToolCalling: false,
                    messageParts: ['text']
                  }
                },
                image: {
                  protocol: 'openai-images',
                  baseUrl: 'https://custom.example/v1',
                  models: ['paint-house']
                }
              }
            : provider
        )
      }
    }
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      text: async () => JSON.stringify({
        data: [
          { id: 'chat-capable-model' },
          { id: 'paint-house' },
          { id: 'banana-canvas' },
          { id: 'dall-e-3' },
          { id: 'seedream-4-0-250828' },
          { id: 'text-embedding-3-large' },
          { id: 'wan2.2-t2v-plus' }
        ]
      })
    })
    vi.stubGlobal('fetch', fetchMock)

    try {
      const result = await fetchUpstreamModelIds(imageCapableSettings, 'sk-custom')

      expect(result).toMatchObject({ ok: true })
      if (result.ok) {
        expect(result.modelIds).toContain('chat-capable-model')
        expect(result.modelIds).not.toContain('paint-house')
        expect(result.modelIds).not.toContain('banana-canvas')
        expect(result.modelIds).not.toContain('dall-e-3')
        expect(result.modelIds).not.toContain('seedream-4-0-250828')
        expect(result.modelIds).not.toContain('text-embedding-3-large')
        expect(result.modelIds).not.toContain('wan2.2-t2v-plus')
        expect(result.modelGroups).toEqual(expect.arrayContaining([
          expect.objectContaining({
            providerId: 'custom-provider',
            modelIds: expect.arrayContaining(['chat-capable-model'])
          })
        ]))
        const customGroup = result.modelGroups?.find((group) => group.providerId === 'custom-provider')
        expect(customGroup?.modelIds).not.toContain('paint-house')
        expect(customGroup?.modelIds).not.toContain('banana-canvas')
      }
    } finally {
      vi.unstubAllGlobals()
    }
  })
})
