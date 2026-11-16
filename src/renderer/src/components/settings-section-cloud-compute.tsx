import { useState, type ReactElement } from 'react'
import { ArrowRight, Loader2, RefreshCw } from 'lucide-react'
import { defaultKunColabSettings } from '@shared/app-settings-colab'
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
  const { t, kun, updateKun, goBack } = ctx
  const colabSettings = kun?.colab ?? defaultKunColabSettings()
  const snapshot = useColabStore((s) => s.snapshot)
  const [provisioning, setProvisioning] = useState(false)

  const cli = snapshot.cli
  const runningCount = selectAllRunningSessions(snapshot).length

  const handlePrepareRuntime = async (upgrade: boolean): Promise<void> => {
    setProvisioning(true)
    try {
      await window.kunGui.colabEnsureCliRuntime({ upgrade })
    } finally {
      setProvisioning(false)
    }
  }

  const cliDescription =
    cli.state === 'ready'
      ? t('colabCliReady', {
          version: cli.version ?? '0.8.0',
          python: cli.pythonVersion ?? '3.12'
        })
      : cli.state === 'installing' || provisioning
        ? t('colabCliInstalling')
        : cli.state === 'error'
          ? t('colabCliError', { message: cli.message ?? '' })
          : t('colabCliMissing')

  return (
    <div className="space-y-5">
      <SettingsCard title={t('colabCliTitle')} description={t('colabCliDesc')}>
        <SettingRow
          title="google-colab-cli"
          description={cliDescription}
          control={
            <button
              type="button"
              disabled={provisioning || cli.state === 'installing'}
              onClick={() => void handlePrepareRuntime(cli.state === 'ready')}
              className={settingsButtonClass({
                variant: cli.state === 'ready' ? 'secondary' : 'primary'
              })}
            >
              {provisioning || cli.state === 'installing' ? (
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
              ) : (
                <RefreshCw className="h-3.5 w-3.5" />
              )}
              <span>
                {cli.state === 'ready' ? t('colabCliUpdateBtn') : t('colabCliPrepareBtn')}
              </span>
            </button>
          }
        />
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
              onClick={() => {
                if (typeof goBack === 'function') goBack()
                openColabPanel({ expandConnections: true })
              }}
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
