import { useCallback, useEffect, useMemo, useState, type ReactElement } from 'react'
import {
  Check,
  ChevronDown,
  Copy,
  ExternalLink,
  Eye,
  EyeOff,
  Loader2,
  Lock,
  MonitorSmartphone,
  QrCode,
  Radio,
  RefreshCw,
  ShieldAlert,
  Users
} from 'lucide-react'
import { QRCodeSVG } from 'qrcode.react'
import { useTranslation } from 'react-i18next'
import type { RemoteAccessStatus } from '@shared/remote-access'

type Props = {
  className?: string
}

const EMPTY_URLS = { local: '', lan: [], primary: '', listen: '' }

const CARD_CLASS = 'flex flex-col gap-2.5 rounded-xl border border-ds-border-muted bg-ds-sidebar p-3'
const LABEL_CLASS = 'text-[11px] font-medium uppercase tracking-wide text-ds-muted'
const INPUT_CLASS =
  'rounded-md border border-ds-border-muted bg-ds-panel px-2.5 py-1.5 text-[12px] text-ds-ink outline-none transition focus:border-accent/60 disabled:opacity-50'
const BUTTON_CLASS =
  'inline-flex h-7 items-center gap-1 rounded-md border border-ds-border-muted px-2.5 text-[11px] font-medium text-ds-muted transition hover:border-ds-border hover:text-ds-ink disabled:cursor-not-allowed disabled:opacity-50'

