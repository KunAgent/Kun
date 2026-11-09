import { useEffect, useState, type ReactElement } from 'react'
import { Eye, EyeOff, Loader2, Radar } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import type { RemoteAccessConfigPatch, RemoteAccessStatus, RemoteTailscaleInfo } from '@shared/remote-access'
import { RemoteDisclosure } from './remote-compact-ui'
import {
  REMOTE_BUTTON_CLASS,
  REMOTE_INPUT_CLASS,
  REMOTE_PRIMARY_BUTTON_CLASS,
  RemoteGroup,
  RemoteRow,
  RemoteRowText,
  RemoteUrlRow
} from './remote-panel-ui'

type Props = {
  status: RemoteAccessStatus
  busy: boolean
  tailscale: RemoteTailscaleInfo | null
  tailscaleBusy: boolean
  applyConfig: (patch: RemoteAccessConfigPatch) => Promise<void>
  /** Resolves true once the password is saved. */
  savePassword: (password: string) => Promise<boolean>
  detectTailscale: () => Promise<void>
  onError: (message: string) => void
}

function PasswordEditor({
  busy,
  canCancel,
  onCancel,
  savePassword,
  onError
}: {
  busy: boolean
  canCancel: boolean
  onCancel: () => void
  savePassword: Props['savePassword']
  onError: Props['onError']
}): ReactElement {
  const { t } = useTranslation('common')
  const [password, setPassword] = useState('')
  const [confirm, setConfirm] = useState('')
  const [visible, setVisible] = useState(false)
  const save = async (): Promise<void> => {
    if (password !== confirm) {
      onError(t('remoteAccessPasswordMismatch'))
      return
    }
    if (await savePassword(password)) {
      setPassword('')
      setConfirm('')
    }
  }
  return (
    <div className="flex flex-col gap-2 px-3 pb-3 pt-2">
      <div className="relative">
        <input
          type={visible ? 'text' : 'password'}
          autoComplete="new-password"
          placeholder={t('remoteAccessPasswordPlaceholder')}
          aria-label={t('remoteAccessPasswordPlaceholder')}
          value={password}
          onChange={(event) => setPassword(event.target.value)}
          className={`${REMOTE_INPUT_CLASS} w-full pr-8`}
        />
        <button
          type="button"
          onClick={() => setVisible((value) => !value)}
          aria-label={t(visible ? 'remoteAccessHidePassword' : 'remoteAccessShowPassword')}
          title={t(visible ? 'remoteAccessHidePassword' : 'remoteAccessShowPassword')}
          className="absolute right-1.5 top-1/2 -translate-y-1/2 rounded-md p-1 text-ds-muted transition hover:text-ds-ink"
        >
          {visible ? <EyeOff size={14} /> : <Eye size={14} />}
        </button>
      </div>
      <input
        type={visible ? 'text' : 'password'}
        autoComplete="new-password"
        placeholder={t('remoteAccessPasswordConfirmPlaceholder')}
        aria-label={t('remoteAccessPasswordConfirmPlaceholder')}
        value={confirm}
        onChange={(event) => setConfirm(event.target.value)}
        className={REMOTE_INPUT_CLASS}
      />
      <div className="flex gap-2">
        <button
          type="button"
          disabled={busy || password.length === 0}
          onClick={() => void save()}
          className={REMOTE_PRIMARY_BUTTON_CLASS}
        >
          {t('remoteAccessSavePassword')}
        </button>
        {canCancel ? (
          <button type="button" onClick={onCancel} className={REMOTE_BUTTON_CLASS}>
            {t('remoteAccessCancel')}
          </button>
        ) : null}
      </div>
      <p className="text-[11px] leading-4 text-ds-faint">{t('remoteAccessPasswordHint')}</p>
    </div>
  )
}

function tailscaleSubtitle(info: RemoteTailscaleInfo | null): string {
  if (!info) return 'remoteAccessTailscaleShortIdle'
  if (info.connected && info.ipv4) return 'remoteAccessTailscaleShortConnected'
  if (info.installed) return 'remoteAccessTailscaleShortInstalled'
  return 'remoteAccessTailscaleShortMissing'
}

