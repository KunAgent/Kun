import type { AppSettingsPatch, AppSettingsV1 } from '@shared/app-settings'
import { CHECKPOINT_CLEANUP_INTERVAL_DAYS } from '@shared/app-settings'
import type { ReactElement } from 'react'
import {
  SettingRow,
  SettingsCard,
  Toggle
} from './settings-controls'

type TranslateFn = (key: string, options?: Record<string, unknown>) => string

const checkpointCleanupIntervalOptions = Array.from(CHECKPOINT_CLEANUP_INTERVAL_DAYS)

/** Git checkpoint management: the Checkpoints tab of the Code settings page. */
export function CheckpointSettingsPanel({
  t,
  form,
  update,
  selectControlClass
}: {
  t: TranslateFn
  form: AppSettingsV1
  update: (patch: AppSettingsPatch) => void
  selectControlClass: string
}): ReactElement {
  return (
    <SettingsCard title={t('gitCheckpointTitle')}>
    <SettingRow
      title={t('checkpointCreateEnabled')}
      description={t('checkpointCreateEnabledDesc')}
      control={
        <Toggle
          checked={form.checkpointCleanup.createEnabled}
          onChange={(v) => update({ checkpointCleanup: { createEnabled: v } })}
        />
      }
    />
    <SettingRow
      title={t('checkpointCleanupEnabled')}
      description={t('checkpointCleanupEnabledDesc')}
      control={
        <Toggle
          checked={form.checkpointCleanup.enabled}
          onChange={(v) => update({ checkpointCleanup: { enabled: v } })}
        />
      }
    />
    <SettingRow
      title={t('checkpointCleanupInterval')}
      description={t('checkpointCleanupIntervalDesc')}
      control={
        <select
          className={selectControlClass}
          value={form.checkpointCleanup.intervalDays}
          disabled={!form.checkpointCleanup.enabled}
          onChange={(e) =>
            update({
              checkpointCleanup: {
                intervalDays: Number(e.target.value) as AppSettingsV1['checkpointCleanup']['intervalDays']
              }
            })
          }
        >
          {checkpointCleanupIntervalOptions.map((days) => (
            <option key={days} value={days}>
              {t(`checkpointCleanupInterval${days}`)}
            </option>
          ))}
        </select>
      }
    />
    <SettingRow
      title={t('checkpointDirectory')}
      description={t('checkpointDirectoryDesc')}
      control={
        <input
          type="text"
          className={selectControlClass}
          placeholder={t('checkpointDirectoryPlaceholder')}
          value={form.checkpointCleanup.directory ?? ''}
          disabled={!form.checkpointCleanup.createEnabled}
          onChange={(e) => update({ checkpointCleanup: { directory: e.target.value } })}
        />
      }
    />
    <SettingRow
      title={t('checkpointMaxPerThread')}
      description={t('checkpointMaxPerThreadDesc')}
      control={
        <input
          type="number"
          min={1}
          max={100}
          className={selectControlClass}
          value={form.checkpointCleanup.maxPerThread ?? 5}
          disabled={!form.checkpointCleanup.createEnabled}
          onChange={(e) => {
            const n = Number(e.target.value)
            update({
              checkpointCleanup: {
                maxPerThread: Number.isFinite(n)
                  ? Math.max(1, Math.min(100, Math.floor(n)))
                  : 5
              }
            })
          }}
        />
      }
    />
    <SettingRow
      title={t('checkpointMaxTotalBytes')}
      description={t('checkpointMaxTotalBytesDesc')}
      control={
        <input
          type="number"
          min={0}
          className={selectControlClass}
          value={
            form.checkpointCleanup.maxTotalBytes !== undefined
              ? Math.round(form.checkpointCleanup.maxTotalBytes / (1024 * 1024))
              : 2048
          }
          disabled={!form.checkpointCleanup.createEnabled}
          onChange={(e) => {
            const n = Number(e.target.value)
            update({
              checkpointCleanup: {
                maxTotalBytes: Number.isFinite(n) && n >= 0
                  ? Math.floor(n) * 1024 * 1024
                  : 2048 * 1024 * 1024
              }
            })
          }}
        />
      }
    />
    <SettingRow
      title={t('checkpointMinFreeDiskBytes')}
      description={t('checkpointMinFreeDiskBytesDesc')}
      control={
        <input
          type="number"
          min={0}
          className={selectControlClass}
          value={
            form.checkpointCleanup.minFreeDiskBytes !== undefined
              ? Math.round(form.checkpointCleanup.minFreeDiskBytes / (1024 * 1024))
              : 1024
          }
          disabled={!form.checkpointCleanup.createEnabled}
          onChange={(e) => {
            const n = Number(e.target.value)
            update({
              checkpointCleanup: {
                minFreeDiskBytes: Number.isFinite(n) && n >= 0
                  ? Math.floor(n) * 1024 * 1024
                  : 1024 * 1024 * 1024
              }
            })
          }}
        />
      }
    />
    </SettingsCard>
  )
}
