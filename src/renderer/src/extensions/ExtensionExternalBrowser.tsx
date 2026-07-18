import {
  AlertTriangle,
  ArrowLeft,
  ArrowRight,
  Home,
  Maximize2,
  Minimize2,
  Monitor,
  RefreshCw,
  Smartphone,
  X,
  ZoomIn,
  ZoomOut
} from 'lucide-react'
import { useCallback, useEffect, useRef, useState, type ReactElement } from 'react'
import { createPortal } from 'react-dom'
import { useTranslation } from 'react-i18next'
import type { ExternalBrowserSite } from '@kun/extension-api'
import type {
  ExtensionExternalBrowserBounds,
  ExtensionExternalBrowserPresentation,
  ExtensionExternalBrowserState
} from '../../../shared/extension-ipc'
import type { RegisteredContribution } from './contribution-registry'
import { extensionWorkbenchClient, type ExtensionViewSession } from './extension-workbench-client'
import { extensionViewSessionContractKey, validateExtensionViewSession } from './ExtensionWebview'
import { boundedPlainText } from './safe-text'

type ExternalContribution = RegisteredContribution<
  | 'views.leftSidebar'
  | 'views.rightSidebar'
  | 'views.auxiliaryPanel'
  | 'views.editorTab'
  | 'views.fullPage'
>

