import { afterEach, describe, expect, it } from 'vitest'
import i18n, { withGraphCommonFallback, withGraphSettingsFallback } from '../i18n'
import enCommon from './en/common'
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
import zhSettings from './zh/settings'

type LocaleTree = Record<string, unknown>

const PLURAL_SUFFIX = /_(zero|one|two|few|many|other)$/

const authored: Record<string, { common: LocaleTree; settings: LocaleTree }> = {
  zh: { common: zhCommon, settings: zhSettings },
  ru: { common: ruCommon, settings: ruSettings },
  hi: { common: hiCommon, settings: hiSettings },
  th: { common: thCommon, settings: thSettings },
  ja: { common: jaCommon, settings: jaSettings },
  ko: { common: koCommon, settings: koSettings }
}

const english = { common: enCommon as LocaleTree, settings: enSettings as LocaleTree }

const withFallback = {
  common: withGraphCommonFallback,
  settings: withGraphSettingsFallback
}

function flattenKeys(tree: LocaleTree, prefix = '', result = new Set<string>()): Set<string> {
  for (const [key, value] of Object.entries(tree)) {
    const path = prefix ? `${prefix}.${key}` : key
    if (value && typeof value === 'object' && !Array.isArray(value)) {
      flattenKeys(value as LocaleTree, path, result)
    } else {
      result.add(path)
    }
  }
  return result
}

// i18next tries `${key}_${category}` (and `${key}_zero` for count 0) before
// the bare key, inside the merged bundle, before any fallback language.
function lookupSuffixes(locale: string): string[] {
  const categories = new Intl.PluralRules(locale).resolvedOptions().pluralCategories
  return ['zero', ...categories.filter((category) => category !== 'zero')]
}

describe('plural locale keys', () => {
  afterEach(async () => {
    await i18n.changeLanguage('en')
  })

  it.each(Object.keys(authored))(
    'does not author bare keys that English only defines as plural forms in %s',
    (locale) => {
      const offenders: string[] = []
      for (const namespace of ['common', 'settings'] as const) {
        const source = flattenKeys(english[namespace])
        for (const key of flattenKeys(authored[locale][namespace])) {
          if (PLURAL_SUFFIX.test(key) || source.has(key)) continue
          if (source.has(`${key}_other`)) offenders.push(`${namespace}:${key} -> ${key}_other`)
        }
      }
      expect(offenders).toEqual([])
    }
  )

  it.each(Object.keys(authored))(
    'does not let merged English plural forms shadow %s translations',
    (locale) => {
      const offenders: string[] = []
      for (const namespace of ['common', 'settings'] as const) {
        const own = flattenKeys(authored[locale][namespace])
        const merged = flattenKeys(withFallback[namespace](authored[locale][namespace]))
        const families = new Set([...own].map((key) => key.replace(PLURAL_SUFFIX, '')))
        for (const family of families) {
          for (const suffix of lookupSuffixes(locale)) {
            const key = `${family}_${suffix}`
            if (merged.has(key) && !own.has(key)) offenders.push(`${namespace}:${key}`)
          }
        }
      }
      expect(offenders).toEqual([])
    }
  )

  it.each([
    ['roomsReplyCount', { count: 3 }, '3 条回复'],
    ['roomsUsageDays', { count: 7 }, '最近 7 天'],
    ['roomsTyping_nMore', { count: 2 }, '另外 2 位成员'],
    ['roomsAttachmentSummary', { count: 2 }, '2 个附件']
  ] as const)('resolves %s with a count in Chinese', async (key, options, expected) => {
    await i18n.changeLanguage('zh')
    expect(i18n.t(key, { ns: 'common', ...options })).toBe(expected)
  })
})
