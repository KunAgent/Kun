import { settingsButtonClass } from './settings-button'
import { useCallback, useEffect, useRef, useState } from 'react'
import { AlertTriangle, CheckCircle2, LoaderCircle, ShieldAlert, Trash2 } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import type {
  UninstallOptions,
  UninstallPathItem,
  UninstallStatus
} from '@shared/uninstall'

const CONFIRM_WORD = 'UNINSTALL'

export function UninstallSettingsSection(): React.JSX.Element {
  const { t } = useTranslation('settings')
  const [status, setStatus] = useState<UninstallStatus | null>(null)
  const [statusError, setStatusError] = useState('')
  const [deleteAllData, setDeleteAllData] = useState(true)
  const [removeApp, setRemoveApp] = useState(true)
  const [confirmOpen, setConfirmOpen] = useState(false)
  const [acknowledged, setAcknowledged] = useState(false)
  const [typedWord, setTypedWord] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [uninstalling, setUninstalling] = useState(false)
  const api = window.kunGui.uninstall
  const confirmRef = useRef<HTMLDivElement>(null)
  useEffect(() => {
    if (!confirmOpen || typeof document === 'undefined') return
    const previous = document.activeElement as HTMLElement | null
    confirmRef.current?.querySelector<HTMLButtonElement>('[data-uninstall-cancel]')?.focus()
    return () => { if (previous?.isConnected) previous.focus() }
  }, [confirmOpen])

  const refresh = useCallback(async () => {
    try {
      setStatus(await api.getStatus())
      setStatusError('')
    } catch (cause) {
      setStatusError(messageOf(cause))
    }
  }, [api])

  useEffect(() => {
    void refresh()
  }, [refresh])

  const openConfirm = (): void => {
    setAcknowledged(false)
    setTypedWord('')
    setError('')
    setConfirmOpen(true)
  }

  const cancelConfirm = (): void => {
    setConfirmOpen(false)
    setAcknowledged(false)
    setTypedWord('')
  }

  const confirmUninstall = async (): Promise<void> => {
    if (!acknowledged || typedWord !== CONFIRM_WORD || busy) return
    setBusy(true)
    setError('')
    try {
      const options: UninstallOptions = {
        deleteAllData,
        removeApp: removeApp && Boolean(status?.canRemoveApp)
      }
      await api.perform(options)
      setUninstalling(true)
      // The main process quits the app immediately after scheduling cleanup.
    } catch (cause) {
      setError(messageOf(cause))
      setBusy(false)
    }
  }

  const canConfirm = acknowledged && typedWord === CONFIRM_WORD && !busy
  const existingPaths = status?.paths.filter((item) => item.exists) ?? []

  return (
    <div className="space-y-5">
      <section className="rounded-[var(--ds-radius-card)] border border-ds-border bg-ds-surface p-5">
        <div className="flex items-start justify-between gap-4">
          <div className="flex min-w-0 gap-3">
            <div className="rounded-xl bg-red-500/10 p-2.5 text-red-600 dark:text-red-400">
              <Trash2 className="h-5 w-5" />
            </div>
            <div className="min-w-0">
              <h2 className="text-[15px] font-semibold text-ds-ink">{t('uninstallDataTitle')}</h2>
              <p className="mt-1 text-[12px] leading-5 text-ds-muted">{t('uninstallDataBody')}</p>
            </div>
          </div>
          {status?.isPackaged === false ? (
            <span className="shrink-0 rounded-full bg-amber-500/10 px-3 py-1 text-xs text-amber-700 dark:text-amber-200">
              {t('uninstallDevMode')}
            </span>
          ) : null}
        </div>

        <div className="mt-5 space-y-2">
          {statusError ? (
            <p role="alert" className="rounded-xl border border-red-300/60 bg-red-500/10 px-3 py-2 text-xs text-red-700 dark:text-red-200">
              {statusError}
            </p>
          ) : null}
          {!statusError && status && existingPaths.length === 0 ? (
            <p className="rounded-xl border border-ds-border bg-ds-subtle/50 px-3 py-2 text-xs text-ds-muted">
              {t('uninstallNoDataFound')}
            </p>
          ) : null}
          {existingPaths.map((item) => (
            <div key={item.path} className="grid gap-1 rounded-xl border border-ds-border px-4 py-3 text-xs md:grid-cols-[10rem_1fr]">
              <span className="font-medium text-ds-ink">{t(`uninstallPathKind_${item.kind}`)}</span>
              <p className="min-w-0 break-all font-mono text-[11px] text-ds-muted">{item.path}</p>
            </div>
          ))}
          {status?.canRemoveApp && status.appInstallPath ? (
            <div className="grid gap-1 rounded-xl border border-ds-border bg-ds-subtle/30 px-4 py-3 text-xs md:grid-cols-[10rem_1fr]">
              <span className="font-medium text-ds-ink">{t('uninstallRemoveApp')}</span>
              <p className="min-w-0 break-all font-mono text-[11px] text-ds-muted">{status.appInstallPath}</p>
            </div>
          ) : null}
        </div>
      </section>

      <section className="rounded-[var(--ds-radius-card)] border border-ds-border bg-ds-surface p-5">
        <div className="space-y-3">
          <label className="flex cursor-pointer items-start gap-3">
            <input
              type="checkbox"
              className="mt-0.5 h-4 w-4 accent-red-600"
              checked={deleteAllData}
              onChange={(event) => setDeleteAllData(event.target.checked)}
            />
            <span className="text-[13px] leading-5 text-ds-ink">{t('uninstallDeleteData')}</span>
          </label>
          {status?.canRemoveApp ? (
            <label className="flex cursor-pointer items-start gap-3">
              <input
                type="checkbox"
                className="mt-0.5 h-4 w-4 accent-red-600"
                checked={removeApp}
                onChange={(event) => setRemoveApp(event.target.checked)}
              />
              <span className="text-[13px] leading-5 text-ds-ink">{t('uninstallRemoveApp')}</span>
            </label>
          ) : null}
          {status && !status.canRemoveApp && status.appRemovalHint ? (
            <p className="rounded-xl bg-amber-500/10 px-3 py-2 text-xs leading-5 text-amber-800 dark:text-amber-200">
              {status.appRemovalHint}
            </p>
          ) : null}
        </div>

        <div className="mt-5 flex flex-wrap items-center justify-between gap-3">
          <span className="text-xs text-ds-muted">
            {status
              ? `${existingPaths.length} ${t('uninstallPathCountSuffix')}`
              : ''}
          </span>
          <button className={settingsButtonClass({ variant: 'danger' })}
            type="button"
            disabled={!status || statusError !== '' || uninstalling}
            onClick={openConfirm}
          >
            <Trash2 className="h-4 w-4" />
            {t('uninstallAction')}
          </button>
        </div>
      </section>

      <section className="rounded-[var(--ds-radius-card)] border border-red-300/50 bg-red-500/5 p-4 text-xs leading-5 text-ds-muted">
        <strong className="flex items-center gap-1.5 text-ds-ink">
          <ShieldAlert className="h-3.5 w-3.5 text-red-500" />
          {t('uninstallWarningTitle')}
        </strong>
        <p className="mt-1">{t('uninstallWarningBody')}</p>
      </section>

      {error ? (
        <div role="alert" className="rounded-xl border border-red-300/60 bg-red-500/10 p-3 text-sm text-red-700 dark:text-red-200">
          {error}
        </div>
      ) : null}

      {uninstalling ? (
        <div role="status" className="flex items-center gap-2 rounded-xl border border-emerald-300/60 bg-emerald-500/5 p-3 text-sm text-emerald-700 dark:text-emerald-200">
          <CheckCircle2 className="h-4 w-4" />
          {t('uninstallRunning')}
        </div>
      ) : null}

      {confirmOpen ? (
        <div ref={confirmRef} role="dialog" aria-modal="true" aria-label={t('uninstallConfirmTitle')}
          style={{ margin: 0 }}
          className="ds-no-drag fixed inset-0 z-[100] flex items-center justify-center bg-slate-950/35 p-4 backdrop-blur-sm"
          onKeyDown={(event) => {
            if (event.key === 'Escape' && !busy) {
              event.preventDefault()
              event.stopPropagation()
              cancelConfirm()
              return
            }
            if (event.key !== 'Tab') return
            const controls = [...event.currentTarget.querySelectorAll<HTMLElement>('button:not(:disabled),input:not(:disabled)')]
            if (document.activeElement === (event.shiftKey ? controls[0] : controls.at(-1))) {
              event.preventDefault()
              ;(event.shiftKey ? controls.at(-1) : controls[0])?.focus()
            }
          }}>
          <div className="max-h-[calc(100dvh-2rem)] w-[min(480px,94vw)] overflow-y-auto rounded-2xl border border-ds-border bg-ds-card shadow-[0_26px_80px_rgba(20,47,95,0.28)]">
            <div className="flex items-center gap-3 border-b border-ds-border-muted px-5 py-4">
              <div className="rounded-xl bg-red-500/10 p-2 text-red-600 dark:text-red-400">
                <AlertTriangle className="h-5 w-5" />
              </div>
              <div className="min-w-0">
                <h2 className="text-[15px] font-semibold text-ds-ink">{t('uninstallConfirmTitle')}</h2>
                <p className="mt-0.5 text-[12px] text-ds-muted">{t('uninstallConfirmBody')}</p>
              </div>
            </div>
            <div className="space-y-4 px-5 py-4">
              <label className="flex cursor-pointer items-start gap-3">
                <input
                  type="checkbox"
                  className="mt-0.5 h-4 w-4 accent-red-600"
                  checked={acknowledged}
                  onChange={(event) => setAcknowledged(event.target.checked)}
                />
                <span className="text-[13px] leading-5 text-ds-ink">{t('uninstallConfirmAcknowledge')}</span>
              </label>
              <div>
                <label htmlFor="uninstall-confirm-word" className="mb-1.5 block text-[12px] font-medium text-ds-muted">
                  {t('uninstallConfirmType')}
                </label>
                <input
                  id="uninstall-confirm-word"
                  type="text"
                  className="w-full rounded-xl border border-ds-border bg-ds-main px-3 py-2 font-mono text-[13px] text-ds-ink outline-none focus:border-red-400"
                  value={typedWord}
                  spellCheck={false}
                  autoCapitalize="characters"
                  onChange={(event) => setTypedWord(event.target.value)}
                />
              </div>
              <div className="flex justify-end gap-2">
                <button data-uninstall-cancel className={settingsButtonClass()} type="button" disabled={busy} onClick={cancelConfirm}>
                  {t('uninstallConfirmCancel')}
                </button>
                <button aria-busy={Boolean(busy)}
                  type="button"
                  className={settingsButtonClass({ variant: 'danger' })}
                  disabled={!canConfirm}
                  onClick={() => void confirmUninstall()}
                >
                  {busy ? <LoaderCircle className="h-4 w-4 animate-spin" /> : <Trash2 className="h-4 w-4" />}
                  {t('uninstallConfirmButton')}
                </button>
              </div>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  )
}

function messageOf(cause: unknown): string {
  if (cause instanceof Error) return cause.message
  if (typeof cause === 'string') return cause
  return String(cause)
}
