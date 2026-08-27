import { afterEach, describe, expect, it } from 'vitest'
import { APP_LOCALES, type AppLocale } from '@shared/app-locales'
import { BUILTIN_AGENT_CATALOG } from '../../../../kun/src/delegation/builtin-agent-catalog'
import i18n, {
  withGraphCommonFallback,
  withGraphSettingsFallback
} from '../i18n'
import enCommon from './en/common'
import enPlanBuild from './en/common/plan-build.json'
import enSettings from './en/settings'
import hiCommon from './hi/common'
import hiSettings from './hi/settings'
import jaCommon from './ja/common'
import jaSettings from './ja/settings'
import koCommon from './ko/common'
import koSettings from './ko/settings'
import ruCommon from './ru/common'
import ruSettings from './ru/settings'
import thCommon from './th/common'
import thSettings from './th/settings'
import zhCommon from './zh/common'
import zhPlanBuild from './zh/common/plan-build.json'
import zhSettings from './zh/settings'

type LocaleTree = Record<string, unknown>

const authoredSettings: Record<AppLocale, LocaleTree> = {
  en: enSettings,
  zh: zhSettings,
  ru: ruSettings,
  hi: hiSettings,
  th: thSettings,
  ja: jaSettings,
  ko: koSettings
}

const resources: Record<AppLocale, { common: LocaleTree; settings: LocaleTree }> = {
  en: { common: enCommon, settings: enSettings },
  zh: { common: zhCommon, settings: zhSettings },
  ru: {
    common: withGraphCommonFallback(ruCommon),
    settings: withGraphSettingsFallback(ruSettings)
  },
  hi: {
    common: withGraphCommonFallback(hiCommon),
    settings: withGraphSettingsFallback(hiSettings)
  },
  th: {
    common: withGraphCommonFallback(thCommon),
    settings: withGraphSettingsFallback(thSettings)
  },
  ja: {
    common: withGraphCommonFallback(jaCommon),
    settings: withGraphSettingsFallback(jaSettings)
  },
  ko: {
    common: withGraphCommonFallback(koCommon),
    settings: withGraphSettingsFallback(koSettings)
  }
}

const PLAN_BUILD_ACTION_KEYS = [
  'planBuildMode',
  'planBuildStart',
  'planBuildDirect',
  'planBuildGraph',
  'planBuildGraphStart',
  'planScheduleBuild',
  'planScheduleBuildSet',
  'planScheduleBuildModify',
  'planScheduleBuildScheduled',
  'planScheduleBuildTimeLabel',
  'planScheduleBuildOnce',
  'planScheduleBuildAutomaticHint',
  'planScheduleBuildCancel',
  'planScheduleBuildEnabled',
  'planScheduleBuildNextRun',
  'planScheduleBuildRemaining',
  'planScheduleBuildRemainingPrefix',
  'planScheduleBuildRemainingSuffix',
  'planScheduleBuildCountdownDay',
  'planScheduleBuildCountdownHour',
  'planScheduleBuildCountdownMinute',
  'planScheduleBuildDueSoon',
  'planWorktreeUsePrompt',
  'planWorktreePromptHint',
  'planWorktreeGraphUnsupported',
  'planWorktreeCurrentWorkspaceWarning'
] as const

const DARK_UI_COLOR_KEYS = [
  'darkUiColorsTitle',
  'darkUiColorsBackground',
  'darkUiColorsBackgroundDesc',
  'darkUiColorsBorder',
  'darkUiColorsBorderDesc',
  'darkUiColorsPanel',
  'darkUiColorsPanelDesc',
  'darkUiColorsPreview',
  'darkUiColorsDarkOnlyHint',
  'darkUiColorsReset'
] as const

function flattenStrings(
  tree: LocaleTree,
  prefix = '',
  result = new Map<string, string>()
): Map<string, string> {
  for (const [key, value] of Object.entries(tree)) {
    const path = prefix ? `${prefix}.${key}` : key
    if (typeof value === 'string') result.set(path, value)
    else if (value && typeof value === 'object' && !Array.isArray(value)) {
      flattenStrings(value as LocaleTree, path, result)
    } else {
      throw new Error(`locale value must be a string or object: ${path}`)
    }
  }
  return result
}

function interpolationTokens(value: string): string[] {
  return Array.from(value.matchAll(/{{\s*([^,}\s]+)[^}]*}}/g), (match) => match[1]).sort()
}