export function ExtensionExternalBrowser({
  contribution,
  workspaceRoot,
  onClose
}: {
  contribution: ExternalContribution
  workspaceRoot?: string
  onClose?: () => void
}): ReactElement {
  const { t } = useTranslation('common')
  const browser = contribution.payload.externalBrowser
  if (!browser) throw new Error('External browser contribution is unavailable.')
  const [attempt, setAttempt] = useState(0)
  const [session, setSession] = useState<ExtensionViewSession | null>(null)
  const [failure, setFailure] = useState<string | null>(null)
  const [browserState, setBrowserState] = useState<ExtensionExternalBrowserState | null>(null)
  const [activeSiteId, setActiveSiteId] = useState(browser.sites[0]!.id)
  const [sitePresentations, setSitePresentations] = useState<
    Partial<Record<string, ExtensionExternalBrowserPresentation>>
  >(() => readPresentationPreferences(contribution.id))
  const [fullscreen, setFullscreen] = useState(false)
  const viewportRef = useRef<HTMLDivElement | null>(null)
  const mountedSessionRef = useRef<string | null>(null)
  const contributionRef = useRef(contribution)
  contributionRef.current = contribution
  const normalizedWorkspaceRoot = workspaceRoot?.trim() || undefined
  const contractKey = extensionViewSessionContractKey(contribution)
  const activeSite = browser.sites.find((site) => site.id === activeSiteId) ?? browser.sites[0]!
  const activePresentation = sitePresentations[activeSite.id] ?? browser.presentation

  useEffect(() => {
    let disposed = false
    let opened: ExtensionViewSession | null = null
    setSession(null)
    setBrowserState(null)
    setFailure(null)
    mountedSessionRef.current = null
    const opening = extensionWorkbenchClient.createViewSession(
      contribution.id,
      normalizedWorkspaceRoot,
      attempt > 0 ? { retryHost: true } : undefined
    )
    void opening.then((next) => {
      if (disposed) {
        void extensionWorkbenchClient.disposeViewSession(next.sessionId)
        return
      }
      const invalid = validateExtensionViewSession(next, contributionRef.current)
      if (invalid) {
        setFailure(invalid)
        void extensionWorkbenchClient.disposeViewSession(next.sessionId)
        return
      }
      opened = next
      setSession(next)
    }).catch((error: unknown) => {
      if (!disposed) setFailure(errorMessage(error))
    })
    return () => {
      disposed = true
      mountedSessionRef.current = null
      if (opened) void extensionWorkbenchClient.disposeViewSession(opened.sessionId)
    }
  }, [attempt, contractKey, contribution.id, normalizedWorkspaceRoot])

  useEffect(() => window.kunGui.onExtensionExternalBrowserState((state) => {
    if (state.sessionId !== session?.sessionId) return
    setBrowserState(state)
    setActiveSiteId(state.siteId)
    setSitePresentations((current) => current[state.siteId] === state.presentation
      ? current
      : { ...current, [state.siteId]: state.presentation })
  }), [session?.sessionId])

  useEffect(() => {
    writePresentationPreferences(contribution.id, sitePresentations)
  }, [contribution.id, sitePresentations])

  useEffect(() => {
    if (!fullscreen) return
    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') setFullscreen(false)
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [fullscreen])

  const sendControl = useCallback(async (
    request: Parameters<typeof window.kunGui.extensionExternalBrowserControl>[0]
  ): Promise<void> => {
    try {
      const state = await window.kunGui.extensionExternalBrowserControl(request)
      setBrowserState(state)
    } catch (error) {
      setFailure(errorMessage(error))
    }
  }, [])

  useEffect(() => {
    const viewport = viewportRef.current
    if (!viewport || !session) return
    let frame = 0
    const sync = (): void => {
      cancelAnimationFrame(frame)
      frame = requestAnimationFrame(() => {
        const bounds = externalBrowserBounds(viewport)
        const action = mountedSessionRef.current === session.sessionId ? 'bounds' : 'mount'
        if (action === 'mount') mountedSessionRef.current = session.sessionId
        void sendControl(action === 'mount'
          ? {
              sessionId: session.sessionId,
              action,
              siteId: activeSite.id,
              url: activeSite.url,
              presentation: activePresentation,
              bounds
            }
          : { sessionId: session.sessionId, action, bounds })
      })
    }
    const resizeObserver = new ResizeObserver(sync)
    const intersectionObserver = new IntersectionObserver(sync)
    resizeObserver.observe(viewport)
    intersectionObserver.observe(viewport)
    window.addEventListener('resize', sync)
    window.addEventListener('scroll', sync, true)
    sync()
    return () => {
      cancelAnimationFrame(frame)
      resizeObserver.disconnect()
      intersectionObserver.disconnect()
      window.removeEventListener('resize', sync)
      window.removeEventListener('scroll', sync, true)
    }
  }, [activePresentation, activeSite.id, activeSite.url, fullscreen, sendControl, session])

  useEffect(() => {
    if (!session) return
    return () => {
      void sendControl({
        sessionId: session.sessionId,
        action: 'bounds',
        bounds: { x: 0, y: 0, width: 0, height: 0, visible: false }
      })
    }
  }, [sendControl, session])

  const selectSite = (site: ExternalBrowserSite): void => {
    setActiveSiteId(site.id)
    const presentation = sitePresentations[site.id] ?? browser.presentation
    if (session) void sendControl({
      sessionId: session.sessionId,
      action: 'activate',
      siteId: site.id,
      url: site.url,
      presentation
    })
  }
  const selectPresentation = (presentation: ExtensionExternalBrowserPresentation): void => {
    setSitePresentations((current) => ({ ...current, [activeSite.id]: presentation }))
    if (session) void sendControl({
      sessionId: session.sessionId,
      action: 'activate',
      siteId: activeSite.id,
      url: activeSite.url,
      presentation
    })
  }
  const command = (
    action: 'back' | 'forward' | 'reload' | 'zoomIn' | 'zoomOut' | 'zoomReset'
  ): void => {
    if (session) void sendControl({ sessionId: session.sessionId, action })
  }
  const home = (): void => {
    if (session) void sendControl({
      sessionId: session.sessionId,
      action: 'navigate',
      url: activeSite.url
    })
  }
  const title = boundedPlainText(contribution.payload.title, 128)
  const stateMatchesActivePage = browserState?.siteId === activeSite.id &&
    browserState.presentation === activePresentation
  const currentUrl = stateMatchesActivePage ? browserState.url : activeSite.url
  const zoomFactor = stateMatchesActivePage ? browserState.zoomFactor : 1
  const wideAuthenticationViewport = activePresentation === 'mobile' &&
    requiresWideAuthenticationViewport(activeSite.id, currentUrl)
  const expandedMobileViewport = activePresentation === 'mobile' &&
    (fullscreen || wideAuthenticationViewport)

  const content = (
    <section
      className={`ds-extension-view ds-no-drag flex h-full min-h-0 w-full flex-col bg-ds-sidebar ${fullscreen ? 'fixed inset-0 z-[1000]' : ''}`}
      aria-label={t('extensionViewAriaLabel', { title })}
      data-contribution-id={contribution.id}
      data-external-browser-view
      data-browser-fullscreen={fullscreen || undefined}
    >
      <header className="ds-no-drag flex h-9 shrink-0 items-center gap-2 border-b border-ds-border-muted px-2">
        <span className="min-w-0 flex-1 truncate text-[13px] font-semibold text-ds-ink">{title}</span>
        {contribution.owner.kind === 'extension' ? (
          <span className="max-w-36 truncate text-[10px] text-ds-faint">
            {contribution.owner.extensionId}
          </span>
        ) : null}
        {onClose ? (
          <button
            type="button"
            onClick={onClose}
            className="rounded-md p-1 text-ds-faint transition hover:bg-ds-hover hover:text-ds-ink"
            aria-label={t('extensionViewClose', { title })}
          >
            <X className="h-4 w-4" />
          </button>
        ) : null}
      </header>

      <nav className="grid shrink-0 grid-cols-3 gap-1 border-b border-ds-border-muted bg-ds-card/70 p-1" aria-label="内容平台">
        {browser.sites.map((site) => {
          const active = site.id === activeSite.id
          return (
            <button
              key={site.id}
              type="button"
              onClick={() => selectSite(site)}
              aria-current={active ? 'page' : undefined}
              className={`flex min-w-0 items-center justify-center gap-1.5 rounded-lg border px-1.5 py-1.5 text-[12px] font-semibold transition ${active ? 'border-cyan-400/60 bg-cyan-400/10 text-ds-ink' : 'border-transparent text-ds-muted hover:bg-ds-hover hover:text-ds-ink'}`}
            >
              <span
                className="flex h-5 w-5 shrink-0 items-center justify-center rounded-md text-[11px] font-bold text-white"
                style={{ backgroundColor: site.accent || '#2388ff' }}
              >
                {site.badge || site.title.slice(0, 1)}
              </span>
              <span className="truncate">{site.title}</span>
            </button>
          )
        })}
      </nav>

      <div className="flex h-9 shrink-0 items-center gap-0.5 border-b border-ds-border-muted bg-ds-sidebar px-1">
        <ToolbarButton label="后退" disabled={!browserState?.canGoBack} onClick={() => command('back')}>
          <ArrowLeft className="h-4 w-4" />
        </ToolbarButton>
        <ToolbarButton label="前进" disabled={!browserState?.canGoForward} onClick={() => command('forward')}>
          <ArrowRight className="h-4 w-4" />
        </ToolbarButton>
        <ToolbarButton label="刷新" disabled={!session} onClick={() => command('reload')}>
          <RefreshCw className={`h-4 w-4 ${browserState?.loading ? 'animate-spin' : ''}`} />
        </ToolbarButton>
        <ToolbarButton label="主页" disabled={!session} onClick={home}>
          <Home className="h-4 w-4" />
        </ToolbarButton>
        <div className="ml-0.5 min-w-0 flex-1 truncate rounded-lg border border-ds-border-muted bg-ds-card px-2 py-1 text-[11px] text-ds-muted" title={currentUrl}>
          {safeAddress(currentUrl)}
        </div>
        <ToolbarButton
          label={fullscreen ? '退出全屏' : '全屏浏览'}
          disabled={!session}
          onClick={() => setFullscreen((value) => !value)}
        >
          {fullscreen ? <Minimize2 className="h-4 w-4" /> : <Maximize2 className="h-4 w-4" />}
        </ToolbarButton>
      </div>
      <div className="flex h-8 shrink-0 items-center justify-between gap-1 border-b border-ds-border-muted bg-ds-card/40 px-1">
        <div className="flex items-center rounded-lg border border-ds-border-muted bg-ds-sidebar p-0.5" aria-label="页面模式">
          <PresentationButton
            label="网页版"
            active={activePresentation === 'desktop'}
            onClick={() => selectPresentation('desktop')}
          >
            <Monitor className="h-3.5 w-3.5" />
          </PresentationButton>
          <PresentationButton
            label="手机版"
            active={activePresentation === 'mobile'}
            onClick={() => selectPresentation('mobile')}
          >
            <Smartphone className="h-3.5 w-3.5" />
          </PresentationButton>
        </div>
        <div className="flex items-center rounded-lg border border-ds-border-muted bg-ds-sidebar p-0.5" aria-label="页面缩放">
          <ToolbarButton label="缩小" disabled={!session || zoomFactor <= 0.3} onClick={() => command('zoomOut')}>
            <ZoomOut className="h-3.5 w-3.5" />
          </ToolbarButton>
          <button
            type="button"
            onClick={() => command('zoomReset')}
            disabled={!session}
            className="min-w-12 rounded-md px-1.5 py-1 text-[10px] font-semibold text-ds-muted hover:bg-ds-hover hover:text-ds-ink disabled:opacity-40"
            aria-label="重置缩放"
            title="重置为 100%"
          >
            {Math.round(zoomFactor * 100)}%
          </button>
          <ToolbarButton label="放大" disabled={!session || zoomFactor >= 2} onClick={() => command('zoomIn')}>
            <ZoomIn className="h-3.5 w-3.5" />
          </ToolbarButton>
        </div>
      </div>
      <div className="relative h-0.5 shrink-0 overflow-hidden bg-transparent">
        {browserState?.loading ? <div className="absolute inset-y-0 left-0 w-2/3 animate-pulse bg-gradient-to-r from-cyan-400 via-blue-500 to-rose-500" /> : null}
      </div>

      <div
        className={`relative flex min-h-0 flex-1 overflow-hidden ${activePresentation === 'mobile' ? 'items-stretch bg-ds-card/60 p-1' : 'bg-white'}`}
        data-browser-presentation={activePresentation}
      >
        <div
          ref={viewportRef}
          className={`relative min-h-0 w-full bg-white ${activePresentation === 'mobile' ? 'overflow-hidden rounded-[14px] shadow-sm ring-1 ring-ds-border-muted' : ''}`}
          data-mobile-browser-frame={activePresentation === 'mobile' || undefined}
          data-mobile-browser-expanded={expandedMobileViewport || undefined}
          data-authentication-viewport={wideAuthenticationViewport || undefined}
        >
          {!session && !failure ? (
            <div className="absolute inset-0 flex items-center justify-center text-[12px] text-ds-muted">正在启动内容浏览器…</div>
          ) : null}
          {failure || browserState?.error ? (
            <div role="alert" className="absolute inset-0 z-10 flex flex-col items-center justify-center bg-ds-sidebar px-6 text-center">
              <AlertTriangle className="h-8 w-8 text-amber-500" aria-hidden />
              <div className="mt-3 text-[13px] font-semibold text-ds-ink">页面暂时无法打开</div>
              <div className="mt-1 max-w-sm text-[12px] leading-5 text-ds-muted">
                {failure || browserState?.error}
              </div>
              <button
                type="button"
                onClick={() => failure ? setAttempt((value) => value + 1) : home()}
                className="mt-4 inline-flex items-center gap-2 rounded-lg border border-ds-border px-3 py-1.5 text-[12px] font-semibold text-ds-ink hover:bg-ds-hover"
              >
                <RefreshCw className="h-3.5 w-3.5" />
                重新加载
              </button>
            </div>
          ) : null}
        </div>
      </div>
    </section>
  )
  return fullscreen && typeof document !== 'undefined'
    ? createPortal(content, document.body)
    : content
}

function PresentationButton({
  label,
  active,
  onClick,
  children
}: {
  label: string
  active: boolean
  onClick: () => void
  children: ReactElement
}): ReactElement {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      className={`flex items-center gap-1 rounded-md px-1.5 py-0.5 text-[10px] font-semibold transition ${active ? 'bg-ds-hover text-ds-ink shadow-sm' : 'text-ds-muted hover:text-ds-ink'}`}
    >
      {children}
      <span>{label}</span>
    </button>
  )
}

