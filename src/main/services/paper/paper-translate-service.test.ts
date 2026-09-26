import { describe, expect, it } from 'vitest'
import {
  normalizeAppSettings,
  resolveKunRuntimeSettings,
  type AppSettingsV1
} from '../../../shared/app-settings'
import { resolvePaperTranslateModel } from './paper-translate-service'

function settingsWith(paperMode: Record<string, unknown>): AppSettingsV1 {
  const settings = normalizeAppSettings({
    agents: { kun: { providerId: 'deepseek', model: 'deepseek-chat', apiKey: 'sk-runtime' } },
    write: { paperMode }
  } as unknown as AppSettingsV1)
  settings.provider.providers.push({
    id: 'other',
    name: 'Other',
    apiKey: '',
    baseUrl: 'https://other.example',
    endpointFormat: 'chat_completions',
    useProxy: false,
    models: ['other-chat'],
    modelProfiles: {}
  } as never)
  return settings
}

describe('resolvePaperTranslateModel', () => {
  it('never sends the runtime key or model to a different provider', () => {
    const settings = settingsWith({
      translate: { inheritModel: false, providerId: 'other', model: '' }
    })
    // "other" has no key of its own: resolution must fail instead of
    // borrowing the runtime provider's credential.
    expect(resolvePaperTranslateModel(settings)).toBeNull()

    const withKey = settingsWith({ translate: { inheritModel: false, providerId: 'other', model: '' } })
    const other = withKey.provider.providers.find((item) => item.id === 'other')!
    other.apiKey = 'sk-other'
    expect(resolvePaperTranslateModel(withKey)).toMatchObject({
      providerId: 'other',
      model: 'other-chat',
      apiKey: 'sk-other',
      baseUrl: 'https://other.example'
    })
  })

  it('inherits the runtime provider, model and key by default', () => {
    const settings = settingsWith({})
    const resolved = resolvePaperTranslateModel(settings)
    expect(resolved).toMatchObject({
      providerId: 'deepseek',
      model: resolveKunRuntimeSettings(settings).model,
      apiKey: 'sk-runtime'
    })
  })
})