describe('active locale resources', () => {
  afterEach(async () => {
    await i18n.changeLanguage('en')
  })

  it('supports every persisted application locale', () => {
    expect(Object.keys(resources)).toEqual([...APP_LOCALES])
    for (const locale of APP_LOCALES) {
      expect(i18n.options.supportedLngs).toContain(locale)
    }
    expect(i18n.hasResourceBundle('en', 'common')).toBe(true)
    expect(i18n.hasResourceBundle('en', 'settings')).toBe(true)
  })

  it.each(['ru', 'hi', 'th', 'ja', 'ko'] as const)(
    'keeps the %s locale complete and interpolation-safe',
    (locale) => {
      for (const namespace of ['common', 'settings'] as const) {
        const source = flattenStrings(resources.en[namespace])
        const translated = flattenStrings(resources[locale][namespace])
        expect([...translated.keys()], namespace).toEqual([...source.keys()])
        for (const [key, sourceValue] of source) {
          const translatedValue = translated.get(key)
          expect(translatedValue, `${namespace}:${key}`).toBeTruthy()
          expect(interpolationTokens(translatedValue ?? ''), `${namespace}:${key}`)
            .toEqual(interpolationTokens(sourceValue))
        }
      }
    }
  )

  it.each(APP_LOCALES)(
    'authors a complete model-routes resource for %s without fallback copy',
    (locale) => {
      const source = flattenStrings(enSettings.modelRoutes)
      const translated = flattenStrings(authoredSettings[locale].modelRoutes as LocaleTree)

      expect([...translated.keys()]).toEqual([...source.keys()])
      for (const [key, sourceValue] of source) {
        const translatedValue = translated.get(key)
        expect(translatedValue, `settings:modelRoutes.${key}`).toBeTruthy()
        expect(interpolationTokens(translatedValue ?? ''), `settings:modelRoutes.${key}`)
          .toEqual(interpolationTokens(sourceValue))
        expect(translatedValue).not.toContain('ZZSAFE')
      }
      if (locale !== 'en') {
        expect(translated.get('localRelayProvider')).not.toBe(source.get('localRelayProvider'))
      }
    }
  )

  it.each(APP_LOCALES)('authors every dark UI color label for %s', (locale) => {
    for (const key of DARK_UI_COLOR_KEYS) {
      const value = authoredSettings[locale][key]
      expect(typeof value, `settings:${key}`).toBe('string')
      expect(String(value).trim(), `settings:${key}`).not.toBe('')
    }
  })

  it.each(APP_LOCALES)('preserves model-route protocol literals in %s guidance', (locale) => {
    const modelRoutes = authoredSettings[locale].modelRoutes as Record<string, string>
    const expectedLiterals: Record<string, readonly string[]> = {
      guideModelsResponse: ['object: "list"', 'data'],
      guideFieldModel: ['model', '{{modelId}}'],
      guideResponsesNonStreaming: ['object: "response"', 'output'],
      guideChatMessages: ['messages', 'system', 'developer', 'user', 'assistant', 'tool'],
      guideChatTools: ['tools', 'function', 'Base64', 'data URL'],
      guideChatNonStreaming: ['choices[0].message.content'],
      guideChatStreaming: ['data: [DONE]']
    }

    for (const [key, literals] of Object.entries(expectedLiterals)) {
      for (const literal of literals) {
        expect(modelRoutes[key], `settings:modelRoutes.${key}`).toContain(literal)
      }
    }
  })

  it.each(APP_LOCALES)('can switch i18next to %s without falling back to another locale', async (locale) => {
    await i18n.changeLanguage(locale)
    expect(i18n.resolvedLanguage).toBe(locale)
    expect(i18n.t('settings:language')).toBe(resources[locale].settings.language)
  })

  it('keeps English and Chinese plan build resources structurally aligned', () => {
    const source = flattenStrings(enPlanBuild)
    const translated = flattenStrings(zhPlanBuild)

    expect([...translated.keys()]).toEqual([...source.keys()])
    for (const [key, sourceValue] of source) {
      expect(interpolationTokens(translated.get(key) ?? ''), key)
        .toEqual(interpolationTokens(sourceValue))
    }
  })

  it.each(APP_LOCALES)('resolves every plan build action in %s without exposing a key', async (locale) => {
    await i18n.changeLanguage(locale)

    for (const key of PLAN_BUILD_ACTION_KEYS) {
      expect(i18n.exists(key, { ns: 'common' }), key).toBe(true)
      const value = i18n.t(key, { ns: 'common' })
      expect(value.trim(), key).not.toBe('')
      expect(value, key).not.toBe(key)
    }
  })

  it.each([
    ['en', 'Set schedule', 'Start Graph build'],
    ['zh', '设置定时', '开始 Graph 构建']
  ] as const)('uses the intended plan build actions in %s', async (locale, schedule, graph) => {
    await i18n.changeLanguage(locale)

    expect(i18n.t('planScheduleBuildSet', { ns: 'common' })).toBe(schedule)
    expect(i18n.t('planBuildGraphStart', { ns: 'common' })).toBe(graph)
  })

  it.each(['en', 'zh'] as const)(
    'covers every built-in subagent catalog role in %s',
    (locale) => {
      const roles = (resources[locale].common.subagentsPanel as { role?: Record<string, { name?: string; desc?: string }> })
        ?.role
      expect(roles).toBeTruthy()
      for (const agent of BUILTIN_AGENT_CATALOG) {
        expect(roles?.[agent.id]?.name?.trim(), `${locale} name for ${agent.id}`).toBeTruthy()
        expect(roles?.[agent.id]?.desc?.trim(), `${locale} desc for ${agent.id}`).toBeTruthy()
      }
    }
  )
})
