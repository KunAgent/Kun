import {
  STORAGE_CLEANUP_DEFAULT_OLDER_THAN_DAYS,
  STORAGE_CLEANUP_MAX_DAYS,
  STORAGE_CLEANUP_MIN_DAYS,
  clampStorageCleanupDays,
  type StorageCleanupHistoryEntry,
  type StorageCleanupResult,
  type StorageCleanupStatus,
  type StorageManualItemId
} from '@shared/storage-cleanup'
import { CircleAlert, FolderOpen, LoaderCircle, RefreshCw, ShieldCheck, Trash2 } from 'lucide-react'
import { useEffect, useState, type ReactElement } from 'react'
import { useTranslation } from 'react-i18next'
import { settingsButtonClass } from './settings-button'
import { SettingRow, SettingsCard, Toggle } from './settings-controls'
import { StorageCleanupConsentDialog, StorageCleanupReviewDialog } from './settings-storage-cleanup-dialogs'
import {
  STORAGE_CLEANUP_DAY_PRESETS,
  STORAGE_USAGE_COLORS,
  formatBytes,
  formatStorageDate,
  formatStorageDay
} from './settings-storage-cleanup-support'
import { useStorageCleanup } from './use-storage-cleanup'

type TranslateFn = (key: string, options?: Record<string, unknown>) => string

const NEVER_KEYS = [
  'storageCleanupNeverPinned', 'storageCleanupNeverActive', 'storageCleanupNeverArtifacts',
  'storageCleanupNeverAttachments', 'storageCleanupNeverSkills', 'storageCleanupNeverMemory',
  'storageCleanupNeverSettings', 'storageCleanupNeverWorktrees', 'storageCleanupNeverWorkspace'
]

const TRASH_DAY_OPTIONS = [3, 7, 14, 30]

function ResultNotice({ t, result, onDismiss }: { t: TranslateFn; result: StorageCleanupResult; onDismiss: () => void }): ReactElement {
  return (
    <div role="status" className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-teal-500/30 bg-teal-500/10 px-4 py-3 text-[13px] text-ds-ink">
      <span>
        {t('storageCleanupResultFreed', { size: formatBytes(result.freedBytes) })}
        {result.trashedBytes > 0 ? ` · ${t('storageCleanupResultTrashed', { size: formatBytes(result.trashedBytes) })}` : ''}
        {result.failed > 0 ? ` · ${t('storageCleanupResultFailed', { n: result.failed })}` : ''}
      </span>
      <button type="button" className={settingsButtonClass({ variant: 'ghost', size: 'compact' })} onClick={onDismiss}>
        {t('storageCleanupClose')}
      </button>
    </div>
  )
}

function DaysPicker({ t, value, disabled, onChange }: {
  t: TranslateFn
  value: number
  disabled: boolean
  onChange: (days: number) => void
}): ReactElement {
  const [draft, setDraft] = useState(String(value))
  useEffect(() => setDraft(String(value)), [value])
  const commit = (): void => {
    const next = clampStorageCleanupDays(draft, value)
    setDraft(String(next))
    if (next !== value) onChange(next)
  }
  return (
    <div className="flex flex-wrap items-center justify-end gap-1.5">
      {STORAGE_CLEANUP_DAY_PRESETS.map((days) => (
        <button
          key={days}
          type="button"
          aria-pressed={value === days}
          disabled={disabled}
          className={settingsButtonClass({ variant: value === days ? 'primary' : 'secondary', size: 'compact' })}
          onClick={() => onChange(days)}
        >
          {days === STORAGE_CLEANUP_DEFAULT_OLDER_THAN_DAYS
            ? t('storageCleanupDaysDefault', { days })
            : t('storageCleanupDaysValue', { days })}
        </button>
      ))}
      <label className="ml-1 flex items-center gap-1.5 text-[12px] text-ds-muted">
        {t('storageCleanupCustomDays')}
        <input
          type="number"
          min={STORAGE_CLEANUP_MIN_DAYS}
          max={STORAGE_CLEANUP_MAX_DAYS}
          value={draft}
          disabled={disabled}
          onChange={(event) => setDraft(event.target.value)}
          onBlur={commit}
          onKeyDown={(event) => { if (event.key === 'Enter') commit() }}
          className="h-7 w-16 rounded-md border border-ds-border bg-ds-main px-2 text-[12px] text-ds-ink"
        />
        {t('storageCleanupDaysUnit')}
      </label>
    </div>
  )
}

