import { RefreshCw } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { REMOTE_BUTTON_CLASS, RemoteGroup, RemoteSwitch } from './remote-panel-ui'
import { runTrustedUserActivation } from '../../extensions/protected-user-activation'
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
      {value.virtualSupported && link.enabled && link.state?.desktopAccess ? <RemoteCompactRow title={link.zh ? '允许手机专用桌面' : 'Allow a mobile display'}
        subtitle={value.active ? link.zh ? '更改共享设置将结束当前远控。' : 'Changing this sharing setting ends the current session.' :
          link.zh ? '连接时创建独立显示器，断开时收回。可把 Mac 窗口移到 Kun Mobile。' : 'A separate display exists for the connection. Move Mac windows to Kun Mobile.'}>
        <RemoteSwitch checked={value.virtualEnabled === true} disabled={busy} label={link.zh ? '允许手机专用桌面' : 'Allow a mobile display'}
          onToggle={event => runTrustedUserActivation(event, () => desktop.setVirtual(!value.virtualEnabled))} />
      </RemoteCompactRow> : null}
      {value.unlockSupported && link.enabled && link.state?.desktopAccess ? <RemoteCompactRow title={link.zh ? '允许锁屏时手动输密码解锁' : 'Allow manual password unlock'}
        subtitle={link.zh ? 'Mac 锁屏时可在获准手机上手动输入本机密码进入桌面，Kun 不保存密码。' : 'Authorized phones can manually enter your Mac password to unlock. Kun never saves the password.'}>
        <RemoteSwitch checked={value.unlockEnabled === true} disabled={busy} label={link.zh ? '允许锁屏时手动输密码解锁' : 'Allow manual password unlock'}
          onToggle={event => runTrustedUserActivation(event, () => desktop.setUnlock(value.unlockEnabled !== true))} />
      </RemoteCompactRow> : null}
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
