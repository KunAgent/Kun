import { settingsButtonClass } from './settings-button'
import { useCallback, useEffect, useState } from 'react'
import { AlertTriangle, CheckCircle2, FolderOpen, HardDrive, LoaderCircle, RotateCcw } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import type {
  StorageRelocationPreflightPlan,
  StorageRelocationProgress,
  StorageRelocationStatus
} from '@shared/storage-relocation'

export function StorageRelocationSettingsSection(): React.JSX.Element {
  const { t } = useTranslation('settings')
  const [status, setStatus] = useState<StorageRelocationStatus | null>(null)
  const [plan, setPlan] = useState<StorageRelocationPreflightPlan | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [interruptConfirmed, setInterruptConfirmed] = useState(false)
  const api = window.kunGui.storageRelocation

  const refresh = useCallback(async () => {
    try {
      setStatus(await api.getStatus())
      setError('')
    } catch (cause) {
      setError(messageOf(cause))
    }
  }, [api])

  useEffect(() => {
    void refresh()
    return api.onProgress((progress) => {
      setStatus((current) => current ? { ...current, state: 'pending', pending: progress } : current)
    })
  }, [api, refresh])

  const choose = async (): Promise<void> => {
    setBusy(true)
    setError('')
    try {
      const picked = await api.pickDestination(status?.currentDestinationRoot)
      if (!picked.canceled && picked.path) {
        setPlan(await api.preflight(picked.path))
        setInterruptConfirmed(false)
      }
    } catch (cause) {
      setError(messageOf(cause))
    } finally {
      setBusy(false)
    }
  }

  const schedule = async (): Promise<void> => {
    if (!plan) return
    setBusy(true)
    setError('')
    try {
      setStatus(await api.schedule({ plan, interruptActiveWork: interruptConfirmed }))
      setPlan(null)
    } catch (cause) {
      setError(messageOf(cause))
      setBusy(false)
    }
  }

  const restore = async (): Promise<void> => {
    if (!window.confirm(t('storageRelocationRestoreConfirm'))) return
    setBusy(true)
    setError('')
    try {
      setStatus(await api.restoreDefault(true))
    } catch (cause) {
      setError(messageOf(cause))
      setBusy(false)
    }
  }

  return (
    <div className="space-y-5">
      <section className="rounded-[var(--ds-radius-card)] border border-ds-border bg-ds-surface p-5">
        <div className="flex items-start justify-between gap-4">
          <div className="flex min-w-0 gap-3">
            <div className="rounded-xl bg-blue-500/10 p-2.5 text-blue-600"><HardDrive className="h-5 w-5" /></div>
            <div>
              <h2 className="text-[15px] font-semibold text-ds-ink">{t('storageRelocationCurrentTitle')}</h2>
              <p className="mt-1 text-[12px] leading-5 text-ds-muted">{t('storageRelocationCurrentBody')}</p>
            </div>
          </div>
          {status?.state === 'relocated'
            ? <span className="rounded-full bg-emerald-500/10 px-3 py-1 text-xs text-emerald-700 dark:text-emerald-300">{t('storageRelocationRelocated')}</span>
            : null}
        </div>

        <div className="mt-5 space-y-2">
          {status?.roots.map((root) => (
            <div key={root.name} className="grid gap-1 rounded-xl border border-ds-border px-4 py-3 text-xs md:grid-cols-[9rem_1fr]">
              <span className="font-medium text-ds-ink">{root.name} · {formatBytes(root.bytes)}</span>
              <div className="min-w-0 space-y-1 text-ds-muted">
                <p className="break-all"><span className="text-ds-faint">{t('storageRelocationLogicalPath')}:</span> {root.logicalPath}</p>
                <p className="break-all"><span className="text-ds-faint">{t('storageRelocationPhysicalPath')}:</span> {root.physicalPath}</p>
              </div>
            </div>
          ))}
        </div>

        <div className="mt-4 flex flex-wrap items-center justify-between gap-3">
          <span className="text-xs text-ds-muted">{t('storageRelocationUniqueSize')}: {formatBytes(status?.totalUniqueBytes ?? 0)}</span>
          <div className="flex gap-2">
            {status?.state === 'relocated' ? <button className={settingsButtonClass()} type="button"  disabled={busy} onClick={() => void restore()}><RotateCcw className="mr-2 inline h-4 w-4" />{t('storageRelocationRestore')}</button> : null}
            <button type="button" className={settingsButtonClass({ variant: 'primary' })} disabled={busy || !status?.enabled || status?.state === 'pending'} onClick={() => void choose()}>
              <FolderOpen className="mr-2 inline h-4 w-4" />{status?.state === 'relocated' ? t('storageRelocationChange') : t('storageRelocationChoose')}
            </button>
          </div>
        </div>
        {status && !status.enabled ? <p className="mt-3 rounded-xl bg-amber-500/10 px-3 py-2 text-xs text-amber-800 dark:text-amber-200">{status.disabledReason || t('storageRelocationDisabled')}</p> : null}
      </section>

      {plan ? <PreflightCard plan={plan} busy={busy} confirmed={interruptConfirmed} onConfirmed={setInterruptConfirmed} onCancel={() => setPlan(null)} onSchedule={() => void schedule()} t={t} /> : null}
      {status?.pending ? <ProgressCard progress={status.pending} t={t} /> : null}

      {status?.recentReport ? (
        <section className={`rounded-[var(--ds-radius-card)] border p-4 ${status.recentReport.outcome === 'success' ? 'border-emerald-300/60 bg-emerald-500/5' : 'border-amber-300/60 bg-amber-500/5'}`}>
          <div className="flex items-center gap-2 text-sm font-medium text-ds-ink">
            {status.recentReport.outcome === 'success' ? <CheckCircle2 className="h-4 w-4 text-emerald-500" /> : <AlertTriangle className="h-4 w-4 text-amber-500" />}
            {t(`storageRelocationOutcome_${status.recentReport.outcome}`)}
          </div>
          <p className="mt-2 text-xs text-ds-muted">{t('storageRelocationReleased')}: {formatBytes(status.recentReport.releasedBytes)}</p>
        </section>
      ) : null}

      <section className="rounded-[var(--ds-radius-card)] border border-ds-border bg-ds-subtle/40 p-4 text-xs leading-5 text-ds-muted">
        <strong className="text-ds-ink">{t('storageRelocationScopeTitle')}</strong>
        <p className="mt-1">{t('storageRelocationScopeBody')}</p>
      </section>

      {error ? <div role="alert" className="rounded-xl border border-red-300/60 bg-red-500/10 p-3 text-sm text-red-700 dark:text-red-200">{error}</div> : null}
    </div>
  )
}

