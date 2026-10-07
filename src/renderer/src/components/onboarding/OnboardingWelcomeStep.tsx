import type { ReactElement } from 'react'
import { Check, Info } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { APP_LOCALE_OPTIONS, type AppLocale } from '@shared/app-locales'
import { themeOptions, type ThemePref } from '../initial-setup-dialog-support'

function ThemeArt({ theme }: { theme: ThemePref }): ReactElement {
  const window = (night: boolean) => (
    <span className={night ? 'kun-onb-tw is-night' : 'kun-onb-tw'}>
      <span className="kun-onb-tw-side"><i /><i /><i /></span>
      <span className="kun-onb-tw-main"><i /><i /><b /></span>
    </span>
  )
  return (
    <span className="kun-onb-theme-art" data-art={theme} aria-hidden="true">
      {window(false)}
      {window(true)}
    </span>
  )
}

export function OnboardingWelcomeStep({ locale, theme, onLocale, onTheme }: {
  locale: AppLocale
  theme: ThemePref
  onLocale: (locale: AppLocale) => void
  onTheme: (theme: ThemePref) => void
}): ReactElement {
  const { t } = useTranslation('settings')
  return (
    <>
      <section aria-labelledby="kun-onb-language">
        <div className="kun-onb-section-label">
          <span id="kun-onb-language">{t('onboarding.welcome.language')}</span>
          <small>{t('onboarding.welcome.languageHint')}</small>
        </div>
        <div className="kun-onb-langs" role="radiogroup" aria-labelledby="kun-onb-language">
          {APP_LOCALE_OPTIONS.map((option) => {
            const on = option.value === locale
            return (
              <button
                key={option.value}
                type="button"
                role="radio"
                aria-checked={on}
                lang={option.documentLanguage}
                className={on ? 'kun-onb-chip is-on' : 'kun-onb-chip'}
                onClick={() => onLocale(option.value)}
                data-onboarding-locale={option.value}
              >
                <span>{option.label}</span>
                {on ? <Check size={16} strokeWidth={2.2} aria-hidden="true" /> : null}
              </button>
            )
          })}
        </div>
      </section>

      <section aria-labelledby="kun-onb-theme">
        <div className="kun-onb-section-label">
          <span id="kun-onb-theme">{t('onboarding.welcome.theme')}</span>
          <small>{t('onboarding.welcome.themeHint')}</small>
        </div>
        <div className="kun-onb-themes" role="radiogroup" aria-labelledby="kun-onb-theme">
          {themeOptions.map((option) => {
            const on = option.value === theme
            return (
              <button
                key={option.value}
                type="button"
                role="radio"
                aria-checked={on}
                className={on ? 'kun-onb-theme is-on' : 'kun-onb-theme'}
                onClick={() => onTheme(option.value)}
                data-onboarding-theme={option.value}
              >
                <ThemeArt theme={option.value} />
                <span className="kun-onb-theme-row"><span className="kun-onb-radio" />{t(option.labelKey)}</span>
              </button>
            )
          })}
        </div>
      </section>

      <div className="kun-onb-callout">
        <Info size={16} strokeWidth={1.8} aria-hidden="true" />
        <span>{t('onboarding.welcome.note')}</span>
      </div>
    </>
  )
}
