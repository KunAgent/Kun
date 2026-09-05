import { describe, expect, it } from 'vitest'
import { normalizeAppSettings, type AppSettingsV1 } from '@shared/app-settings'
import { parseSettingsSaveIssue, settingsSaveIssueMessage } from './settings-save-error'

describe('parseSettingsSaveIssue', () => {
  it('resolves the provider, model, field, value, and limit from a settings:set error', () => {
    const base = normalizeAppSettings({} as never)
    const snapshot = {
      ...base,
      provider: {
        ...base.provider,
        providers: [...base.provider.providers, {
          id: 'zenmux',
          name: 'ZenMux',
          apiKey: '',
          baseUrl: 'https://zenmux.ai/api/v1',
          endpointFormat: 'chat_completions',
          useProxy: false,
          models: ['qwen/qwen3.5-flash'],
          modelProfiles: {
            'qwen/qwen3.5-flash': {
              inputModalities: ['text'],
              outputModalities: ['text'],
              supportsToolCalling: true,
              messageParts: ['text'],
              maxOutputTokens: 1_020_000
            }
          }
        }]
      }
    } as AppSettingsV1
    const index = snapshot.provider.providers.findIndex((provider) => provider.id === 'zenmux')
    const issue = parseSettingsSaveIssue(
      `Error invoking remote method 'settings:set': Error: Invalid payload for settings:set: ` +
      `provider.providers.${index}.modelProfiles.qwen/qwen3.5-flash.maxOutputTokens: ` +
      'Too big: expected number to be <=1000000',
      snapshot
    )

    expect(issue).toEqual(expect.objectContaining({
      providerId: 'zenmux',
      providerName: 'ZenMux',
      modelId: 'qwen/qwen3.5-flash',
      field: 'maxOutputTokens',
      actualValue: 1_020_000,
      maxAllowed: 1_000_000
    }))
    expect(settingsSaveIssueMessage(issue!, (key, params) => {
      if (key === 'providerModelFieldMaxOutput') return 'Max output'
      return `${params?.provider}/${params?.model}: ${params?.field} ${params?.value} > ${params?.max}`
    })).toBe('ZenMux/qwen/qwen3.5-flash: Max output 1,020,000 > 1,000,000')
  })
})