function RemoteUrlRow({ url, emphasized }: { url: string; emphasized?: boolean }): ReactElement {
  const { t } = useTranslation('common')
  const [copied, setCopied] = useState(false)
  const copy = async (): Promise<void> => {
    try {
      await navigator.clipboard.writeText(url)
      setCopied(true)
      setTimeout(() => setCopied(false), 1500)
    } catch { /* best-effort */ }
  }
  return (
    <button
      type="button"
      onClick={() => void copy()}
      title={t('remoteAccessCopyUrl')}
      className={`group flex w-full items-center gap-2 rounded-lg border px-2.5 py-2 text-left transition ${
        emphasized
          ? 'border-accent/40 bg-accent/5'
          : 'border-ds-border-muted bg-ds-panel hover:border-ds-border'
      }`}
    >
      <span
        className={`min-w-0 flex-1 truncate font-mono text-[12px] ${
          emphasized ? 'font-medium text-accent' : 'text-ds-ink'
        }`}
      >
        {url}
      </span>
      {copied ? (
        <Check size={13} className="shrink-0 text-emerald-500" />
      ) : (
        <Copy size={13} className="shrink-0 text-ds-muted transition group-hover:text-ds-ink" />
      )}
    </button>
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
  const [passwordVisible, setPasswordVisible] = useState(false)
  const [passwordEditorOpen, setPasswordEditorOpen] = useState(false)
  const [portInput, setPortInput] = useState('')
  const [qrVisible, setQrVisible] = useState(true)

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
  const lanUrls = useMemo(
    () => urls.lan.filter((url) => url !== urls.primary && url !== urls.local),
    [urls]
  )

  const passwordEditor = (
    <div className="flex flex-col gap-2 border-t border-ds-border-muted pt-2.5">
      <div className="relative">
        <input
          type={passwordVisible ? 'text' : 'password'}
          autoComplete="new-password"
          placeholder={t('remoteAccessPasswordPlaceholder')}
          value={passwordInput}
          onChange={(event) => setPasswordInput(event.target.value)}
          className={`${INPUT_CLASS} w-full pr-8`}
        />
        <button
          type="button"
          onClick={() => setPasswordVisible((visible) => !visible)}
          aria-label={t(passwordVisible ? 'remoteAccessHidePassword' : 'remoteAccessShowPassword')}
          title={t(passwordVisible ? 'remoteAccessHidePassword' : 'remoteAccessShowPassword')}
          className="absolute right-1.5 top-1/2 -translate-y-1/2 rounded-md p-1 text-ds-muted transition hover:text-ds-ink"
        >
          {passwordVisible ? <EyeOff size={14} /> : <Eye size={14} />}
        </button>
      </div>
      <input
        type={passwordVisible ? 'text' : 'password'}
        autoComplete="new-password"
        placeholder={t('remoteAccessPasswordConfirmPlaceholder')}
        value={passwordConfirm}
        onChange={(event) => setPasswordConfirm(event.target.value)}
        className={INPUT_CLASS}
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
            className={BUTTON_CLASS}
          >
            {t('remoteAccessCancel')}
          </button>
        ) : null}
      </div>
      <p className="text-[11px] leading-4 text-ds-muted">{t('remoteAccessPasswordHint')}</p>
    </div>
  )

  const enabled = status?.enabled === true

  return (
    <section
      className={`flex min-h-0 flex-col overflow-y-auto bg-ds-sidebar ${className}`}
      aria-label={t('rightPanelRemote')}
    >
      <header className="flex items-center gap-2.5 border-b border-ds-border-muted px-4 py-3">
        <div className="flex h-7 w-7 items-center justify-center rounded-md bg-accent/10 text-accent">
          <Radio size={15} aria-hidden="true" />
        </div>
        <div className="min-w-0 flex-1">
          <h2 className="truncate text-[13px] font-semibold text-ds-ink">{t('remoteAccessTitle')}</h2>
          <p className="flex items-center gap-1.5 text-[11px] text-ds-muted">
            <span
              className={`inline-block h-1.5 w-1.5 rounded-full ${
                status?.running ? 'bg-emerald-500' : 'bg-ds-border'
              }`}
            />
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
            {error || status.lastError ? (
              <div className="rounded-lg border border-red-500/40 bg-red-500/10 px-3 py-2 text-[12px] text-red-500">
                {error || status.lastError}
              </div>
            ) : null}

            {/* Enable */}
            <div className={CARD_CLASS}>
              <div className="flex items-center justify-between gap-3">
                <div className="flex items-center gap-2.5">
                  <MonitorSmartphone size={15} className="shrink-0 text-ds-muted" aria-hidden="true" />
                  <div>
                    <div className="text-[12px] font-medium text-ds-ink">{t('remoteAccessEnable')}</div>
                    <div className="text-[11px] text-ds-muted">{t('remoteAccessEnableHint')}</div>
                  </div>
                </div>
                <button
                  type="button"
                  role="switch"
                  aria-checked={enabled}
                  disabled={busy || !status.passwordSet}
                  onClick={() => void applyConfig({ enabled: !enabled })}
                  className={`relative h-[22px] w-10 shrink-0 rounded-full transition ${
                    enabled ? 'bg-accent' : 'bg-ds-border-muted'
                  } ${busy || !status.passwordSet ? 'cursor-not-allowed opacity-50' : 'cursor-pointer'}`}
                >
                  <span
                    className={`absolute top-[3px] h-4 w-4 rounded-full bg-white shadow transition-all ${
                      enabled ? 'left-[21px]' : 'left-[3px]'
                    }`}
                  />
                </button>
              </div>
              {!status.passwordSet ? (
                <p className="text-[11px] leading-4 text-amber-600 dark:text-amber-400">
                  {t('remoteAccessPasswordRequired')}
                </p>
              ) : null}
            </div>

            {/* URLs + clients when running */}
            {status.running ? (
              <div className={CARD_CLASS}>
                <div className="flex items-center justify-between">
                  <span className={LABEL_CLASS}>{t('remoteAccessUrls')}</span>
                  <div className="flex items-center gap-2">
                    {urls.lan.length > 0 ? (
                      <button
                        type="button"
                        onClick={() => setQrVisible((visible) => !visible)}
                        className="inline-flex items-center gap-1 text-[11px] text-ds-muted transition hover:text-ds-ink"
                        aria-expanded={qrVisible}
                      >
                        <QrCode size={12} />
                        {t(qrVisible ? 'remoteAccessHideQr' : 'remoteAccessShowQr')}
                      </button>
                    ) : null}
                    <button
                      type="button"
                      onClick={() => window.kunGui?.openExternal?.(urls.primary || urls.local)}
                      className="inline-flex items-center gap-1 text-[11px] text-accent transition hover:opacity-80"
                    >
                      <ExternalLink size={11} />
                      {t('remoteAccessOpenLocal')}
                    </button>
                  </div>
                </div>
                <RemoteUrlRow url={urls.primary || urls.local} emphasized />
                {lanUrls.map((url) => (
                  <RemoteUrlRow key={url} url={url} />
                ))}
                {urls.local && urls.primary !== urls.local ? (
                  <RemoteUrlRow url={urls.local} />
                ) : null}
                {qrVisible && urls.lan.length > 0 ? (
                  <div className="flex flex-col items-center gap-1.5 pt-1">
                    <div className="rounded-lg border border-ds-border-muted bg-white p-2">
                      <QRCodeSVG value={urls.primary} size={120} marginSize={1} />
                    </div>
                    <p className="text-[11px] text-ds-muted">{t('remoteAccessQrHint')}</p>
                  </div>
                ) : null}
                <div className="flex items-center justify-between border-t border-ds-border-muted pt-2.5">
                  <span className="inline-flex items-center gap-1.5 text-[11px] text-ds-muted">
                    <Users size={12} />
                    {status.clients.length > 0
                      ? t('remoteAccessClients', { count: status.clients.length })
                      : t('remoteAccessNoClients')}
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

            {/* Password */}
            <div className={CARD_CLASS}>
              <div className="flex items-center justify-between gap-3">
                <div className="flex items-center gap-2.5">
                  <Lock size={14} className="shrink-0 text-ds-muted" aria-hidden="true" />
                  <span className="text-[12px] font-medium text-ds-ink">
                    {t('remoteAccessPasswordSection')}
                  </span>
                </div>
                <div className="flex items-center gap-2">
                  <span
                    className={`rounded-full px-2 py-0.5 text-[10px] font-medium ${
                      status.passwordSet
                        ? 'bg-emerald-500/10 text-emerald-600 dark:text-emerald-400'
                        : 'bg-amber-500/10 text-amber-600 dark:text-amber-400'
                    }`}
                  >
                    {status.passwordSet ? t('remoteAccessPasswordSet') : t('remoteAccessPasswordUnset')}
                  </span>
                  {status.passwordSet && !passwordEditorOpen ? (
                    <button
                      type="button"
                      onClick={() => setPasswordEditorOpen(true)}
                      className={BUTTON_CLASS}
                    >
                      {t('remoteAccessChangePassword')}
                      <ChevronDown size={12} />
                    </button>
                  ) : null}
                </div>
              </div>
              {!status.passwordSet || passwordEditorOpen ? passwordEditor : null}
            </div>

            {/* Network */}
            <div className={CARD_CLASS}>
              <span className={LABEL_CLASS}>{t('remoteAccessNetworkSection')}</span>
              <div className="flex items-center justify-between gap-3">
                <label className="text-[12px] text-ds-ink" htmlFor="remote-bind">
                  {t('remoteAccessBind')}
                </label>
                <select
                  id="remote-bind"
                  disabled={busy || status.running}
                  value={status.bind}
                  onChange={(event) =>
                    void applyConfig({ bind: event.target.value === 'loopback' ? 'loopback' : 'lan' })
                  }
                  className={`${INPUT_CLASS} py-1`}
                >
                  <option value="lan">{t('remoteAccessBindLan')}</option>
                  <option value="loopback">{t('remoteAccessBindLoopback')}</option>
                </select>
              </div>
              <div className="flex items-center justify-between gap-3">
                <label className="text-[12px] text-ds-ink" htmlFor="remote-port">
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
                    className={`${INPUT_CLASS} w-20 py-1 text-right`}
                  />
                  <button
                    type="button"
                    disabled={busy || status.running}
                    onClick={() => void applyConfig({ port: portInput ? Number(portInput) : 0 })}
                    className={BUTTON_CLASS}
                  >
                    {t('remoteAccessApplyPort')}
                  </button>
                </div>
              </div>
              {status.running ? (
                <p className="text-[11px] leading-4 text-ds-muted">{t('remoteAccessStopToChange')}</p>
              ) : null}
            </div>

            {/* Security notice */}
            <div className="flex gap-2 rounded-xl border border-amber-500/30 bg-amber-500/10 p-3">
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
