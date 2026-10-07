import { describe, expect, it } from 'vitest'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { defaultKunRuntimeSettings } from '@shared/app-settings'
import { SettingsSidebar } from './SettingsSidebar'
import { ImageGenerationSettingsSection } from './settings-section-image-generation'

const labels: Record<string, string> = {
  back: 'Back',
  general: 'General',
  write: 'Work',
  agents: 'AI assistant',
  mediaGeneration: 'Media generation',
  keyboardShortcuts: 'Keyboard shortcuts',
  claw: 'Connect phone',
  settingsFooter: 'Settings',
  imageGen: 'Image generation',
  imageGenEnabled: 'Enable image generation',
  imageGenEnabledDesc: 'Enables agent chats and Work infographics',
  imageGenProvider: 'Image provider',
  imageGenProviderDesc: 'Choose image provider',
  imageGenProviderCustom: 'Custom image API',
  imageGenProviderMissingKey: '{{provider}} missing key',
  imageGenProtocol: 'Image protocol',
  imageGenProtocolDesc: 'Image protocol description',
  imageGenProtocolVolcengineArk: 'Volcano Ark Seedream',
  imageGenBaseUrl: 'API base URL',
  imageGenBaseUrlDesc: 'OpenAI-compatible endpoint root',
  imageGenBaseUrlPlaceholder: 'https://api.example.com/v1',
  imageGenApiKey: 'API key',
  imageGenApiKeyDesc: 'Independent image provider key',
  imageGenModel: 'Image model',
  imageGenModelDesc: 'Model id sent to the provider',
  imageGenModelQualityHint: 'Prefer GPT Image or Gemini image models for design drafts and infographics',
  imageGenModelPlaceholder: 'gpt-image-1',
  imageGenQuality: 'Generation quality',
  imageGenQualityDesc: 'Quality hint independent from output resolution',
  imageGenQuality_auto: 'Auto',
  imageGenQuality_low: 'Low',
  imageGenQuality_medium: 'Medium',
  imageGenQuality_high: 'High',
  imageGenDefaultResolution: 'Default resolution',
  imageGenDefaultResolutionDesc: 'Used when the assistant does not specify a resolution',
  imageGenDefaultResolution_auto: 'Auto',
  imageGenDefaultResolution_1K: '1K',
  imageGenDefaultResolution_2K: '2K',
  imageGenDefaultResolution_3K: '3K',
  imageGenDefaultResolution_4K: '4K',
  imageGenDefaultSize: 'Custom default dimensions',
  imageGenDefaultSizeDesc: 'Overrides the default resolution when set',
  imageGenTimeout: 'Timeout (ms)',
  imageGenTimeoutDesc: 'Timeout description',
  showSecret: 'Show',
  hideSecret: 'Hide'
}

function t(key: string, params?: Record<string, unknown>): string {
  const template = labels[key] ?? key
  return template.replace(/\{\{(\w+)\}\}/g, (_, name: string) => String(params?.[name] ?? ''))
}

describe('ImageGenerationSettingsSection', () => {
  it('renders image generation as a standalone shared settings section', () => {
    const html = renderToStaticMarkup(createElement(ImageGenerationSettingsSection, {
      ctx: {
        t,
        kun: {
          ...defaultKunRuntimeSettings(),
          imageGeneration: {
            enabled: true,
            baseUrl: 'https://images.example.com/v1',
            apiKey: 'sk-image',
            model: 'image-model',
            defaultResolution: '2K',
            defaultSize: '1536x1024',
            quality: 'high',
            timeoutMs: 240000
          }
        },
        updateKun: () => undefined
      }
    }))

    expect(html).toContain('Image generation')
    expect(html).toContain('Enables agent chats and Work infographics')
    expect(html).toContain('Prefer GPT Image or Gemini image models for design drafts and infographics')
    expect(html).toContain('Generation quality')
    expect(html).toContain('Quality hint independent from output resolution')
    expect(html).toContain('Default resolution')
    expect(html).toContain('Custom default dimensions')
    expect(html).toContain('Overrides the default resolution when set')
    expect(html).toContain('value="https://images.example.com/v1"')
    expect(html).toContain('value="sk-image"')
    expect(html).toContain('value="image-model"')
    expect(html).toContain('value="high" selected=""')
    expect(html).toContain('value="2K" selected=""')
    expect(html).not.toContain('value="3K"')
    expect(html).not.toContain('value="4K"')
    expect(html).toContain('value="1536x1024"')
    expect(html).toContain('value="240000"')
  })

  it('keeps media generation with the model pages and no separate image entry', () => {
    const html = renderToStaticMarkup(createElement(SettingsSidebar, {
      category: 'mediaGeneration',
      goBack: () => undefined,
      setCategory: () => undefined,
      t
    }))

    const modelsGroup = html.slice(
      html.indexOf('id="settings-nav-group-models"'),
      html.indexOf('id="settings-nav-group-assistant"')
    )
    const order = [...modelsGroup.matchAll(/data-settings-category="([A-Za-z]+)"/g)].map((match) => match[1])
    expect(order).toEqual(['providers', 'gateway', 'speechToText', 'mediaGeneration'])
    expect(html.indexOf('Image generation')).toBe(-1)
  })

  it('shows Agent Plan Seedream models and only its native 2K through 4K resolutions', () => {
    const html = renderToStaticMarkup(createElement(ImageGenerationSettingsSection, {
      ctx: {
        t,
        selectControlClass: 'select',
        provider: {
          providers: [
            {
              id: 'volcengine',
              name: 'Volcano Ark API',
              apiKey: 'standard-key',
              image: {
                protocol: 'volcengine-ark-image',
                models: ['doubao-seedream-5-0-pro-260628']
              }
            },
            {
              id: 'volcengine-agent-plan',
              name: 'Volcano Ark Agent Plan',
              apiKey: 'agent-plan-key',
              image: {
                protocol: 'volcengine-ark-image',
                models: ['doubao-seedream-5.0-lite']
              }
            }
          ]
        },
        kun: {
          ...defaultKunRuntimeSettings(),
          imageGeneration: {
            ...defaultKunRuntimeSettings().imageGeneration,
            enabled: true,
            providerId: 'volcengine-agent-plan',
            protocol: 'volcengine-ark-image',
            model: '',
            defaultResolution: '1K'
          }
        },
        updateKun: () => undefined
      }
    }))

    expect(html).toContain('Volcano Ark API')
    expect(html).toContain('Volcano Ark Agent Plan')
    expect(html).toContain('doubao-seedream-5.0-lite')
    expect(html).toContain('value="2K" selected=""')
    expect(html).toContain('value="3K"')
    expect(html).toContain('value="4K"')
    expect(html).not.toContain('value="1K"')
  })
})
