import { ControlPackageCard } from './ControlPackageCard'
import { ComputerAccessPanel } from './ComputerAccessPanel'
import { useCallback, useEffect, useRef, useState, type ReactElement } from 'react'
import { useTranslation } from 'react-i18next'
import { mobileManagementVisible } from './remote-access-state'
import { RemoteAccessHome } from './RemoteAccessHome'
import { RemoteBrowserAccess } from './RemoteBrowserAccess'
import { RemoteDesktopAccess } from './RemoteDesktopAccess'
import { MobileGrantRow } from './MobileGrantRow'
import { MobilePairingRequests } from './RemoteMobileLink'
import { RemoteDetailHeader } from './remote-compact-ui'
import { REMOTE_BUTTON_CLASS } from './remote-panel-ui'
import { useMobileLink } from './useMobileLink'
import { useRemoteBrowser } from './useRemoteBrowser'
import { useDesktopAccess } from './useDesktopAccess'
import { DirectMobileLink } from './DirectMobileLink'

type View = { page: 'home' | 'browser' | 'desktop' | 'computers' } | { page: 'device'; id: string }

export function RemoteAccessPanel({ className = '' }: { className?: string }): ReactElement {
  const { t } = useTranslation('common')
  const link = useMobileLink()
  const browser = useRemoteBrowser()
  const desktop = useDesktopAccess(link)
  const [view, setView] = useState<View>({ page: 'home' })
  const [directRunning, setDirectRunning] = useState(false)
  const directOwner = link.signedIn ? link.account.state.user?.id ?? 'signed-out' : 'signed-out'
  useEffect(() => { setDirectRunning(false) }, [directOwner])
  const root = useRef<HTMLElement>(null)
  const dirty = useRef(false)
  const scrollPosition = useRef(0)
  const onDirtyChange = useCallback((value: boolean) => { dirty.current = value }, [])
  const mobileVisible = mobileManagementVisible(link)
  const grant = view.page === 'device' && mobileVisible ? link.state?.grants.find(item => item.id === view.id && item.purpose !== 'desktop') : undefined
  function navigate(next: View) {
    if (dirty.current && !window.confirm(t('remoteCompact.discardQuestion'))) return
    dirty.current = false
    if (view.page === 'home') scrollPosition.current = root.current?.scrollTop ?? 0
    setView(next)
    if (root.current) { root.current.scrollTop = next.page === 'home' ? scrollPosition.current : 0; root.current.focus({ preventScroll: true }) }
  }
  useEffect(() => {
    if ((view.page === 'device' && !grant) || (view.page === 'desktop' && !mobileVisible)) {
      dirty.current = false
      setView({ page: 'home' })
    }
  }, [view.page, grant, mobileVisible])
  const error = browser.error || browser.status?.lastError
  return <section ref={root}
    className={`ds-no-drag flex min-h-0 min-w-0 flex-col touch-pan-y overscroll-contain overflow-y-auto overflow-x-hidden bg-ds-sidebar ${className}`}
    aria-label={t('rightPanelRemote')} tabIndex={0}>
    <div className="flex shrink-0 flex-col gap-3.5 px-4 pb-5 pt-5">
      {mobileVisible ? <MobilePairingRequests link={link} /> : null}
      {view.page === 'home' && link.signedIn && link.mobileAllowed ? <ControlPackageCard key={`control-package:${directOwner}`} zh={link.zh} /> : null}
      {desktop.value?.active ? <div role="status" className="flex items-center gap-3 rounded-2xl bg-ds-danger-soft p-3">
        <span className="min-w-0 flex-1 text-[12px] font-medium text-ds-ink">{t('remoteCompact.activeDesktop', { name: desktop.value.active.peer })}</span>
        <button type="button" className={REMOTE_BUTTON_CLASS} disabled={desktop.busy} onClick={desktop.stop}>{t('remoteCompact.endDesktop')}</button>
      </div> : null}
      {error ? <div role="alert" className="space-y-2 rounded-xl bg-ds-danger-soft p-3 text-[12px] leading-4 text-ds-danger">
        <p>{error}</p><button type="button" className={REMOTE_BUTTON_CLASS} onClick={() => void browser.refresh()}>{t('remoteCompact.retry')}</button>
      </div> : null}
      {view.page === 'home' ? <RemoteAccessHome link={link} browser={browser} desktop={desktop} directRunning={directRunning}
        onBrowser={() => navigate({ page: 'browser' })} onDesktop={() => navigate({ page: 'desktop' })}
        onDevice={id => navigate({ page: 'device', id })} /> : null}
      {view.page === 'home' && link.api?.computers ? <button type="button" className={`${REMOTE_BUTTON_CLASS} justify-between`} onClick={() => navigate({ page: 'computers' })}>
        <span>{link.zh ? '电脑与电脑远程桌面 · Max 专享' : 'Computer to computer desktop · Max'}</span>
        <span>{link.state?.pairings.filter(item => item.purpose === 'desktop').length || '→'}</span>
      </button> : null}
      {view.page === 'computers' ? <ComputerAccessPanel key={directOwner} link={link} desktop={desktop} onBack={() => navigate({ page: 'home' })} /> : null}
      {view.page === 'home' ? <DirectMobileLink key={directOwner} onRunningChange={setDirectRunning} /> : null}
      {view.page === 'browser' ? <RemoteBrowserAccess browser={browser} onBack={() => navigate({ page: 'home' })} /> : null}
      {view.page === 'desktop' && mobileVisible ? <RemoteDesktopAccess link={link} desktop={desktop} onBack={() => navigate({ page: 'home' })} /> : null}
      {view.page === 'device' && grant ? <>
        <RemoteDetailHeader title={grant.name ?? grant.controllerId} onBack={() => navigate({ page: 'home' })} />
        <MobileGrantRow key={grant.id} link={link} grant={grant} onDirtyChange={onDirtyChange} />
      </> : null}
    </div>
  </section>
}
