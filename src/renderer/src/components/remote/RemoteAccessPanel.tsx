import { useCallback, useEffect, useMemo, useState, type ReactElement } from 'react'
import { Check, Copy, ExternalLink, Loader2, Radio, RefreshCw, ShieldAlert } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import type { RemoteAccessStatus } from '@shared/remote-access'

type Props = {
  className?: string
}

const EMPTY_URLS = { local: '', lan: [], primary: '', listen: '' }

function RemoteUrlRow({ url, onCopied }: { url: string; onCopied: () => void }): ReactElement {
  const { t } = useTranslation('common')
  const [copied, setCopied] = useState(false)
  const copy = async (): Promise<void> => {
    try {
      await navigator.clipboard.writeText(url)
      setCopied(true)
      onCopied()
      setTimeout(() => setCopied(false), 1500)
    } catch { /* best-effort */ }
  }
  return (
    <div className="flex items-center gap-2 rounded-md border border-ds-border-muted bg-ds-panel px-2.5 py-1.5">
      <span className="min-w-0 flex-1 truncate font-mono text-[12px] text-ds-ink">{url}</span>
      <button
        type="button"
        onClick={() => void copy()}
        aria-label={t('remoteAccessCopyUrl')}
        title={t('remoteAccessCopyUrl')}
        className="inline-flex h-6 w-6 shrink-0 items-center justify-center rounded-md text-ds-muted transition hover:bg-ds-hover hover:text-ds-ink"
      >
        {copied ? <Check size={13} className="text-emerald-500" /> : <Copy size={13} />}
      </button>
    </div>
  )
}

