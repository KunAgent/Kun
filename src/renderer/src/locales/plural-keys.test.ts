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

// Families the locale translates: plural-suffixed keys, plus bare keys that
// English only defines as plural forms. `_other` alone can be an ordinary key
// (contextCapacityCat_other is the "Other" label), so a family only counts
// when English or the locale also has another plural form of it.
function pluralFamilies(own: Set<string>, source: Set<string>): Set<string> {
  const families = new Set<string>()
  for (const key of own) {
    const family = key.replace(PLURAL_SUFFIX, '')
    if (family === key && (source.has(key) || !source.has(`${key}_other`))) continue
    const isPlural = ['zero', 'one', 'two', 'few', 'many'].some((category) =>
      own.has(`${family}_${category}`) || source.has(`${family}_${category}`))
    if (isPlural) families.add(family)
  }
  return families
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

  // i18next never falls back from `_many` to `_other`: a category the locale
  // can select but does not author misses the whole bundle, so the count
  // renders from the English fallback language instead.
  it.each(Object.keys(authored))(
    'authors every plural category %s can select for each plural family',
    (locale) => {
      const categories = new Intl.PluralRules(locale).resolvedOptions().pluralCategories
      const offenders: string[] = []
      for (const namespace of ['common', 'settings'] as const) {
        const source = flattenKeys(english[namespace])
        const own = flattenKeys(authored[locale][namespace])
        const merged = flattenKeys(withFallback[namespace](authored[locale][namespace]))
        for (const family of pluralFamilies(own, source)) {
          const missing = categories.filter((category) => !own.has(`${family}_${category}`))
          if (missing.length === 0) continue
          const shadowed = lookupSuffixes(locale).some((suffix) =>
            merged.has(`${family}_${suffix}`) && !own.has(`${family}_${suffix}`))
          if (own.has(family) && !shadowed) continue
          offenders.push(`${namespace}:${family} missing ${missing.map((category) => `_${category}`).join(', ')}`)
        }
      }
      expect(offenders).toEqual([])
    }
  )

  it.each([
    ['paletteResultCount', { count: 1 }, '1 результат'],
    ['paletteResultCount', { count: 3 }, '3 результата'],
    ['paletteResultCount', { count: 5 }, '5 результатов'],
    ['paletteResultCount', { count: 0 }, '0 результатов'],
    ['paletteResultCount', { count: 21 }, '21 результат'],
    ['paletteResultCount', { count: 1.5 }, '1.5 результата'],
    ['settings:speakStoredTracksUsage', { count: 2, size: '4 MB' }, '2 файла, 4 MB'],
    ['settings:speakStoredTracksUsage', { count: 11, size: '4 MB' }, '11 файлов, 4 MB']
  ] as const)('resolves %s in Russian with %j', async (key, options, expected) => {
    await i18n.changeLanguage('ru')
    expect(i18n.t(key, { ns: 'common', ...options })).toBe(expected)
  })

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
