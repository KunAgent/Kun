import { ArrowLeft, MonitorSmartphone } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { APP_LOCALE_OPTIONS } from '@shared/app-locales'
import { rendererRuntimeClient } from '../../agent/runtime-client'
import { useChatStore } from '../../store/chat-store'
import { MobileCodeSettingsBody } from '../chat/MobileCodeSettings'
import { switchRemoteSurface } from '../use-remote-surface'
import './mobile-settings-screen.css'

/**
 * Full-screen mobile settings page. The desktop settings route is wrapped in
 * a protected Electron surface that never resolves in a Remote browser, so
 * the phone shell keeps its own page with the essentials: runtime health,
 * default model, language, and a way back to the desktop layout.
 */
export function MobileSettingsScreen({ onBack }: { onBack: () => void }): React.JSX.Element {
  const { t, i18n } = useTranslation('common')
  const applyI18n = useChatStore((s) => s.applyI18nFromSettings)
  const runtimeConnection = useChatStore((s) => s.runtimeConnection)
  const activeLocale = i18n.resolvedLanguage ?? i18n.language

  const pickLocale = (value: (typeof APP_LOCALE_OPTIONS)[number]['value']): void => {
    if (value === activeLocale) return
    void applyI18n(value)
    void rendererRuntimeClient.setSettings({ locale: value }).catch(() => undefined)
  }

  return (
    <div className="kun-mobile-settings-screen">
      <header>
        <button type="button" className="kun-mobile-back" onClick={onBack} aria-label={t('back')}>
          <ArrowLeft size={20} aria-hidden />
          <span>{t('back')}</span>
        </button>
        <h1>{t('settings')}</h1>
        <span />
      </header>
      <div className="kun-mobile-settings-screen-body">
        {/* A needs-config jump lands here with an offline runtime; explain why
            instead of showing a bare form (U1). */}
        {runtimeConnection === 'offline' ? (
          <p className="kun-mobile-settings-hint" role="status">{t('mobileSettingsRuntimeHint')}</p>
        ) : null}
        <MobileCodeSettingsBody />
        <section className="kun-mobile-form">
          <h2 className="kun-mobile-settings-section-title">{t('mobileSettingsLanguage')}</h2>
          <div className="kun-mobile-actions">
            {APP_LOCALE_OPTIONS.map((option) => (
              <button
                key={option.value}
                type="button"
                className="kun-mobile-button"
                data-variant={option.value === activeLocale ? 'primary' : undefined}
                aria-pressed={option.value === activeLocale}
                onClick={() => pickLocale(option.value)}
              >
                {option.label}
              </button>
            ))}
          </div>
        </section>
        <section className="kun-mobile-form">
          <h2 className="kun-mobile-settings-section-title">{t('mobileSettingsDisplay')}</h2>
          <button
            type="button"
            className="kun-mobile-button"
            onClick={() => switchRemoteSurface('desktop')}
          >
            <MonitorSmartphone size={18} aria-hidden />
            {t('mobileSettingsUseDesktop')}
          </button>
          <p className="kun-mobile-hint">{t('mobileSettingsUseDesktopHint')}</p>
        </section>
      </div>
    </div>
  )
}
