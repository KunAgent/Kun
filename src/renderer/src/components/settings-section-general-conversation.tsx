import { normalizeComposerSendKey } from '@shared/app-settings'
import { defaultKunAdeSettings } from '@shared/app-settings-kun-harness'
import type { AdeActivityNotificationCategory } from '@shared/kun-gui-notification-contracts'
import type { ReactElement } from 'react'
import { SettingRow, SettingsCard, SettingsTabPanel, Toggle } from './settings-controls'

const ADE_NOTIFICATION_CATEGORIES: readonly AdeActivityNotificationCategory[] = [
  'waiting',
  'failed',
  'done',
  'stalled'
]

export function GeneralConversationSettingsPanel({ view }: { view: Record<string, any> }): ReactElement {
  const { t, form, update, selectControlClass, openOnboardingPreview, activeTab, kun, updateKun } = view
  const adeNotifications = kun?.ade?.notifications ?? defaultKunAdeSettings().notifications
  return (
    <>
      <SettingsTabPanel
        baseId="general-settings"
        tabId="conversation"
        active={activeTab === 'conversation'}
      >
        <SettingsCard title={t('generalTabConversation')}>
          <SettingRow
            title={t('composerSendKey')}
            description={t('composerSendKeyDesc')}
            control={
              <select
                className={selectControlClass}
                value={normalizeComposerSendKey(form.composerSendKey)}
                onChange={(e) =>
                  update({
                    composerSendKey: normalizeComposerSendKey(e.target.value)
                  })
                }
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
          <SettingRow
            title={t('turnCompleteNotification')}
            description={t('turnCompleteNotificationDesc')}
            control={
              <Toggle
                checked={form.notifications.turnComplete}
                onChange={(v) => update({ notifications: { turnComplete: v } })}
              />
            }
          />
          <div className="ml-3 divide-y divide-ds-border-muted border-l border-ds-border-muted pl-2">
            <SettingRow
              title={t('mainAgentTurnCompleteNotification')}
              description={t('mainAgentTurnCompleteNotificationDesc')}
              control={
                <Toggle
                  checked={form.notifications.mainAgentTurnComplete !== false}
                  disabled={!form.notifications.turnComplete}
                  ariaLabel={t('mainAgentTurnCompleteNotification')}
                  onChange={(v) =>
                    update({ notifications: { mainAgentTurnComplete: v } })
                  }
                />
              }
            />
            <SettingRow
              title={t('subagentTurnCompleteNotification')}
              description={t('subagentTurnCompleteNotificationDesc')}
              control={
                <Toggle
                  checked={form.notifications.subagentTurnComplete === true}
                  disabled={!form.notifications.turnComplete}
                  ariaLabel={t('subagentTurnCompleteNotification')}
                  onChange={(v) =>
                    update({ notifications: { subagentTurnComplete: v } })
                  }
                />
              }
            />
            {kun?.ade?.enabled
              ? ADE_NOTIFICATION_CATEGORIES.map((category) => (
                  <SettingRow
                    key={category}
                    title={t(`adeNotify.setting_${category}`)}
                    description={t(`adeNotify.setting_${category}Desc`)}
                    control={
                      <Toggle
                        checked={adeNotifications[category] !== false}
                        disabled={!form.notifications.turnComplete}
                        ariaLabel={t(`adeNotify.setting_${category}`)}
                        onChange={(v) =>
                          updateKun({ ade: { notifications: { [category]: v } } })
                        }
                      />
                    }
                  />
                ))
              : null}
          </div>
        </SettingsCard>
        <SettingsCard title={t('onboardingPreview')}>
          <SettingRow
            title={t('onboardingPreview')}
            description={t('onboardingPreviewDesc')}
            control={
              <button
                type="button"
                onClick={openOnboardingPreview}
                className="inline-flex w-fit items-center rounded-xl border border-ds-border bg-ds-card px-3 py-2 text-[14px] font-medium text-ds-ink shadow-sm transition hover:bg-ds-hover"
              >
                {t('onboardingPreviewOpen')}
              </button>
            }
          />
        </SettingsCard>
      </SettingsTabPanel>
    </>
  )
}
