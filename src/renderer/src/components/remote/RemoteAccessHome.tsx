import { Globe, Info, QrCode, Smartphone } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { MobileChannelRow } from './RemoteMobileLink'
import { BrowserSwitch } from './RemoteBrowserAccess'
import { RemoteCompactRow, REMOTE_FOCUS } from './remote-compact-ui'
import { desktopConsent, desktopSummary } from './remote-access-state'
import { describeUserAgent, RemoteCopyButton, RemoteGroup, RemoteSection } from './remote-panel-ui'
import type { DesktopAccess } from './useDesktopAccess'
import type { MobileLink } from './useMobileLink'
import type { RemoteBrowser } from './useRemoteBrowser'

export function RemoteAccessHome({ link, browser, desktop, onBrowser, onDesktop, onDevice, directRunning = false }: {
  link: MobileLink; browser: RemoteBrowser; desktop: DesktopAccess
  onBrowser(): void; onDesktop(): void; onDevice(id: string): void
  directRunning?: boolean
}) {
  const { t } = useTranslation('common')
  const { status } = browser
  const clients = status?.running ? status.clients : []
  const grants = link.enabled ? link.state?.grants.filter(grant => grant.purpose !== 'desktop') ?? [] : []
  const running = status?.running || link.enabled || desktop.value?.active || directRunning
  const desktopText = desktop.error || desktopSummary(desktop.value, t)
  const warning = link.mobileAllowed && link.enabled && link.state?.desktopAccess && desktop.value?.supported &&
    (!desktop.value.ready || desktop.value.inputReady !== true)
  const primary = status?.running ? status.urls.primary || status.urls.local : ''
  const browserText = !status ? t('remoteCompact.connecting') : status.running ? t('remoteAccessRunning')
    : status.enabled ? t('remoteCompact.browserStarting') : !status.passwordSet ? t('remoteAccessPasswordRequired') : t('remoteAccessStopped')
  return <>
    <header className="relative flex items-start gap-2 px-1 pb-1">
      <div className="min-w-0 flex-1" role="status">
        <h2 className="text-[18px] font-semibold leading-6 text-ds-ink">{t(warning ? 'remoteCompact.setupNeeded' : running ? 'remoteCompact.enabled' : 'remoteCompact.disabled')}</h2>
        <p className="mt-0.5 text-[12px] leading-[18px] text-ds-muted">{warning ? desktopText
          : link.state?.online ? t('remoteCompact.mobileConnected') : directRunning ? link.zh ? '局域网与自建连接已开启' : 'Local network and private connections are on' : clients.length ? t('remoteCompact.browserCount', { n: clients.length })
            : t(running ? 'remoteCompact.onHint' : 'remoteCompact.offHint')}</p>
      </div>
      <details className="group">
        <summary aria-label={t('remoteCompact.security')} title={t('remoteCompact.security')}
          className={`flex h-8 w-8 cursor-pointer list-none items-center justify-center rounded-lg text-ds-muted [&::-webkit-details-marker]:hidden ${REMOTE_FOCUS}`}><Info size={15} /></summary>
        <div className="absolute left-0 right-0 top-10 z-10 space-y-3 rounded-xl border border-ds-border-muted bg-ds-elevated p-3 text-[12px] leading-[18px] text-ds-muted shadow-lg">
          <p>{t('remoteAccessSecurityHint')} {t('remoteAccessExternalHint')}</p>
          <p>{t('remoteAccessMobileSecurityHint')}</p>
        </div>
      </details>
    </header>
    <RemoteGroup>
      <MobileChannelRow link={link} onOpen={onDesktop} detail={link.enabled && link.state?.desktopAccess ? desktopText : undefined} />
      <RemoteCompactRow icon={Globe} title={t('remoteCompact.browser')} subtitle={browserText} onOpen={onBrowser}>
        <BrowserSwitch browser={browser} />
      </RemoteCompactRow>
    </RemoteGroup>
    {primary ? <RemoteGroup><div className="flex min-h-11 items-center gap-2 px-3 py-2">
      <span title={primary} className="min-w-0 flex-1 truncate font-mono text-[12px] text-ds-ink">{primary}</span>
      <RemoteCopyButton text={primary} />
      <button type="button" onClick={onBrowser} aria-label={t('remoteAccessShowQr')} title={t('remoteAccessShowQr')}
        className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-lg text-ds-muted ${REMOTE_FOCUS}`}><QrCode size={15} /></button>
    </div></RemoteGroup> : null}
    {grants.length || clients.length ? <RemoteSection title={t('remoteCompact.devices')}><RemoteGroup>
      {grants.map(grant => <RemoteCompactRow key={grant.id} icon={Smartphone} title={grant.name ?? grant.controllerId}
        onOpen={() => onDevice(grant.id)}>
        <span className="text-[12px] text-ds-muted">{t(desktopConsent(grant.scopes) === 'off' ? 'remoteCompact.authorized' : `remoteCompact.${desktopConsent(grant.scopes)}`)}</span>
      </RemoteCompactRow>)}
      {clients.map(client => <RemoteCompactRow key={client.id} icon={Globe} title={describeUserAgent(client.userAgent) || t('remoteAccessBrowserClient')} subtitle={client.remoteAddress} />)}
    </RemoteGroup></RemoteSection> : null}
  </>
}