function ToolbarButton({
  label,
  disabled,
  onClick,
  children
}: {
  label: string
  disabled?: boolean
  onClick: () => void
  children: ReactElement
}): ReactElement {
  return (
    <button
      type="button"
      title={label}
      aria-label={label}
      disabled={disabled}
      onClick={onClick}
      className="rounded-md p-1 text-ds-muted transition hover:bg-ds-hover hover:text-ds-ink disabled:cursor-default disabled:opacity-35"
    >
      {children}
    </button>
  )
}

export function externalBrowserBounds(element: HTMLElement): ExtensionExternalBrowserBounds {
  const rect = element.getBoundingClientRect()
  const style = getComputedStyle(element)
  const visible = document.visibilityState === 'visible' &&
    rect.width > 0 &&
    rect.height > 0 &&
    style.display !== 'none' &&
    style.visibility !== 'hidden'
  return {
    x: rect.x,
    y: rect.y,
    width: rect.width,
    height: rect.height,
    visible
  }
}

export function siteForUrl(
  sites: readonly ExternalBrowserSite[],
  rawUrl: string
): ExternalBrowserSite | undefined {
  try {
    const hostname = new URL(rawUrl).hostname.toLowerCase()
    return sites.find((site) => {
      const root = new URL(site.url).hostname.toLowerCase().replace(/^www\./, '')
      return hostname === root || hostname.endsWith(`.${root}`)
    })
  } catch {
    return undefined
  }
}

