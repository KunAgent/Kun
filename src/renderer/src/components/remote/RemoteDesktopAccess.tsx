import { RefreshCw } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { REMOTE_BUTTON_CLASS, RemoteGroup } from './remote-panel-ui'
import { RemoteCompactRow, RemoteDetailHeader, REMOTE_DETAIL_TEXT } from './remote-compact-ui'
import { desktopSummary, mobileRequirement } from './remote-access-state'
import { desktopFailureMessage } from './desktop-readiness'
import type { MobileLink } from './useMobileLink'
import type { DesktopAccess } from './useDesktopAccess'

/** Only unavoidable system setup remains here; desktop and phone consent share the main switch. */
export function RemoteDesktopAccess({ link, desktop, onBack }: {
  link: MobileLink; desktop: DesktopAccess; onBack(): void
}) {
  const { t } = useTranslation('common')
  const { value, error, busy } = desktop
  const screenGranted = value?.screenRecordingReady === true
  const requirement = mobileRequirement(link, t)
  return <>
    <RemoteDetailHeader title={t('remoteCompact.phoneRemote')} onBack={onBack} />
    <p className={REMOTE_DETAIL_TEXT}>{requirement || t('remoteCompact.remoteIncludesDesktop')}</p>
    {error ? <p role="alert" className="text-[12px] text-ds-danger">{error}</p> : null}
    {value?.supported ? <RemoteGroup>
      <RemoteCompactRow title={t('remoteCompact.display')}>
        <span className="min-w-0 text-right text-[12px] text-ds-muted">{value.displays.filter(d => d.allowed).map(d => d.label).join(', ') || t('remoteCompact.defaultDisplay')}</span>
      </RemoteCompactRow>
      <RemoteCompactRow title={t('remoteCompact.screenRecording')}>
        {screenGranted ? <span className="text-[12px] text-ds-muted">{t('remoteCompact.granted')}</span>
          : <button type="button" className={REMOTE_BUTTON_CLASS} disabled={busy} onClick={() => desktop.permission('screenRecording')}>{t('remoteCompact.grant')}</button>}
      </RemoteCompactRow>
      <RemoteCompactRow title={t('remoteCompact.input')}>
        {value.inputReady === true ? <span className="text-[12px] text-ds-muted">{t('remoteCompact.granted')}</span>
          : <button type="button" className={REMOTE_BUTTON_CLASS} disabled={busy} onClick={() => desktop.permission('accessibility')}>{t('remoteCompact.grant')}</button>}
      </RemoteCompactRow>
    </RemoteGroup> : <p className={REMOTE_DETAIL_TEXT}>{desktopSummary(value, t)}</p>}
    {value?.supported && (!screenGranted || value.inputReady !== true) ? <p className={REMOTE_DETAIL_TEXT}>{t('remoteCompact.permissionHint')}</p> : null}
    {value?.lastFailure ? <p role="alert" className="text-[12px] text-ds-danger">{desktopFailureMessage(value.lastFailure, link.zh)}</p> : null}
    <div><button type="button" className={REMOTE_BUTTON_CLASS} disabled={busy} onClick={() => void desktop.refresh()}>
      <RefreshCw size={12} />{t('remoteCompact.recheck')}
    </button></div>
  </>
}
