import { useCallback, useEffect, useMemo, useState, type ReactElement } from 'react'
import { ChevronDown, Globe, Loader2, QrCode, RefreshCw } from 'lucide-react'
import { QRCodeSVG } from 'qrcode.react'
import { useTranslation } from 'react-i18next'
import type { RemoteAccessConfigPatch, RemoteAccessStatus, RemoteTailscaleInfo } from '@shared/remote-access'
import { MobileChannelRow, MobileGrantRows, MobilePairingRequests } from './RemoteMobileLink'
import { RemoteSettingsGroup } from './RemoteSettingsGroup'
import { AssistantMailboxSection } from './assistants/AssistantMailboxSection'
import { useMobileLink } from './useMobileLink'
import {
  REMOTE_BUTTON_CLASS,
  RemoteCopyButton,
  RemoteGroup,
  RemoteIconTile,
  RemoteRow,
  RemoteRowText,
  RemoteSection,
  RemoteStatusDot,
  RemoteSwitch,
  RemoteUrlRow,
  describeUserAgent
} from './remote-panel-ui'

type Props = {
  className?: string
}

const EMPTY_URLS = { local: '', lan: [], primary: '', listen: '' }

function errorText(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

export function RemoteAccessPanel({ className = '' }: Props): ReactElement {
  const { t } = useTranslation('common')
  const kunGui = typeof window !== 'undefined' ? window.kunGui : undefined
  const link = useMobileLink()

  const [status, setStatus] = useState<RemoteAccessStatus | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [qrVisible, setQrVisible] = useState(true)
  const [otherUrlsOpen, setOtherUrlsOpen] = useState(false)
  const [tailscale, setTailscale] = useState<RemoteTailscaleInfo | null>(null)
  const [tailscaleBusy, setTailscaleBusy] = useState(false)

  const refresh = useCallback(async (): Promise<void> => {
    if (!kunGui?.remoteAccessGetStatus) return
    try {
      setStatus(await kunGui.remoteAccessGetStatus())
    } catch (loadError) {
      setError(errorText(loadError))
    }
  }, [kunGui])

  useEffect(() => {
    void refresh()
    const unsubscribe = kunGui?.onRemoteAccessStatusChanged?.((next) => setStatus(next))
    return () => unsubscribe?.()
  }, [kunGui, refresh])

  const applyConfig = useCallback(
    async (patch: RemoteAccessConfigPatch): Promise<void> => {
      if (!kunGui?.remoteAccessSetConfig) return
      setBusy(true)
      setError('')
      try {
        setStatus(await kunGui.remoteAccessSetConfig(patch))
      } catch (applyError) {
        setError(errorText(applyError))
      } finally {
        setBusy(false)
      }
    },
    [kunGui]
  )

  const savePassword = useCallback(
    async (password: string): Promise<boolean> => {
      if (!kunGui?.remoteAccessSetPassword) return false
      setBusy(true)
      setError('')
      try {
        setStatus(await kunGui.remoteAccessSetPassword(password))
        return true
      } catch (passwordError) {
        setError(errorText(passwordError))
        return false
      } finally {
        setBusy(false)
      }
    },
    [kunGui]
  )

  const revokeSessions = useCallback(async (): Promise<void> => {
    if (!kunGui?.remoteAccessRevokeSessions) return
    setBusy(true)
    try {
      setStatus(await kunGui.remoteAccessRevokeSessions())
    } finally {
      setBusy(false)
    }
  }, [kunGui])

  const detectTailscale = useCallback(async (): Promise<void> => {
    if (!kunGui?.remoteAccessDetectTailscale) return
    setTailscaleBusy(true)
    try {
      setTailscale(await kunGui.remoteAccessDetectTailscale())
    } catch {
      setTailscale({ installed: false, connected: false, ipv4: null })
    } finally {
      setTailscaleBusy(false)
    }
  }, [kunGui])

  useEffect(() => {
    void detectTailscale()
  }, [detectTailscale])

  const urls = useMemo(() => status?.urls ?? EMPTY_URLS, [status])
  const primaryUrl = urls.primary || urls.local
  const otherUrls = useMemo(() => {
    const rest = urls.lan.filter((url) => url !== urls.primary && url !== urls.local)
    if (urls.local && urls.primary !== urls.local) rest.push(urls.local)
    return rest
  }, [urls])

  const enabled = status?.enabled === true
  const clients = status?.running ? status.clients : []
  const grantCount = link.enabled ? link.state?.grants.length ?? 0 : 0
  const anyChannelOn = Boolean(status?.running) || link.enabled
  const browserSubtitle = !status?.passwordSet
    ? t('remoteAccessPasswordRequired')
    : status.running
      ? clients.length > 0
        ? t('remoteAccessClients', { count: clients.length })
        : t('remoteAccessRunning')
      : t('remoteAccessBrowserOff')

  return (
    <section
      className={`flex min-h-0 flex-col overflow-y-auto bg-ds-sidebar ${className}`}
      aria-label={t('rightPanelRemote')}
    >
      {!status ? (
        <div className="flex items-center justify-center py-10 text-ds-muted">
          <Loader2 size={16} className="animate-spin" />
        </div>
      ) : (
        <div className="flex flex-col gap-4 p-3.5">
          {error || status.lastError ? (
            <div
              role="alert"
              className="rounded-xl bg-ds-danger-soft px-3 py-2 text-[12px] leading-4 text-ds-danger"
            >
              {error || status.lastError}
            </div>
          ) : null}

          <MobilePairingRequests link={link} />

          <RemoteSection
            title={t('remoteAccessChannels')}
            aside={
              <button
                type="button"
                onClick={() => void refresh()}
                disabled={busy}
                aria-label={t('remoteAccessRefresh')}
                title={t('remoteAccessRefresh')}
                className="inline-flex h-5 w-5 items-center justify-center rounded text-ds-faint transition hover:text-ds-ink disabled:opacity-50"
              >
                <RefreshCw size={12} className={busy ? 'animate-spin' : ''} />
              </button>
            }
          >
            <RemoteGroup>
              <RemoteRow>
                <RemoteIconTile active={status.running}>
                  <Globe size={15} />
                </RemoteIconTile>
                <RemoteRowText
                  title={t('remoteAccessBrowserChannel')}
                  subtitle={browserSubtitle}
                  subtitleClassName={
                    status.passwordSet ? 'text-ds-muted' : 'text-amber-600 dark:text-amber-400'
                  }
                />
                <RemoteSwitch
                  checked={enabled}
                  label={t('remoteAccessEnable')}
                  disabled={busy || !status.passwordSet}
                  onToggle={() => void applyConfig({ enabled: !enabled })}
                />
              </RemoteRow>
              <MobileChannelRow link={link} />
            </RemoteGroup>
          </RemoteSection>

          {status.running ? (
            <RemoteSection title={t('remoteAccessUrls')}>
              <RemoteGroup>
                <div className="flex items-start gap-3 p-3">
                  {qrVisible && urls.lan.length > 0 ? (
                    <div className="shrink-0 rounded-lg border border-ds-border-muted bg-white p-1.5">
                      <QRCodeSVG value={urls.primary} size={84} marginSize={1} />
                    </div>
                  ) : null}
                  <div className="flex min-w-0 flex-1 flex-col gap-2">
                    <div className="break-all font-mono text-[12px] font-semibold leading-4 text-ds-ink">
                      {primaryUrl}
                    </div>
                    <div className="flex flex-wrap gap-1.5">
                      <RemoteCopyButton text={primaryUrl} />
                      <button
                        type="button"
                        onClick={() => window.kunGui?.openExternal?.(primaryUrl)}
                        className={REMOTE_BUTTON_CLASS}
                      >
                        {t('remoteAccessOpenLocal')}
                      </button>
                      {urls.lan.length > 0 ? (
                        <button
                          type="button"
                          onClick={() => setQrVisible((visible) => !visible)}
                          aria-expanded={qrVisible}
                          aria-label={t(qrVisible ? 'remoteAccessHideQr' : 'remoteAccessShowQr')}
                          title={t(qrVisible ? 'remoteAccessHideQr' : 'remoteAccessShowQr')}
                          className={`${REMOTE_BUTTON_CLASS} w-7 px-0 ${qrVisible ? 'text-accent' : ''}`}
                        >
                          <QrCode size={13} />
                        </button>
                      ) : null}
                    </div>
                    {qrVisible && urls.lan.length > 0 ? (
                      <p className="text-[11px] leading-4 text-ds-faint">{t('remoteAccessQrHint')}</p>
                    ) : null}
                  </div>
                </div>
                {otherUrls.length > 0 ? (
                  <div>
                    <button
                      type="button"
                      onClick={() => setOtherUrlsOpen((open) => !open)}
                      aria-expanded={otherUrlsOpen}
                      className="flex min-h-[36px] w-full items-center gap-2 px-3 text-left text-[12px] text-ds-muted transition hover:text-ds-ink"
                    >
                      <span className="flex-1">{t('remoteAccessOtherUrls', { n: otherUrls.length })}</span>
                      <ChevronDown
                        size={13}
                        className={`transition ${otherUrlsOpen ? 'rotate-180' : ''}`}
                        aria-hidden="true"
                      />
                    </button>
                    {otherUrlsOpen ? (
                      <div className="flex flex-col px-2 pb-2">
                        {otherUrls.map((url) => (
                          <RemoteUrlRow key={url} url={url} />
                        ))}
                      </div>
                    ) : null}
                  </div>
                ) : null}
              </RemoteGroup>
            </RemoteSection>
          ) : null}

          {clients.length > 0 || grantCount > 0 ? (
            <RemoteSection
              title={t('remoteAccessDevicesSection')}
              aside={
                clients.length > 0 ? (
                  <button
                    type="button"
                    disabled={busy}
                    onClick={() => void revokeSessions()}
                    className="text-[12px] text-ds-danger transition hover:opacity-80 disabled:opacity-50"
                  >
                    {t('remoteAccessRevokeSessions')}
                  </button>
                ) : null
              }
            >
              <RemoteGroup>
                {clients.map((client) => (
                  <RemoteRow key={client.id}>
                    <RemoteStatusDot on />
                    <RemoteRowText
                      title={describeUserAgent(client.userAgent) || t('remoteAccessBrowserClient')}
                      subtitle={client.remoteAddress}
                    />
                  </RemoteRow>
                ))}
                <MobileGrantRows link={link} />
              </RemoteGroup>
            </RemoteSection>
          ) : anyChannelOn ? (
            <p className="flex items-center gap-2 px-1 text-[12px] text-ds-muted">
              <RemoteStatusDot on={false} />
              {t('remoteAccessNoDevices')}
            </p>
          ) : null}

          <AssistantMailboxSection />

          <RemoteSettingsGroup
            status={status}
            busy={busy}
            tailscale={tailscale}
            tailscaleBusy={tailscaleBusy}
            applyConfig={applyConfig}
            savePassword={savePassword}
            detectTailscale={detectTailscale}
            onError={setError}
          />

          <div className="space-y-2 px-1 text-[11px] leading-4 text-ds-faint">
            <p>{t('remoteAccessSecurityHint')} {t('remoteAccessExternalHint')}</p>
            {link.api ? <p>{t('remoteAccessMobileSecurityHint')}</p> : null}
          </div>
        </div>
      )}
    </section>
  )
}
