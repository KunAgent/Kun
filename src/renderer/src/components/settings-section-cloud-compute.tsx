import type { ReactElement } from 'react'
import { ArrowRight } from 'lucide-react'
import { defaultKunColabSettings } from '@shared/app-settings-colab'
import { ColabRuntimeSetup } from '../colab/ColabRuntimeSetup'
import {
  openColabPanel,
  selectAllRunningSessions,
  useColabStore,
  useColabSubscription
} from '../colab/colab-store'
import { settingsButtonClass } from './settings-button'
import { SettingRow, SettingsCard, Toggle } from './settings-controls'

export function CloudComputeSettingsSection({ ctx }: { ctx: Record<string, any> }): ReactElement {
  useColabSubscription()
  const { t, kun, updateKun, flushPendingSave, openCode } = ctx
  const colabSettings = kun?.colab ?? defaultKunColabSettings()
  const snapshot = useColabStore((s) => s.snapshot)
  const runningCount = selectAllRunningSessions(snapshot).length

  const manageConnections = async (): Promise<void> => {
    await flushPendingSave()
    await openCode()
    openColabPanel({ expandConnections: true })
  }

  return (
    <div className="space-y-5">
      <SettingsCard title={t('colabCliTitle')} description={t('colabCliDesc')}>
        <ColabRuntimeSetup />
      </SettingsCard>

      <SettingsCard
        title={t('colabConnectionsCardTitle')}
        description={t('colabConnectionsCardDesc')}
      >
        <SettingRow
          title={t('colabConnectionsSummary', {
            total: snapshot.connections.length,
            active: runningCount
          })}
          description={
            snapshot.connections.length > 0
              ? snapshot.connections.map((c) => `${c.name} (${c.email})`).join(' · ')
              : undefined
          }
          control={
            <button
              type="button"
              onClick={() => void manageConnections()}
              className={settingsButtonClass({ variant: 'secondary' })}
            >
              <span>{t('colabManageInPanelBtn')}</span>
              <ArrowRight className="h-3.5 w-3.5" />
            </button>
          }
        />
      </SettingsCard>

      <SettingsCard title={t('colabSafetyCardTitle')} description={t('colabSafetyCardDesc')}>
        <SettingRow
          title={t('colabRequireApproval')}
          description={t('colabRequireApprovalDesc')}
          control={
            <Toggle
              checked={colabSettings.requireApprovalForAgent !== false}
              ariaLabel={t('colabRequireApproval')}
              onChange={(v) => updateKun({ colab: { requireApprovalForAgent: v } })}
            />
          }
        />
        <SettingRow
          title={t('colabIdleAutoStop')}
          description={t('colabIdleAutoStopDesc', {
            minutes: colabSettings.idleAutoStopMinutes ?? 15
          })}
          control={
            <Toggle
              checked={colabSettings.idleAutoStopEnabled !== false}
              ariaLabel={t('colabIdleAutoStop')}
              onChange={(v) => updateKun({ colab: { idleAutoStopEnabled: v } })}
            />
          }
        />
        <SettingRow
          title={t('colabLowBalanceReminder')}
          description={t('colabLowBalanceReminderDesc', {
            threshold: colabSettings.lowBalanceThresholdCu ?? 10
          })}
          control={
            <Toggle
              checked={colabSettings.lowBalanceReminderEnabled !== false}
              ariaLabel={t('colabLowBalanceReminder')}
              onChange={(v) => updateKun({ colab: { lowBalanceReminderEnabled: v } })}
            />
          }
        />
        <SettingRow
          title={t('colabStopOnQuit')}
          description={t('colabStopOnQuitDesc')}
          control={
            <Toggle
              checked={colabSettings.stopSessionsOnQuit !== false}
              ariaLabel={t('colabStopOnQuit')}
              onChange={(v) => updateKun({ colab: { stopSessionsOnQuit: v } })}
            />
          }
        />
      </SettingsCard>
    </div>
  )
}