function PreflightCard(props: {
  plan: StorageRelocationPreflightPlan
  busy: boolean
  confirmed: boolean
  onConfirmed: (value: boolean) => void
  onCancel: () => void
  onSchedule: () => void
  t: (key: string, options?: Record<string, unknown>) => string
}): React.JSX.Element {
  const needsConfirmation = props.plan.activeWork.length > 0
  return <section className="rounded-[var(--ds-radius-card)] border border-blue-300/60 bg-blue-500/5 p-5">
    <h2 className="font-semibold text-ds-ink">{props.t('storageRelocationPreflightTitle')}</h2>
    <dl className="mt-4 grid gap-2 text-xs sm:grid-cols-2">
      <Summary label={props.t('storageRelocationDestination')} value={props.plan.destinationRoot} />
      <Summary label={props.t('storageRelocationExpectedRelease')} value={formatBytes(props.plan.expectedReleasedBytes)} />
      <Summary label={props.t('storageRelocationRequired')} value={formatBytes(props.plan.requiredBytes)} />
      <Summary label={props.t('storageRelocationAvailable')} value={formatBytes(props.plan.availableBytes)} />
    </dl>
    {needsConfirmation ? <div className="mt-4 rounded-xl border border-amber-300/60 bg-amber-500/10 p-3 text-xs text-amber-900 dark:text-amber-100">
      <p className="font-medium">{props.t('storageRelocationActiveWorkTitle')}</p>
      <ul className="mt-2 list-disc space-y-1 pl-5">{props.plan.activeWork.map((item) => <li key={item.id}>{item.label}{!item.interruptible ? ` · ${props.t('storageRelocationCannotStop')}` : ''}</li>)}</ul>
      <label className="mt-3 flex items-start gap-2"><input type="checkbox" checked={props.confirmed} onChange={(event) => props.onConfirmed(event.target.checked)} />{props.t('storageRelocationInterruptConfirm')}</label>
    </div> : null}
    <div className="mt-5 flex justify-end gap-2"><button className={settingsButtonClass()} type="button"  disabled={props.busy} onClick={props.onCancel}>{props.t('cancel')}</button><button type="button" className={settingsButtonClass({ variant: 'primary' })} disabled={props.busy || (needsConfirmation && !props.confirmed) || props.plan.activeWork.some((item) => !item.interruptible)} onClick={props.onSchedule}>{props.t('storageRelocationStart')}</button></div>
  </section>
}

function ProgressCard({ progress, t }: { progress: StorageRelocationProgress; t: (key: string) => string }): React.JSX.Element {
  const percent = progress.totalBytes ? Math.min(100, Math.round(progress.completedBytes / progress.totalBytes * 100)) : 0
  return <section className="rounded-[var(--ds-radius-card)] border border-ds-border bg-ds-surface p-5">
    <div className="flex items-center gap-2 font-medium text-ds-ink"><LoaderCircle className="h-4 w-4 animate-spin text-blue-500" />{t(`storageRelocationPhase_${progress.phase}`)}</div>
    <div className="mt-4 h-2 overflow-hidden rounded-full bg-ds-border"><div className="h-full bg-blue-500" style={{ width: `${percent}%` }} /></div>
    <div className="mt-2 flex justify-between text-xs text-ds-muted"><span className="truncate">{progress.currentItem || progress.message}</span><span>{percent}%</span></div>
  </section>
}

function Summary({ label, value }: { label: string; value: string }): React.JSX.Element {
  return <div className="rounded-xl bg-ds-surface px-3 py-2"><dt className="text-ds-faint">{label}</dt><dd className="mt-1 break-all font-medium text-ds-ink">{value}</dd></div>
}

function formatBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes <= 0) return '0 B'
  const units = ['B', 'KB', 'MB', 'GB', 'TB']
  const index = Math.min(units.length - 1, Math.floor(Math.log(bytes) / Math.log(1024)))
  return `${(bytes / 1024 ** index).toFixed(index > 1 ? 1 : 0)} ${units[index]}`
}

function messageOf(value: unknown): string {
  return value instanceof Error ? value.message : String(value)
}
