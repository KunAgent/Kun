import i18n, { type BackendModule } from 'i18next'
import { initReactI18next } from 'react-i18next'
import enCommon from './locales/en/common'
import enSettings from './locales/en/settings'
import { APP_LOCALES } from '@shared/app-locales'

const englishCommonResources = enCommon as Record<string, unknown>
const englishGraphSettingsResources = Object.fromEntries(
  Object.entries(enSettings).filter(([key]) =>
    key.startsWith('graphSettings') ||
    key.startsWith('fastContext') ||
    key.startsWith('labPpt') ||
    key.startsWith('storageRelocation') ||
    key.startsWith('modelRoutes')
  )
)

function mergeWithEnglishFallback(
  locale: Record<string, unknown>,
  fallback: Record<string, unknown>
): Record<string, unknown> {
  const merged: Record<string, unknown> = {}
  for (const key of Object.keys(fallback)) {
    merged[key] = fallback[key]
  }
  for (const [key, value] of Object.entries(locale)) {
    const fallbackValue = merged[key]
    if (
      value !== null &&
      typeof value === 'object' &&
      !Array.isArray(value) &&
      fallbackValue !== null &&
      typeof fallbackValue === 'object' &&
      !Array.isArray(fallbackValue)
    ) {
      merged[key] = mergeWithEnglishFallback(
        value as Record<string, unknown>,
        fallbackValue as Record<string, unknown>
      )
    } else {
      merged[key] = value
    }
  }
  return merged
}

/**
 * Graph Mode launches with complete English and Chinese copy. Other active
 * locales receive complete English common copy fallback so controls never
 * render raw translation keys while native translations can be
 * added incrementally.
 */
export function withGraphCommonFallback<T extends Record<string, unknown>>(locale: T): T {
  return {
    ...mergeWithEnglishFallback(locale, englishCommonResources)
  } as T
}

export function withGraphSettingsFallback<T extends Record<string, unknown>>(locale: T): T {
  const merged = {
    ...locale,
    ...Object.fromEntries(
      Object.entries(englishGraphSettingsResources).filter(([key]) => !(key in locale))
    )
  }

  return {
    ...Object.fromEntries(
      Object.keys(enSettings)
        .filter((key) => key in merged)
        .map((key) => [key, merged[key]])
    ),
    ...Object.fromEntries(
      Object.entries(merged).filter(([key]) => !(key in enSettings))
    )
  } as T
}

type LocaleModule = { default: Record<string, unknown> }

const localeLoaders = import.meta.glob<LocaleModule>(
  './locales/{hi,ja,ko,ru,th,zh}/{common,settings}.ts'
)

const lazyLocaleBackend: BackendModule = {
  type: 'backend',
  init() {},
  read(language, namespace, callback) {
    const loader = localeLoaders[`./locales/${language}/${namespace}.ts`]
    if (!loader) {
      callback(new Error(`Unsupported locale resource: ${language}/${namespace}`), false)
      return
    }
    void loader().then(({ default: resource }) => {
      callback(
        null,
        namespace === 'common'
          ? withGraphCommonFallback(resource)
          : namespace === 'settings'
            ? withGraphSettingsFallback(resource)
            : resource
      )
    }, (error: unknown) => {
      callback(
        error instanceof Error ? error : new Error(`Failed to load ${language}/${namespace}`),
        false
      )
    })
  }
}

void i18n.use(lazyLocaleBackend).use(initReactI18next).init({
  resources: {
    en: { common: enCommon, settings: enSettings }
  },
  partialBundledLanguages: true,
  lng: 'en',
  fallbackLng: 'en',
  supportedLngs: APP_LOCALES,
  load: 'languageOnly',
  interpolation: { escapeValue: false },
  react: { useSuspense: false },
  defaultNS: 'common',
  ns: ['common', 'settings']
})

export default i18n