export function requiresWideAuthenticationViewport(siteId: string, rawUrl: string): boolean {
  try {
    const url = new URL(rawUrl)
    const route = `${url.hostname}${url.pathname}${url.search}`.toLowerCase()
    if (/(^|[./?&=_-])(login|log-in|signin|sign-in|passport|account|auth)([./?&=_-]|$)/.test(route)) {
      return true
    }
    return siteId === 'douyin' && /^\/user\/self(?:\/|$)/i.test(url.pathname)
  } catch {
    return false
  }
}

function safeAddress(rawUrl: string): string {
  try {
    const url = new URL(rawUrl)
    return `${url.hostname}${url.pathname === '/' ? '' : url.pathname}`.slice(0, 160)
  } catch {
    return rawUrl.slice(0, 160)
  }
}

function errorMessage(error: unknown): string {
  return boundedPlainText(error instanceof Error ? error.message : String(error), 1_024)
}

function presentationPreferenceKey(contributionId: string): string {
  return `kun.external-browser.presentation.${contributionId}`
}

function readPresentationPreferences(
  contributionId: string
): Partial<Record<string, ExtensionExternalBrowserPresentation>> {
  if (typeof window === 'undefined') return {}
  try {
    const parsed = JSON.parse(window.localStorage.getItem(
      presentationPreferenceKey(contributionId)
    ) || '{}') as Record<string, unknown>
    return Object.fromEntries(Object.entries(parsed).filter((entry): entry is [
      string,
      ExtensionExternalBrowserPresentation
    ] => entry[1] === 'desktop' || entry[1] === 'mobile'))
  } catch {
    return {}
  }
}

function writePresentationPreferences(
  contributionId: string,
  preferences: Partial<Record<string, ExtensionExternalBrowserPresentation>>
): void {
  if (typeof window === 'undefined') return
  try {
    window.localStorage.setItem(
      presentationPreferenceKey(contributionId),
      JSON.stringify(preferences)
    )
  } catch {
    // Preference persistence is best-effort; browsing remains available without it.
  }
}