export function RemoteAccessPanel({ className = '' }: Props): ReactElement {
  const { t } = useTranslation('common')
  const kunGui = typeof window !== 'undefined' ? window.kunGui : undefined

  const [status, setStatus] = useState<RemoteAccessStatus | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [passwordInput, setPasswordInput] = useState('')
  const [passwordConfirm, setPasswordConfirm] = useState('')
  const [passwordEditorOpen, setPasswordEditorOpen] = useState(false)
  const [portInput, setPortInput] = useState('')

  const refresh = useCallback(async (): Promise<void> => {
    if (!kunGui?.remoteAccessGetStatus) return
    try {
      setStatus(await kunGui.remoteAccessGetStatus())
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : String(loadError))
    }
  }, [kunGui])

  useEffect(() => {
    void refresh()
    const unsubscribe = kunGui?.onRemoteAccessStatusChanged?.((next) => setStatus(next))
    return () => unsubscribe?.()
  }, [kunGui, refresh])

  useEffect(() => {
    if (status && !portInput) {
      setPortInput(status.port > 0 ? String(status.port) : '')
    }
  }, [status, portInput])

  const applyConfig = useCallback(
    async (patch: Parameters<NonNullable<typeof kunGui>['remoteAccessSetConfig']>[0]): Promise<void> => {
      if (!kunGui?.remoteAccessSetConfig) return
      setBusy(true)
      setError('')
      try {
        setStatus(await kunGui.remoteAccessSetConfig(patch))
      } catch (applyError) {
        setError(applyError instanceof Error ? applyError.message : String(applyError))
      } finally {
        setBusy(false)
      }
    },
    [kunGui]
  )

  const setPassword = useCallback(async (): Promise<void> => {
    if (!kunGui?.remoteAccessSetPassword) return
    if (passwordInput !== passwordConfirm) {
      setError(t('remoteAccessPasswordMismatch'))
      return
    }
    setBusy(true)
    setError('')
    try {
      setStatus(await kunGui.remoteAccessSetPassword(passwordInput))
      setPasswordInput('')
      setPasswordConfirm('')
      setPasswordEditorOpen(false)
    } catch (passwordError) {
      setError(passwordError instanceof Error ? passwordError.message : String(passwordError))
    } finally {
      setBusy(false)
    }
  }, [kunGui, passwordInput, passwordConfirm, t])

  const revokeSessions = useCallback(async (): Promise<void> => {
    if (!kunGui?.remoteAccessRevokeSessions) return
    setBusy(true)
    try {
      setStatus(await kunGui.remoteAccessRevokeSessions())
    } finally {
      setBusy(false)
    }
  }, [kunGui])

  const urls = useMemo(() => status?.urls ?? EMPTY_URLS, [status])
  const allUrls = useMemo(() => {
    const list: string[] = []
    if (urls.local) list.push(urls.local)
    for (const url of urls.lan) if (!list.includes(url)) list.push(url)
    return list
  }, [urls])

  const passwordSection = (
    <div className="flex flex-col gap-2 rounded-lg border border-ds-border-muted bg-ds-sidebar p-3">
      <div className="text-[12px] font-medium text-ds-ink">
        {status?.passwordSet ? t('remoteAccessChangePassword') : t('remoteAccessSetPassword')}
      </div>
      <input
        type="password"
        autoComplete="new-password"
        placeholder={t('remoteAccessPasswordPlaceholder')}
        value={passwordInput}
        onChange={(event) => setPasswordInput(event.target.value)}
        className="rounded-md border border-ds-border-muted bg-ds-panel px-2.5 py-1.5 text-[12px] text-ds-ink outline-none focus:border-accent/60"
      />
      <input
        type="password"
        autoComplete="new-password"
        placeholder={t('remoteAccessPasswordConfirmPlaceholder')}
        value={passwordConfirm}
        onChange={(event) => setPasswordConfirm(event.target.value)}
        className="rounded-md border border-ds-border-muted bg-ds-panel px-2.5 py-1.5 text-[12px] text-ds-ink outline-none focus:border-accent/60"
      />
      <div className="flex gap-2">
        <button
          type="button"
          disabled={busy || passwordInput.length === 0}
          onClick={() => void setPassword()}
          className="inline-flex h-7 items-center rounded-md bg-accent px-3 text-[12px] font-medium text-white transition hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-50"
        >
          {t('remoteAccessSavePassword')}
        </button>
        {status?.passwordSet ? (
          <button
            type="button"
            onClick={() => setPasswordEditorOpen(false)}
            className="inline-flex h-7 items-center rounded-md border border-ds-border-muted px-3 text-[12px] text-ds-muted transition hover:text-ds-ink"
          >
            {t('remoteAccessCancel')}
          </button>
        ) : null}
      </div>
      <p className="text-[11px] leading-4 text-ds-muted">{t('remoteAccessPasswordHint')}</p>
    </div>
  )

  return (
    <section className={`flex min-h-0 flex-col overflow-y-auto bg-ds-sidebar ${className}`} aria-label={t('rightPanelRemote')}>
      <header className="flex items-center gap-2.5 border-b border-ds-border-muted px-4 py-3">
        <div className="flex h-7 w-7 items-center justify-center rounded-md bg-accent/10 text-accent">
          <Radio size={15} aria-hidden="true" />
        </div>
        <div className="min-w-0 flex-1">
          <h2 className="truncate text-[13px] font-semibold text-ds-ink">{t('remoteAccessTitle')}</h2>
          <p className="truncate text-[11px] text-ds-muted">
            {status?.running ? t('remoteAccessRunning') : t('remoteAccessStopped')}
          </p>
        </div>
        <button
          type="button"
          onClick={() => void refresh()}
          disabled={busy}
          aria-label={t('remoteAccessRefresh')}
          title={t('remoteAccessRefresh')}
          className="inline-flex h-7 w-7 items-center justify-center rounded-md text-ds-muted transition hover:bg-ds-hover hover:text-ds-ink disabled:opacity-50"
        >
          <RefreshCw size={14} className={busy ? 'animate-spin' : ''} />
        </button>
      </header>

      <div className="flex flex-col gap-3 p-4">
        {!status ? (
          <div className="flex items-center justify-center py-10 text-ds-muted">
            <Loader2 size={16} className="animate-spin" />
          </div>
        ) : (
          <>
            {error ? (
              <div className="rounded-md border border-red-500/40 bg-red-500/10 px-3 py-2 text-[12px] text-red-500">
                {error}
              </div>
            ) : null}
            {status.lastError ? (
              <div className="rounded-md border border-red-500/40 bg-red-500/10 px-3 py-2 text-[12px] text-red-500">
                {status.lastError}
              </div>
            ) : null}

            {!status.passwordSet ? passwordSection : null}
            {status.passwordSet && passwordEditorOpen ? passwordSection : null}

            <div className="flex items-center justify-between rounded-lg border border-ds-border-muted bg-ds-sidebar px-3 py-2.5">
              <div>
                <div className="text-[12px] font-medium text-ds-ink">{t('remoteAccessEnable')}</div>
                <div className="text-[11px] text-ds-muted">{t('remoteAccessEnableHint')}</div>
              </div>
              <button
                type="button"
                role="switch"
                aria-checked={status.enabled}
                disabled={busy || !status.passwordSet}
                onClick={() => void applyConfig({ enabled: !status.enabled })}
                className={`relative h-[22px] w-10 shrink-0 rounded-full transition ${
                  status.enabled ? 'bg-accent' : 'bg-ds-border-muted'
                } ${busy || !status.passwordSet ? 'cursor-not-allowed opacity-50' : 'cursor-pointer'}`}
              >
                <span
                  className={`absolute top-[3px] h-4 w-4 rounded-full bg-white shadow transition-all ${
                    status.enabled ? 'left-[21px]' : 'left-[3px]'
                  }`}
                />
              </button>
            </div>

            <div className="flex flex-col gap-2 rounded-lg border border-ds-border-muted bg-ds-sidebar p-3">
              <div className="flex items-center justify-between gap-3">
                <label className="text-[12px] font-medium text-ds-ink" htmlFor="remote-bind">
                  {t('remoteAccessBind')}
                </label>
                <select
                  id="remote-bind"
                  disabled={busy || status.running}
                  value={status.bind}
                  onChange={(event) =>
                    void applyConfig({ bind: event.target.value === 'loopback' ? 'loopback' : 'lan' })
                  }
                  className="rounded-md border border-ds-border-muted bg-ds-panel px-2 py-1 text-[12px] text-ds-ink outline-none disabled:opacity-50"
                >
                  <option value="lan">{t('remoteAccessBindLan')}</option>
                  <option value="loopback">{t('remoteAccessBindLoopback')}</option>
                </select>
              </div>
              <div className="flex items-center justify-between gap-3">
                <label className="text-[12px] font-medium text-ds-ink" htmlFor="remote-port">
                  {t('remoteAccessPort')}
                </label>
                <div className="flex items-center gap-1.5">
                  <input
                    id="remote-port"
                    inputMode="numeric"
                    disabled={busy || status.running}
                    value={portInput}
                    placeholder={t('remoteAccessPortAuto')}
                    onChange={(event) => setPortInput(event.target.value.replace(/[^0-9]/g, ''))}
                    className="w-20 rounded-md border border-ds-border-muted bg-ds-panel px-2 py-1 text-right text-[12px] text-ds-ink outline-none disabled:opacity-50"
                  />
                  <button
                    type="button"
                    disabled={busy || status.running}
                    onClick={() => void applyConfig({ port: portInput ? Number(portInput) : 0 })}
                    className="inline-flex h-6 items-center rounded-md border border-ds-border-muted px-2 text-[11px] text-ds-muted transition hover:text-ds-ink disabled:opacity-50"
                  >
                    {t('remoteAccessApplyPort')}
                  </button>
                </div>
              </div>
            </div>

            {status.running ? (
              <div className="flex flex-col gap-2">
                <div className="flex items-center justify-between">
                  <span className="text-[12px] font-medium text-ds-ink">{t('remoteAccessUrls')}</span>
                  <button
                    type="button"
                    onClick={() => window.kunGui?.openExternal?.(urls.local)}
                    className="inline-flex items-center gap-1 text-[11px] text-accent transition hover:opacity-80"
                  >
                    <ExternalLink size={11} />
                    {t('remoteAccessOpenLocal')}
                  </button>
                </div>
                {allUrls.map((url) => (
                  <RemoteUrlRow key={url} url={url} onCopied={() => undefined} />
                ))}
                <div className="flex items-center justify-between rounded-lg border border-ds-border-muted bg-ds-sidebar px-3 py-2">
                  <span className="text-[11px] text-ds-muted">
                    {t('remoteAccessClients', { count: status.clients.length })}
                  </span>
                  {status.clients.length > 0 ? (
                    <button
                      type="button"
                      disabled={busy}
                      onClick={() => void revokeSessions()}
                      className="text-[11px] text-red-500 transition hover:opacity-80 disabled:opacity-50"
                    >
                      {t('remoteAccessRevokeSessions')}
                    </button>
                  ) : null}
                </div>
              </div>
            ) : null}

            {status.passwordSet && !passwordEditorOpen ? (
              <button
                type="button"
                onClick={() => setPasswordEditorOpen(true)}
                className="self-start text-[11px] text-ds-muted underline-offset-2 transition hover:text-ds-ink hover:underline"
              >
                {t('remoteAccessChangePassword')}
              </button>
            ) : null}

            <div className="flex gap-2 rounded-lg border border-amber-500/30 bg-amber-500/10 p-3">
              <ShieldAlert size={14} className="mt-0.5 shrink-0 text-amber-500" aria-hidden="true" />
              <div className="flex flex-col gap-1">
                <p className="text-[11px] leading-4 text-amber-600 dark:text-amber-400">
                  {t('remoteAccessSecurityHint')}
                </p>
                <p className="text-[11px] leading-4 text-ds-muted">{t('remoteAccessExternalHint')}</p>
              </div>
            </div>
          </>
        )}
      </div>
    </section>
  )
}
