import { RefreshCw } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { runTrustedUserActivation } from '../../extensions/protected-user-activation'
import { REMOTE_BUTTON_CLASS, RemoteGroup, RemoteSwitch } from './remote-panel-ui'
import { RemoteCompactRow, RemoteDetailHeader, RemoteDisclosure, REMOTE_DETAIL_TEXT } from './remote-compact-ui'
import { desktopConsent, desktopSummary, mobileRequirement } from './remote-access-state'
import { desktopFailureMessage } from './desktop-readiness'
import type { MobileLink } from './useMobileLink'
import type { DesktopAccess } from './useDesktopAccess'

export function RemoteDesktopAccess({ link, desktop, onBack, onDevice }: {
  link: MobileLink; desktop: DesktopAccess; onBack(): void; onDevice(id: string): void
}) {
  const { t } = useTranslation('common')
  const { value, error, busy } = desktop
  const screenGranted = value?.screenRecordingReady === true
  const requirement = mobileRequirement(link, t)
  const grants = link.enabled ? link.state?.grants ?? [] : []
  return <>
    <RemoteDetailHeader title={t('remoteCompact.desktop')} onBack={onBack}>
      <RemoteSwitch checked={Boolean(value?.enabled)} disabled={desktop.toggleDisabled} label={t('remoteCompact.desktop')}
        onToggle={event => runTrustedUserActivation(event, desktop.toggle)} />
    </RemoteDetailHeader>
    {requirement ? <p className={REMOTE_DETAIL_TEXT}>{requirement}</p> : null}
    {error ? <p role="alert" className="text-[12px] text-ds-danger">{error}</p> : null}
    {value?.supported ? <RemoteGroup>
      <RemoteDisclosure title={t('remoteCompact.display')} open={!value.displays.some(d => d.allowed)}
        value={value.displays.filter(d => d.allowed).map(d => d.label).join(', ') || t('remoteCompact.selectDisplay')}>
        <div className="flex flex-col gap-3 px-3 py-3">
          {value.displays.map(display => <label key={display.token} className="flex items-center gap-2 text-[12px] text-ds-ink">
            <input type="checkbox" className="accent-accent" checked={display.allowed}
              disabled={busy || !link.mobileAllowed || !link.enabled}
              onChange={event => runTrustedUserActivation(event, () => {
                const tokens = value.displays.filter(d => d.token === display.token ? event.target.checked : d.allowed).map(d => d.token)
                desktop.configure(value.enabled && tokens.length > 0, tokens)
              })} />
            <span>{display.label} <span className="text-ds-muted">· {display.pixelWidth}×{display.pixelHeight}</span></span>
          </label>)}
        </div>
      </RemoteDisclosure>
      <RemoteCompactRow title={t('remoteCompact.screenRecording')}>
        {screenGranted ? <span className="text-[12px] text-ds-muted">{t('remoteCompact.granted')}</span>
          : <button type="button" className={REMOTE_BUTTON_CLASS} disabled={busy} onClick={() => desktop.permission('screenRecording')}>{t('remoteCompact.grant')}</button>}
      </RemoteCompactRow>
      <RemoteCompactRow title={t('remoteCompact.input')}>
        {value.inputReady === true ? <span className="text-[12px] text-ds-muted">{t('remoteCompact.granted')}</span>
          : <button type="button" className={REMOTE_BUTTON_CLASS} disabled={busy} onClick={() => desktop.permission('accessibility')}>{t('remoteCompact.grant')}</button>}
      </RemoteCompactRow>
      {grants.map(grant => <RemoteCompactRow key={grant.id} title={grant.name ?? grant.controllerId} onOpen={() => onDevice(grant.id)}>
        <span className="text-[12px] text-ds-muted">{t(`remoteCompact.${desktopConsent(grant.scopes)}`)}</span>
      </RemoteCompactRow>)}
    </RemoteGroup> : <p className={REMOTE_DETAIL_TEXT}>{desktopSummary(value, t)}</p>}
    {value?.supported && (!screenGranted || value.inputReady !== true) ? <p className={REMOTE_DETAIL_TEXT}>{t('remoteCompact.permissionHint')}</p> : null}
    {value?.lastFailure ? <p role="alert" className="text-[12px] text-ds-danger">{desktopFailureMessage(value.lastFailure, link.zh)}</p> : null}
    <div><button type="button" className={REMOTE_BUTTON_CLASS} disabled={busy} onClick={() => void desktop.refresh()}>
      <RefreshCw size={12} />{t('remoteCompact.recheck')}
    </button></div>
    <p className={REMOTE_DETAIL_TEXT}>{t('remoteCompact.restartHint')}</p>
  </>
}
