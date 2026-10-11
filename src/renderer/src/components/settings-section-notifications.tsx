import { defaultKunAdeSettings } from '@shared/app-settings-kun-harness'
import type { AdeActivityNotificationCategory } from '@shared/kun-gui-notification-contracts'
import type { ReactElement } from 'react'
import { SettingRow, SettingsCard, SettingsReveal, Toggle } from './settings-controls'

const ADE_NOTIFICATION_CATEGORIES: readonly AdeActivityNotificationCategory[] = [
  'waiting',
  'failed',
  'done',
  'stalled'
]

/** System notifications: when Kun taps you on the shoulder. */
export function NotificationsSettingsSection({ ctx }: { ctx: Record<string, any> }): ReactElement {
  const { t, form, update, kun, updateKun } = ctx
  const adeNotifications = kun?.ade?.notifications ?? defaultKunAdeSettings().notifications
  const turnComplete = form.notifications.turnComplete === true
  return (
    <>
      <SettingsCard title={t('settingsIaCompletionCard')} description={t('settingsIaCompletionCardDesc')}>
        <SettingRow
          title={t('turnCompleteNotification')}
          description={t('turnCompleteNotificationDesc')}
          control={
            <Toggle
              checked={turnComplete}
              onChange={(v) => update({ notifications: { turnComplete: v } })}
            />
          }
        />
        <SettingsReveal open={turnComplete}>
          <SettingRow
            title={t('mainAgentTurnCompleteNotification')}
            description={t('mainAgentTurnCompleteNotificationDesc')}
            control={
              <Toggle
                checked={form.notifications.mainAgentTurnComplete !== false}
                ariaLabel={t('mainAgentTurnCompleteNotification')}
                onChange={(v) => update({ notifications: { mainAgentTurnComplete: v } })}
              />
            }
          />
          <SettingRow
            title={t('subagentTurnCompleteNotification')}
            description={t('subagentTurnCompleteNotificationDesc')}
            control={
              <Toggle
                checked={form.notifications.subagentTurnComplete === true}
                ariaLabel={t('subagentTurnCompleteNotification')}
                onChange={(v) => update({ notifications: { subagentTurnComplete: v } })}
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
                      ariaLabel={t(`adeNotify.setting_${category}`)}
                      onChange={(v) => updateKun({ ade: { notifications: { [category]: v } } })}
                    />
                  }
                />
              ))
            : null}
        </SettingsReveal>
      </SettingsCard>

      <SettingsCard>
        <SettingRow
          title={t('quotaReminderNotification')}
          description={t('quotaReminderNotificationDesc')}
          control={
            <Toggle
              checked={form.notifications.quotaReminders !== false}
              ariaLabel={t('quotaReminderNotification')}
              onChange={(v) => update({ notifications: { quotaReminders: v } })}
            />
          }
        />
      </SettingsCard>
    </>
  )
}