function autoStatusText(t: TranslateFn, status: StorageCleanupStatus, locale: string): string {
  if (status.state === 'off') return t('storageCleanupAutoOff')
  if (status.state === 'needs_consent') return t('storageCleanupAutoNeedsConsent')
  return t('storageCleanupAutoOn', { date: formatStorageDay(status.config.consent?.at, locale) })
}

function historyLine(t: TranslateFn, entry: StorageCleanupHistoryEntry): string {
  if (entry.reason === 'skipped') return t('storageCleanupReason_skipped')
  const parts = [t(`storageCleanupReason_${entry.reason}`), t('storageCleanupResultFreed', { size: formatBytes(entry.freedBytes) })]
  if (entry.trashedBytes > 0) parts.push(t('storageCleanupResultTrashed', { size: formatBytes(entry.trashedBytes) }))
  return parts.join(' · ')
}

export function StorageCleanupSettingsSection(): ReactElement {
  const { t: translate, i18n } = useTranslation('settings')
  const t = translate as unknown as TranslateFn
  const locale = i18n.language || 'en'
  const state = useStorageCleanup()
  const { api, status, usage, scanning, history, busy, error, result, dialog } = state
  const config = status?.config
  const days = config?.olderThanDays ?? STORAGE_CLEANUP_DEFAULT_OLDER_THAN_DAYS
  const enabled = status ? status.state !== 'off' : false
  const usageTotal = usage?.totalBytes ?? 0

  const updateConfig = (patch: Parameters<typeof api.updateConfig>[0]): void => {
    void state.act(() => api.updateConfig(patch), state.setStatus)
  }
  const toggleAuto = (on: boolean): void => {
    if (on) state.openDialog('consent', days)
    else void state.act(() => api.disable(), state.setStatus)
  }

  return (
    <div className="flex flex-col gap-5">
      {error ? (
        <div role="alert" className="flex items-start gap-2 rounded-xl border border-red-300/60 bg-red-500/10 px-3 py-2 text-[12px] text-red-700 dark:text-red-200">
          <CircleAlert className="mt-0.5 h-3.5 w-3.5 shrink-0" />
          {t('storageCleanupError', { message: error })}
        </div>
      ) : null}
      {result ? <ResultNotice t={t} result={result} onDismiss={state.dismissResult} /> : null}

      <SettingsCard
        title={usage ? t('storageCleanupTotal', { size: formatBytes(usageTotal) }) : t('storageCleanupScanning')}
        description={usage ? t('storageCleanupScannedAt', { time: formatStorageDate(usage.scannedAt, locale) }) : undefined}
        action={(
          <div className="flex shrink-0 gap-2">
            <button type="button" className={settingsButtonClass({ size: 'compact' })} onClick={() => void api.reveal('dataRoot')}>
              <FolderOpen className="h-3.5 w-3.5" strokeWidth={1.8} />
              {t('storageCleanupOpenData')}
            </button>
            <button type="button" className={settingsButtonClass({ size: 'compact' })} disabled={scanning} onClick={() => void state.scan()}>
              {scanning ? <LoaderCircle className="h-3.5 w-3.5 animate-spin" /> : <RefreshCw className="h-3.5 w-3.5" strokeWidth={1.8} />}
              {t('storageCleanupRescan')}
            </button>
          </div>
        )}
      >
        <div className="flex flex-col gap-4 px-3 py-4">
          <div className="flex h-3 gap-0.5 overflow-hidden rounded-full bg-ds-subtle" aria-hidden="true">
            {(usage?.categories ?? []).filter((category) => category.bytes > 0).map((category) => (
              <div key={category.id} className={STORAGE_USAGE_COLORS[category.id]} style={{ flexGrow: category.bytes, flexBasis: 0 }} />
            ))}
          </div>
          <ul className="grid gap-x-6 gap-y-3 sm:grid-cols-2 lg:grid-cols-3">
            {(usage?.categories ?? []).map((category) => (
              <li key={category.id} className="flex gap-2.5">
                <span className={`mt-1.5 h-2.5 w-2.5 shrink-0 rounded-[3px] ${STORAGE_USAGE_COLORS[category.id]}`} aria-hidden="true" />
                <span className="min-w-0">
                  <span className="flex items-baseline gap-2 text-[13px]">
                    <span className="font-medium text-ds-ink">{t(`storageCleanupCat_${category.id}`)}</span>
                    <span className="tabular-nums text-ds-muted">{formatBytes(category.bytes)}</span>
                  </span>
                  <span className="block text-[12px] text-ds-muted">
                    {t(`storageCleanupCatHint_${category.id}`, { size: formatBytes(category.detailBytes ?? 0) })}
                  </span>
                </span>
              </li>
            ))}
          </ul>
        </div>
      </SettingsCard>

      <SettingsCard>
        <SettingRow
          title={t('storageCleanupSafeTitle', { size: formatBytes(usage?.safeCleanBytes ?? 0) })}
          description={t('storageCleanupSafeDesc')}
          control={(
            <button type="button" className={settingsButtonClass({ variant: 'primary' })} disabled={busy} onClick={() => void state.act(() => api.clearCaches(), state.finishRun)}>
              {t('storageCleanupSafeAction')}
            </button>
          )}
        />
      </SettingsCard>

      <SettingsCard title={t('storageCleanupAutoTitle')} description={status ? autoStatusText(t, status, locale) : undefined}
        action={status ? <Toggle checked={enabled} disabled={busy} ariaLabel={t('storageCleanupAutoTitle')} onChange={toggleAuto} /> : undefined}
      >
        {status?.state === 'needs_consent' ? (
          <div className="flex flex-wrap items-center justify-between gap-3 px-3 py-3 text-[12px] text-amber-800 dark:text-amber-200">
            <span>{t('storageCleanupAutoNeedsConsent')}</span>
            <button type="button" className={settingsButtonClass({ size: 'compact' })} onClick={() => state.openDialog('consent', days)}>
              {t('storageCleanupReconfirm')}
            </button>
          </div>
        ) : null}
        <SettingRow
          wideControl
          title={t('storageCleanupAge')}
          description={t('storageCleanupAgeDesc')}
          control={<DaysPicker t={t} value={days} disabled={busy || !status} onChange={(next) => updateConfig({ olderThanDays: next })} />}
        />
        <div className="px-3 py-3.5">
          <div className="text-[13px] font-medium text-ds-ink">{t('storageCleanupRulesTitle')}</div>
          <ul className="mt-2 flex flex-col gap-2">
            {[
              ['storageCleanupRuleThreads', 'storageCleanupRuleThreadsDesc'],
              ['storageCleanupRuleWorktrees', 'storageCleanupRuleWorktreesDesc'],
              ['storageCleanupRuleTraces', 'storageCleanupRuleTracesDesc']
            ].map(([title, desc]) => (
              <li key={title} className="rounded-lg bg-ds-subtle/50 px-3 py-2">
                <div className="text-[13px] text-ds-ink">{t(title!)}</div>
                <div className="text-[12px] text-ds-muted">{t(desc!)}</div>
              </li>
            ))}
          </ul>
        </div>
        <SettingRow
          title={t('storageCleanupNotifyBefore')}
          description={t('storageCleanupNotifyBeforeDesc')}
          control={<Toggle checked={config?.notifyBefore ?? true} disabled={busy || !status} onChange={(value) => updateConfig({ notifyBefore: value })} />}
        />
        <SettingRow
          title={t('storageCleanupTrashDays')}
          description={t('storageCleanupTrashDaysDesc')}
          control={(
            <select
              className="h-8 rounded-lg border border-ds-border bg-ds-main px-2 text-[13px] text-ds-ink"
              value={config?.trashDays ?? 7}
              disabled={busy || !status}
              onChange={(event) => updateConfig({ trashDays: Number(event.target.value) })}
            >
              {TRASH_DAY_OPTIONS.map((value) => <option key={value} value={value}>{t('storageCleanupDaysValue', { days: value })}</option>)}
            </select>
          )}
        />
        <div className="flex flex-wrap items-center justify-between gap-3 px-3 py-3.5">
          <div className="text-[12px] text-ds-muted">
            {status?.state === 'pending' && status.nextRunAt
              ? t('storageCleanupPendingRun', { date: formatStorageDate(status.nextRunAt, locale) })
              : status?.nextRunAt ? t('storageCleanupNextRun', { date: formatStorageDate(status.nextRunAt, locale) }) : null}
          </div>
          <div className="flex flex-wrap gap-2">
            {status?.state === 'pending' ? (
              <button type="button" className={settingsButtonClass()} disabled={busy} onClick={() => void state.act(() => api.skipPendingRun(), state.setStatus)}>
                {t('storageCleanupSkip')}
              </button>
            ) : null}
            <button type="button" className={settingsButtonClass({ variant: 'primary' })} disabled={busy} onClick={() => state.openDialog('review', days)}>
              {t('storageCleanupPreview')}
            </button>
          </div>
        </div>
      </SettingsCard>

      <SettingsCard>
        <div className="px-3 py-3.5">
          <div className="flex items-center gap-2 text-[13px] font-medium text-ds-ink">
            <ShieldCheck className="h-4 w-4 text-teal-600" strokeWidth={1.8} aria-hidden="true" />
            {t('storageCleanupNeverTitle')}
          </div>
          <ul className="mt-2.5 flex flex-wrap gap-1.5">
            {NEVER_KEYS.map((key) => <li key={key} className="rounded-full bg-ds-subtle px-2.5 py-1 text-[12px] text-ds-ink">{t(key)}</li>)}
          </ul>
        </div>
      </SettingsCard>

      {usage && usage.manual.length > 0 ? (
        <SettingsCard title={t('storageCleanupManualTitle')} description={t('storageCleanupManualDesc')}>
          {usage.manual.map((item) => (
            <SettingRow
              key={item.id}
              title={`${t(`storageCleanupManual_${item.id}`)} · ${formatBytes(item.bytes)}`}
              description={t(`storageCleanupManualHint_${item.id}`)}
              control={item.removable ? (
                <button type="button" className={settingsButtonClass()} disabled={busy} onClick={() => void state.act(() => api.removeMigrationBackups(), state.finishRun)}>
                  {t('storageCleanupMoveToTrash')}
                </button>
              ) : (
                <button type="button" className={settingsButtonClass()} onClick={() => void api.reveal(item.id as StorageManualItemId)}>
                  {t('storageCleanupReveal')}
                </button>
              )}
            />
          ))}
        </SettingsCard>
      ) : null}

      <SettingsCard
        title={t('storageCleanupTrashTitle')}
        description={status && status.trash.entries > 0
          ? t('storageCleanupTrashSummary', { entries: status.trash.entries, size: formatBytes(status.trash.bytes) })
          : t('storageCleanupTrashEmpty')}
        action={status && status.trash.entries > 0 ? (
          <button
            type="button"
            className={settingsButtonClass({ variant: 'danger-ghost', size: 'compact' })}
            disabled={busy}
            onClick={() => {
              if (window.confirm(t('storageCleanupEmptyTrashConfirm'))) void state.act(() => api.emptyTrash(), () => void state.refresh())
            }}
          >
            <Trash2 className="h-3.5 w-3.5" strokeWidth={1.8} />
            {t('storageCleanupEmptyTrash')}
          </button>
        ) : undefined}
      >
        {(status?.trash.runs ?? []).map((run) => (
          <SettingRow
            key={run.runId}
            title={formatStorageDate(run.createdAt, locale)}
            description={t('storageCleanupTrashExpires', { entries: run.entries, size: formatBytes(run.bytes), date: formatStorageDay(run.expiresAt, locale) })}
            control={(
              <button type="button" className={settingsButtonClass()} disabled={busy} onClick={() => void state.act(() => api.restoreTrashRun(run.runId), () => { void state.refresh(); void state.scan() })}>
                {t('storageCleanupRestore')}
              </button>
            )}
          />
        ))}
        <div className="px-3 py-3.5">
          <div className="text-[13px] font-medium text-ds-ink">{t('storageCleanupHistoryTitle')}</div>
          {history.length === 0 ? <div className="mt-1 text-[12px] text-ds-muted">{t('storageCleanupHistoryNone')}</div> : (
            <ul className="mt-2 flex flex-col divide-y divide-ds-border-muted text-[12px]">
              {history.slice(0, 10).map((entry) => (
                <li key={entry.runId} className="grid grid-cols-[9rem_minmax(0,1fr)] gap-3 py-1.5">
                  <span className="text-ds-muted">{formatStorageDate(entry.startedAt, locale)}</span>
                  <span className="text-ds-ink">{historyLine(t, entry)}</span>
                </li>
              ))}
            </ul>
          )}
        </div>
      </SettingsCard>

      {dialog?.kind === 'consent' ? (
        <StorageCleanupConsentDialog
          t={t}
          days={dialog.days}
          plan={dialog.plan}
          busy={busy}
          onCancel={state.closeDialog}
          onReview={() => state.setDialog({ ...dialog, kind: 'review' })}
          onConfirm={() => void state.act(() => api.enable({ olderThanDays: dialog.days }), (next) => {
            state.setStatus(next)
            state.closeDialog()
          })}
        />
      ) : null}
      {dialog?.kind === 'review' ? (
        <StorageCleanupReviewDialog
          t={t}
          locale={locale}
          days={dialog.days}
          plan={dialog.plan}
          busy={busy}
          onClose={state.closeDialog}
          onRun={(itemIds) => void state.act(() => api.run({ olderThanDays: dialog.days, itemIds }), state.finishRun)}
        />
      ) : null}
    </div>
  )
}
