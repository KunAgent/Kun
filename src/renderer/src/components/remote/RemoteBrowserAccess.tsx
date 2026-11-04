import { QrCode, RefreshCw } from 'lucide-react'
import { QRCodeSVG } from 'qrcode.react'
import { useTranslation } from 'react-i18next'
import { useEffect } from 'react'
import { RemoteSettingsGroup } from './RemoteSettingsGroup'
import { RemoteDetailHeader, RemoteDisclosure, REMOTE_DETAIL_TEXT } from './remote-compact-ui'
import { REMOTE_BUTTON_CLASS, RemoteCopyButton, RemoteGroup, RemoteSwitch, RemoteUrlRow } from './remote-panel-ui'
import type { RemoteBrowser } from './useRemoteBrowser'

export function BrowserSwitch({ browser }: { browser: RemoteBrowser }) {
  const { t } = useTranslation('common')
  const { status, busy, applyConfig } = browser
  return <RemoteSwitch checked={Boolean(status?.enabled)} label={t('remoteAccessEnable')}
    disabled={busy || !status || (!status.enabled && !status.passwordSet)}
    onToggle={() => void applyConfig({ enabled: !status?.enabled })} />
}

export function RemoteBrowserAccess({ browser, onBack }: { browser: RemoteBrowser; onBack(): void }) {
  const { t } = useTranslation('common')
  const { status, detectTailscale } = browser
  useEffect(() => { void detectTailscale() }, [detectTailscale])
  const urls = status?.urls
  const primary = urls?.primary || urls?.local
  const otherUrls = [...new Set([...(urls?.lan ?? []), urls?.local].filter((url): url is string => Boolean(url) && url !== primary))]
  return <>
    <RemoteDetailHeader title={t('remoteCompact.browser')} onBack={onBack}><BrowserSwitch browser={browser} /></RemoteDetailHeader>
    {status?.running && primary ? <RemoteGroup>
      <div className="flex flex-col items-center gap-3 p-4">
        {urls && urls.lan.length > 0 ? <div className="rounded-xl bg-white p-2" role="img" aria-label={t('remoteAccessQrHint')}><QRCodeSVG value={primary} size={136} marginSize={1} /></div> : <QrCode size={24} aria-hidden className="text-ds-faint" />}
        <span className="w-full break-all text-center font-mono text-[12px] text-ds-ink">{primary}</span>
        <div className="flex flex-wrap justify-center gap-2">
          <RemoteCopyButton text={primary} />
          <button type="button" className={REMOTE_BUTTON_CLASS} onClick={() => void window.kunGui?.openExternal?.(primary)}>{t('remoteAccessOpenLocal')}</button>
        </div>
      </div>
    </RemoteGroup> : null}
    {status ? <RemoteSettingsGroup status={status} busy={browser.busy} tailscale={browser.tailscale}
      tailscaleBusy={browser.tailscaleBusy} applyConfig={browser.applyConfig} savePassword={browser.savePassword}
      detectTailscale={detectTailscale} onError={browser.setError} /> : null}
    {status?.running && otherUrls.length > 0 ? <RemoteGroup>
      <RemoteDisclosure title={t('remoteAccessOtherUrls', { n: otherUrls.length })}>
        <div className="px-3 py-2">{otherUrls.map(url => <RemoteUrlRow key={url} url={url} />)}</div>
      </RemoteDisclosure>
    </RemoteGroup> : null}
    <p className={REMOTE_DETAIL_TEXT}>{t('remoteCompact.browserHttp')}</p>
    {status && status.clients.length > 0 ? <button type="button" disabled={browser.busy} onClick={browser.revokeSessions}
      className="self-start rounded-md py-1 text-[12px] text-ds-danger disabled:opacity-50">{t('remoteCompact.logoutBrowsers')}</button> : null}
    <div><button type="button" className={REMOTE_BUTTON_CLASS} onClick={() => void browser.refresh()} disabled={browser.busy}>
      <RefreshCw size={12} />{t('remoteAccessRefresh')}
    </button></div>
  </>
}
