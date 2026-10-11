import { settingsButtonClass } from './settings-button'
import type { AppSettingsV1 } from '@shared/app-settings'
import { APP_LOCALE_OPTIONS, normalizeComposerSendKey } from '@shared/app-settings'
import type { ReactElement } from 'react'
import { SettingRow, SettingsCard } from './settings-controls'
import { DesktopBehaviorSettingsCard } from './settings-section-general-desktop'

/** Language, input habits and how Kun behaves on the desktop. */
export function GeneralSettingsSection({ ctx }: { ctx: Record<string, any> }): ReactElement {
  const { t, form, update, selectControlClass, openOnboardingPreview } = ctx
  const platform = typeof window !== 'undefined' ? window.kunGui?.platform ?? '' : ''

  return (
    <>
      <SettingsCard title={t('settingsIaLanguageCard')}>
        <SettingRow
          title={t('language')}
          description={t('languageDesc')}
          control={
            <select
              className={selectControlClass}
              value={form.locale}
              onChange={(e) => update({ locale: e.target.value as AppSettingsV1['locale'] })}
            >
              {APP_LOCALE_OPTIONS.map((option) => (
                <option key={option.value} value={option.value}>{option.label}</option>
              ))}
            </select>
          }
        />
        <SettingRow
          title={t('composerSendKey')}
          description={t('composerSendKeyDesc')}
          control={
            <select
              className={selectControlClass}
              value={normalizeComposerSendKey(form.composerSendKey)}
              onChange={(e) => update({ composerSendKey: normalizeComposerSendKey(e.target.value) })}
            >
              <option value="enter">{t('composerSendKey_enter')}</option>
              <option value="shiftEnter">{t('composerSendKey_shiftEnter')}</option>
            </select>
          }
        />
        <SettingRow
          title={t('chatWelcomeMessage')}
          description={t('chatWelcomeMessageDesc')}
          wideControl
          control={
            <input
              type="text"
              value={form.chatWelcomeMessage ?? ''}
              onChange={(e) => update({ chatWelcomeMessage: e.target.value })}
              placeholder={t('chatWelcomeMessagePlaceholder')}
              maxLength={200}
              className="w-full rounded-xl border border-ds-border bg-ds-main/60 px-3 py-2.5 text-[14px] leading-6 text-ds-ink outline-none focus:border-accent/40 focus:ring-1 focus:ring-accent/25"
            />
          }
        />
      </SettingsCard>

      <DesktopBehaviorSettingsCard view={{
        t,
        update,
        desktopBehavior: form.appBehavior,
        openAtLoginSupported: platform === 'win32' || platform === 'darwin',
        startMinimizedSupported: platform === 'win32',
        systemTitleBarSupported: platform === 'linux'
      }} />

      <SettingsCard>
        <SettingRow
          title={t('onboardingPreview')}
          description={t('onboardingPreviewDesc')}
          control={
            <button
              type="button"
              onClick={openOnboardingPreview}
              className={settingsButtonClass({ className: 'w-fit' })}
            >
              {t('onboardingPreviewOpen')}
            </button>
          }
        />
      </SettingsCard>
    </>
  )
}
