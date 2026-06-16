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