export function RemoteSettingsGroup({
  status,
  busy,
  tailscale,
  tailscaleBusy,
  applyConfig,
  savePassword,
  detectTailscale,
  onError
}: Props): ReactElement {
  const { t } = useTranslation('common')
  const [portInput, setPortInput] = useState(status.port > 0 ? String(status.port) : '')
  useEffect(() => { setPortInput(status.port > 0 ? String(status.port) : '') }, [status.port])
  const locked = busy || status.running
  const tailscaleUrl =
    tailscale?.connected && tailscale.ipv4 ? `http://${tailscale.ipv4}:${status.port}` : ''

  return (
    <RemoteGroup>
        <RemoteDisclosure title={t('remoteAccessPasswordSection')}
          value={t(status.passwordSet ? 'remoteAccessPasswordSet' : 'remoteAccessPasswordUnset')} open={!status.passwordSet}>
          <PasswordEditor busy={busy} canCancel={false} onCancel={() => {}} savePassword={savePassword} onError={onError} />
        </RemoteDisclosure>
        <RemoteDisclosure title={t('remoteAccessNetworkSection')}
          value={`${t(status.bind === 'lan' ? 'remoteAccessBindLan' : 'remoteAccessBindLoopback')} · ${status.port || t('remoteAccessPortAuto')}`}>
        <RemoteRow>
          <label className="min-w-0 flex-1 text-[13px] font-medium text-ds-ink" htmlFor="remote-bind">
            {t('remoteAccessBind')}
          </label>
          <select
            id="remote-bind"
            disabled={locked}
            value={status.bind}
            onChange={(event) =>
              void applyConfig({ bind: event.target.value === 'loopback' ? 'loopback' : 'lan' })
            }
            className={`${REMOTE_INPUT_CLASS} py-1`}
          >
            <option value="lan">{t('remoteAccessBindLan')}</option>
            <option value="loopback">{t('remoteAccessBindLoopback')}</option>
          </select>
        </RemoteRow>
        <RemoteRow>
          <label className="min-w-0 flex-1 text-[13px] font-medium text-ds-ink" htmlFor="remote-port">
            {t('remoteAccessPort')}
          </label>
          <input
            id="remote-port"
            inputMode="numeric"
            disabled={locked}
            value={portInput}
            placeholder={t('remoteAccessPortAuto')}
            onChange={(event) => setPortInput(event.target.value.replace(/[^0-9]/g, ''))}
            className={`${REMOTE_INPUT_CLASS} w-20 py-1 text-right font-mono`}
          />
          {status.running ? null : (
            <button
              type="button"
              disabled={locked}
              onClick={() => void applyConfig({ port: portInput ? Number(portInput) : 0 })}
              className={REMOTE_BUTTON_CLASS}
            >
              {t('remoteAccessApplyPort')}
            </button>
          )}
        </RemoteRow>
        {status.running ? <p className="px-3 pb-3 text-[12px] text-ds-muted">{t('remoteAccessStopToChange')}</p> : null}
        </RemoteDisclosure>
        <RemoteDisclosure title={t('remoteAccessTailscaleSection')} value={t(tailscaleSubtitle(tailscale))}>
        <RemoteRow className="flex-wrap">
          <RemoteRowText
            title={t('remoteAccessTailscaleSection')}
            subtitle={t(tailscaleSubtitle(tailscale))}
            subtitleClassName={tailscaleUrl ? 'text-emerald-600 dark:text-emerald-400' : 'text-ds-muted'}
          />
          <button
            type="button"
            disabled={tailscaleBusy}
            onClick={() => void detectTailscale()}
            className={REMOTE_BUTTON_CLASS}
          >
            {tailscaleBusy ? <Loader2 size={12} className="animate-spin" /> : <Radar size={12} />}
            {t('remoteAccessDetectTailscale')}
          </button>
          {tailscaleUrl ? (
            <div className="w-full">
              <RemoteUrlRow url={tailscaleUrl} tone="success" />
              <p className="px-1 text-[11px] leading-4 text-ds-faint">{t('remoteAccessTailscaleFound')}</p>
            </div>
          ) : tailscale?.installed ? (
            <p className="w-full rounded-lg bg-amber-500/10 px-2.5 py-2 text-[12px] leading-4 text-amber-700 dark:text-amber-300">
              {t('remoteAccessTailscaleInstalled')}
            </p>
          ) : null}
        </RemoteRow>
        </RemoteDisclosure>
    </RemoteGroup>
  )
}
