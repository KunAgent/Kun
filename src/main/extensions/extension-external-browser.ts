import { createHash } from 'node:crypto'
import {
  WebContentsView,
  type BrowserWindow,
  type Rectangle,
  type Session
} from 'electron'
import type {
  ExtensionExternalBrowserBounds,
  ExtensionExternalBrowserPresentation,
  ExtensionExternalBrowserState
} from '../../shared/extension-ipc'
import {
  ExtensionViewSessionError,
  ExtensionViewSessionRegistry,
  isAllowedExternalWebviewUrl,
  type ExtensionViewSessionRecord
} from './extension-view-sessions'
import { isAllowedExternalWebviewSubresource } from './extension-webview-security'

const PAUSE_MEDIA_SCRIPT = `(() => {
  for (const media of document.querySelectorAll('video, audio')) {
    if (typeof media.pause === 'function') media.pause()
  }
})()`

const READ_PAGE_WIDTH_SCRIPT = `(() => ({
  viewportWidth: window.innerWidth,
  contentWidth: Math.max(
    document.documentElement?.scrollWidth || 0,
    document.body?.scrollWidth || 0
  )
}))()`

type ExternalBrowserPage = {
  key: string
  siteId: string
  presentation: ExtensionExternalBrowserPresentation
  view: WebContentsView
  loading: boolean
  manualZoom: boolean
  fitGeneration: number
  fitTimer?: ReturnType<typeof setTimeout>
  fitReference?: {
    contentWidth: number
    viewportPerBoundsPixel: number
  }
  error?: string
}

type ExternalBrowserEntry = {
  sessionId: string
  record: ExtensionViewSessionRecord
  window: BrowserWindow
  pages: Map<string, ExternalBrowserPage>
  activePageKey?: string
  bounds: Rectangle
  visible: boolean
}

type ExternalBrowserViewFactory = (partition: string) => WebContentsView

export class ExtensionExternalBrowserManager {
  private readonly entries = new Map<string, ExternalBrowserEntry>()
  private readonly byWebContentsId = new Map<number, { sessionId: string; pageKey: string }>()
  private readonly hardenedSessions = new WeakSet<Session>()
  private readonly stopSessionObserver: () => void

  constructor(
    private readonly sessions: ExtensionViewSessionRegistry,
    private readonly createView: ExternalBrowserViewFactory = createExternalBrowserView
  ) {
    this.stopSessionObserver = sessions.onDidDispose((record) => this.dispose(record.sessionId))
  }

  mount(
    record: ExtensionViewSessionRecord,
    window: BrowserWindow,
    siteId: string,
    rawUrl: string,
    bounds: ExtensionExternalBrowserBounds,
    presentation: ExtensionExternalBrowserPresentation
  ): ExtensionExternalBrowserState {
    let entry = this.entries.get(record.sessionId)
    if (!entry) {
      entry = {
        sessionId: record.sessionId,
        record,
        window,
        pages: new Map(),
        bounds: { x: 0, y: 0, width: 0, height: 0 },
        visible: false
      }
      this.entries.set(record.sessionId, entry)
      this.sessions.activateHostManaged(record.sessionId)
    } else if (entry.window !== window) {
      throw new ExtensionViewSessionError(
        'EXTENSION_EXTERNAL_BROWSER_PARENT_INVALID',
        'External browser is already attached to another window.'
      )
    }
    this.activate(record.sessionId, siteId, rawUrl, presentation)
    return this.updateBounds(record.sessionId, bounds)
  }

  activate(
    sessionId: string,
    siteId: string,
    rawUrl: string,
    presentation: ExtensionExternalBrowserPresentation
  ): ExtensionExternalBrowserState {
    const entry = this.requireEntry(sessionId)
    this.assertAllowed(entry.record, rawUrl)
    const key = externalBrowserPageKey(siteId, presentation)
    let page = entry.pages.get(key)
    const created = page === undefined
    if (!page) {
      page = this.createPage(entry, key, siteId, presentation)
      entry.pages.set(key, page)
    }

    const previous = this.activePage(entry)
    if (previous && previous.key !== page.key) this.pauseAndHide(previous)
    entry.activePageKey = page.key
    page.view.setBounds(entry.bounds)
    page.view.webContents.setAudioMuted(false)
    page.view.setVisible(entry.visible && page.error === undefined)

    if (created || !page.view.webContents.getURL()) this.loadPage(entry, page, rawUrl)
    else {
      this.updateAutomaticFit(entry, page)
      this.publish(entry, page)
    }
    return this.snapshot(entry, page)
  }

  updateBounds(
    sessionId: string,
    bounds: ExtensionExternalBrowserBounds
  ): ExtensionExternalBrowserState {
    const entry = this.requireEntry(sessionId)
    const contentBounds = entry.window.getContentBounds()
    const zoomFactor = entry.window.webContents.getZoomFactor()
    const normalized = normalizeExternalBrowserBounds(bounds, contentBounds, zoomFactor)
    const widthChanged = entry.bounds.width !== normalized.bounds.width
    entry.bounds = normalized.bounds
    entry.visible = normalized.visible
    const active = this.activePage(entry)
    for (const page of entry.pages.values()) {
      page.view.setBounds(normalized.bounds)
      if (page.key !== entry.activePageKey) page.view.setVisible(false)
    }
    if (active) {
      if (!normalized.visible) this.pauseAndHide(active)
      else {
        active.view.webContents.setAudioMuted(false)
        active.view.setVisible(active.error === undefined)
        if (widthChanged) this.updateAutomaticFit(entry, active)
      }
    }
    return this.snapshot(entry, this.requireActivePage(entry))
  }

  navigate(sessionId: string, rawUrl: string): ExtensionExternalBrowserState {
    const entry = this.requireEntry(sessionId)
    this.assertAllowed(entry.record, rawUrl)
    const page = this.requireActivePage(entry)
    this.loadPage(entry, page, rawUrl)
    return this.snapshot(entry, page)
  }

  command(
    sessionId: string,
    command: 'back' | 'forward' | 'reload' | 'zoomIn' | 'zoomOut' | 'zoomReset'
  ): ExtensionExternalBrowserState {
    const entry = this.requireEntry(sessionId)
    const page = this.requireActivePage(entry)
    page.error = undefined
    page.view.setVisible(entry.visible)
    const guest = page.view.webContents
    const history = guest.navigationHistory
    if (command === 'back' && history.canGoBack()) history.goBack()
    else if (command === 'forward' && history.canGoForward()) history.goForward()
    else if (command === 'reload') guest.reload()
    else if (command === 'zoomReset') {
      this.disableAutomaticFit(page)
      guest.setZoomFactor(1)
    } else if (command === 'zoomIn') {
      this.disableAutomaticFit(page)
      guest.setZoomFactor(nextZoomFactor(guest.getZoomFactor(), 0.1))
    } else if (command === 'zoomOut') {
      this.disableAutomaticFit(page)
      guest.setZoomFactor(nextZoomFactor(guest.getZoomFactor(), -0.1))
    }
    this.publish(entry, page)
    return this.snapshot(entry, page)
  }

  state(sessionId: string): ExtensionExternalBrowserState {
    const entry = this.requireEntry(sessionId)
    return this.snapshot(entry, this.requireActivePage(entry))
  }

  dispose(sessionId: string): boolean {
    const entry = this.entries.get(sessionId)
    if (!entry) return false
    this.entries.delete(sessionId)
    for (const page of entry.pages.values()) this.disposePage(entry, page)
    entry.pages.clear()
    return true
  }

  disposeAll(): void {
    for (const sessionId of [...this.entries.keys()]) this.dispose(sessionId)
  }

  destroy(): void {
    this.stopSessionObserver()
    this.disposeAll()
  }

  private createPage(
    entry: ExternalBrowserEntry,
    key: string,
    siteId: string,
    presentation: ExtensionExternalBrowserPresentation
  ): ExternalBrowserPage {
    const view = this.createView(externalBrowserPartition(entry.record.extensionId, presentation))
    const page: ExternalBrowserPage = {
      key,
      siteId,
      presentation,
      view,
      loading: false,
      manualZoom: false,
      fitGeneration: 0
    }
    this.byWebContentsId.set(view.webContents.id, {
      sessionId: entry.sessionId,
      pageKey: key
    })
    entry.window.contentView.addChildView(view)
    view.setBounds(entry.bounds)
    view.setVisible(false)
    view.setBorderRadius(presentation === 'mobile' ? 14 : 0)
    view.webContents.setAudioMuted(true)
    this.harden(entry, page)
    return page
  }

  private harden(entry: ExternalBrowserEntry, page: ExternalBrowserPage): void {
    const guest = page.view.webContents
    guest.setUserAgent(externalBrowserUserAgent(page.presentation))
    guest.setWindowOpenHandler(({ url }) => {
      if (
        entry.activePageKey === page.key &&
        isAllowedExternalWebviewUrl(url, entry.record.externalWebviewHosts)
      ) {
        this.loadPage(entry, page, url)
      }
      return { action: 'deny' }
    })
    guest.on('will-navigate', (event, url) => {
      if (!isAllowedExternalWebviewUrl(url, entry.record.externalWebviewHosts)) {
        event.preventDefault()
      }
    })
    guest.on('will-redirect', (event, url) => {
      if (!isAllowedExternalWebviewUrl(url, entry.record.externalWebviewHosts)) {
        event.preventDefault()
      }
    })
    guest.on('did-start-navigation', (_event, _url, _isInPlace, isMainFrame) => {
      if (isMainFrame) this.resetAutomaticFit(page)
    })
    guest.on('did-start-loading', () => {
      page.loading = true
      page.error = undefined
      if (entry.activePageKey === page.key) {
        page.view.setVisible(entry.visible)
        this.publish(entry, page)
      }
    })
    guest.on('did-stop-loading', () => {
      page.loading = false
      this.schedulePageFit(entry, page)
      this.publish(entry, page)
    })
    guest.on('did-navigate', () => this.publish(entry, page))
    guest.on('did-navigate-in-page', () => this.publish(entry, page))
    guest.on('page-title-updated', () => this.publish(entry, page))
    guest.on('did-fail-load', (_event, errorCode, errorDescription, _url, isMainFrame) => {
      if (isMainFrame && errorCode !== -3) this.fail(entry, page, errorDescription)
    })
    guest.on('render-process-gone', () => this.fail(entry, page, 'Remote page process exited.'))
    guest.once('destroyed', () => {
      entry.pages.delete(page.key)
      this.byWebContentsId.delete(guest.id)
      if (entry.activePageKey === page.key) entry.activePageKey = undefined
    })

    this.hardenSession(guest.session)
  }

  private hardenSession(target: Session): void {
    if (this.hardenedSessions.has(target)) return
    this.hardenedSessions.add(target)
    target.setPermissionRequestHandler((_contents, _permission, callback) => callback(false))
    target.setPermissionCheckHandler(() => false)
    target.setDevicePermissionHandler(() => false)
    target.on('will-download', (event) => event.preventDefault())
    target.webRequest.onBeforeRequest({ urls: ['<all_urls>'] }, (details, callback) => {
      if (details.resourceType !== 'mainFrame') {
        callback({ cancel: !isAllowedExternalWebviewSubresource(details.url) })
        return
      }
      const guestId = details.webContentsId ?? details.webContents?.id
      const reference = guestId === undefined ? undefined : this.byWebContentsId.get(guestId)
      const entry = reference === undefined ? undefined : this.entries.get(reference.sessionId)
      const page = reference === undefined ? undefined : entry?.pages.get(reference.pageKey)
      callback({
        cancel: !entry || !page || !isAllowedExternalWebviewUrl(
          details.url,
          entry.record.externalWebviewHosts
        )
      })
    })
  }

  private loadPage(
    entry: ExternalBrowserEntry,
    page: ExternalBrowserPage,
    rawUrl: string
  ): void {
    page.error = undefined
    page.loading = true
    if (entry.activePageKey === page.key) page.view.setVisible(entry.visible)
    this.publish(entry, page)
    void page.view.webContents.loadURL(rawUrl).catch((error: unknown) => {
      if (!this.entries.has(entry.sessionId) || !entry.pages.has(page.key)) return
      this.fail(
        entry,
        page,
        error instanceof Error ? error.message : 'Remote page failed to load.'
      )
    })
  }

  private updateAutomaticFit(
    entry: ExternalBrowserEntry,
    page: ExternalBrowserPage
  ): void {
    const guest = page.view.webContents
    if (page.manualZoom || guest.isDestroyed() || entry.bounds.width <= 0) return
    const reference = page.fitReference
    if (!reference) {
      if (!page.loading && guest.getZoomFactor() === 1) this.schedulePageFit(entry, page, 120)
      return
    }
    const viewportWidth = entry.bounds.width * reference.viewportPerBoundsPixel
    const fit = initialExternalBrowserFitZoom(viewportWidth, reference.contentWidth)
    if (Math.abs(guest.getZoomFactor() - fit) < 0.01) return
    guest.setZoomFactor(fit)
    this.publish(entry, page)
  }

  private schedulePageFit(
    entry: ExternalBrowserEntry,
    page: ExternalBrowserPage,
    delay = 0
  ): void {
    this.invalidatePendingFit(page)
    if (
      page.manualZoom ||
      page.loading ||
      entry.activePageKey !== page.key ||
      !entry.visible ||
      entry.bounds.width <= 0
    ) return
    const generation = page.fitGeneration
    page.fitTimer = setTimeout(() => {
      page.fitTimer = undefined
      this.measurePageForFit(entry, page, generation)
    }, delay)
  }

  private measurePageForFit(
    entry: ExternalBrowserEntry,
    page: ExternalBrowserPage,
    generation: number
  ): void {
    const guest = page.view.webContents
    if (
      generation !== page.fitGeneration ||
      page.manualZoom ||
      guest.isDestroyed() ||
      guest.getZoomFactor() !== 1 ||
      entry.bounds.width <= 0
    ) return
    const measuredBoundsWidth = entry.bounds.width
    void guest.executeJavaScript(READ_PAGE_WIDTH_SCRIPT).then((value: unknown) => {
      if (
        generation !== page.fitGeneration ||
        page.manualZoom ||
        guest.isDestroyed() ||
        !this.entries.has(entry.sessionId) ||
        guest.getZoomFactor() !== 1
      ) return
      const metrics = externalBrowserPageWidth(value)
      if (!metrics || measuredBoundsWidth <= 0 || metrics.viewportWidth <= 0) return
      const fit = initialExternalBrowserFitZoom(metrics.viewportWidth, metrics.contentWidth)
      page.fitReference = fit < 1
        ? {
            contentWidth: metrics.contentWidth,
            viewportPerBoundsPixel: metrics.viewportWidth / measuredBoundsWidth
          }
        : undefined
      if (fit < 1) guest.setZoomFactor(fit)
      this.publish(entry, page)
    }).catch(() => undefined)
  }

  private disableAutomaticFit(page: ExternalBrowserPage): void {
    this.invalidatePendingFit(page)
    page.manualZoom = true
    page.fitReference = undefined
  }

  private resetAutomaticFit(page: ExternalBrowserPage): void {
    this.invalidatePendingFit(page)
    page.manualZoom = false
    page.fitReference = undefined
    const guest = page.view.webContents
    if (!guest.isDestroyed() && guest.getZoomFactor() !== 1) guest.setZoomFactor(1)
  }

  private invalidatePendingFit(page: ExternalBrowserPage): void {
    page.fitGeneration += 1
    if (page.fitTimer !== undefined) {
      clearTimeout(page.fitTimer)
      page.fitTimer = undefined
    }
  }

  private pauseAndHide(page: ExternalBrowserPage): void {
    page.view.setVisible(false)
    const guest = page.view.webContents
    guest.setAudioMuted(true)
    if (!guest.isDestroyed()) void guest.executeJavaScript(PAUSE_MEDIA_SCRIPT).catch(() => undefined)
  }

  private disposePage(entry: ExternalBrowserEntry, page: ExternalBrowserPage): void {
    this.invalidatePendingFit(page)
    this.byWebContentsId.delete(page.view.webContents.id)
    if (!entry.window.isDestroyed()) entry.window.contentView.removeChildView(page.view)
    if (!page.view.webContents.isDestroyed()) page.view.webContents.close()
  }

  private fail(entry: ExternalBrowserEntry, page: ExternalBrowserPage, message: string): void {
    page.loading = false
    page.error = message.slice(0, 1024)
    if (entry.activePageKey === page.key) page.view.setVisible(false)
    this.publish(entry, page)
  }

  private assertAllowed(record: ExtensionViewSessionRecord, rawUrl: string): void {
    if (
      record.externalWebviewHosts.length === 0 ||
      !isAllowedExternalWebviewUrl(rawUrl, record.externalWebviewHosts)
    ) {
      throw new ExtensionViewSessionError(
        'EXTENSION_EXTERNAL_BROWSER_DENIED',
        'External browser navigation is not granted.'
      )
    }
  }

  private requireEntry(sessionId: string): ExternalBrowserEntry {
    const entry = this.entries.get(sessionId)
    if (!entry) {
      throw new ExtensionViewSessionError(
        'EXTENSION_EXTERNAL_BROWSER_NOT_FOUND',
        'External browser is not mounted.'
      )
    }
    return entry
  }

  private activePage(entry: ExternalBrowserEntry): ExternalBrowserPage | undefined {
    return entry.activePageKey === undefined ? undefined : entry.pages.get(entry.activePageKey)
  }

  private requireActivePage(entry: ExternalBrowserEntry): ExternalBrowserPage {
    const page = this.activePage(entry)
    if (!page) {
      throw new ExtensionViewSessionError(
        'EXTENSION_EXTERNAL_BROWSER_PAGE_NOT_FOUND',
        'External browser has no active page.'
      )
    }
    return page
  }

  private snapshot(
    entry: ExternalBrowserEntry,
    page: ExternalBrowserPage
  ): ExtensionExternalBrowserState {
    const guest = page.view.webContents
    const history = guest.navigationHistory
    return {
      sessionId: entry.sessionId,
      siteId: page.siteId,
      presentation: page.presentation,
      url: guest.getURL(),
      title: guest.getTitle().slice(0, 256),
      loading: page.loading,
      canGoBack: history.canGoBack(),
      canGoForward: history.canGoForward(),
      zoomFactor: guest.getZoomFactor(),
      ...(page.error ? { error: page.error } : {})
    }
  }

  private publish(entry: ExternalBrowserEntry, page: ExternalBrowserPage): void {
    if (
      entry.activePageKey === page.key &&
      !entry.window.isDestroyed() &&
      !entry.window.webContents.isDestroyed()
    ) {
      entry.window.webContents.send('extension:external-browser-state', this.snapshot(entry, page))
    }
  }
}

function createExternalBrowserView(partition: string): WebContentsView {
  const view = new WebContentsView({
    webPreferences: {
      partition,
      nodeIntegration: false,
      nodeIntegrationInWorker: false,
      nodeIntegrationInSubFrames: false,
      contextIsolation: true,
      sandbox: true,
      webSecurity: true,
      allowRunningInsecureContent: false,
      webviewTag: false,
      navigateOnDragDrop: false,
      safeDialogs: true,
      disableDialogs: true,
      autoplayPolicy: 'document-user-activation-required',
      spellcheck: false,
      backgroundThrottling: true
    }
  })
  view.setBackgroundColor('#ffffff')
  return view
}

export function externalBrowserPartition(
  extensionId: string,
  _presentation: ExtensionExternalBrowserPresentation = 'desktop'
): string {
  // Keep the original desktop partition identity so existing desktop logins survive this
  // migration, while mobile and desktop pages now share the same first-party session.
  const digest = createHash('sha256')
    .update(`external-browser\0desktop\0${extensionId}`)
    .digest('hex')
    .slice(0, 32)
  return `persist:kun-external-${digest}`
}

export function normalizeExternalBrowserBounds(
  input: ExtensionExternalBrowserBounds,
  windowBounds: Pick<Rectangle, 'width' | 'height'>,
  zoomFactor = 1
): { bounds: Rectangle; visible: boolean } {
  const zoom = Number.isFinite(zoomFactor) && zoomFactor > 0 ? zoomFactor : 1
  const x = clamp(Math.round(input.x * zoom), 0, Math.max(0, windowBounds.width))
  const y = clamp(Math.round(input.y * zoom), 0, Math.max(0, windowBounds.height))
  const width = clamp(
    Math.round(input.width * zoom),
    0,
    Math.max(0, windowBounds.width - x)
  )
  const height = clamp(
    Math.round(input.height * zoom),
    0,
    Math.max(0, windowBounds.height - y)
  )
  return {
    bounds: { x, y, width, height },
    visible: input.visible && width > 0 && height > 0
  }
}

export function externalBrowserUserAgent(
  presentation: ExtensionExternalBrowserPresentation = 'desktop'
): string {
  if (presentation === 'mobile') {
    return `Mozilla/5.0 (Linux; Android 15; Pixel 9) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/${process.versions.chrome} Mobile Safari/537.36`
  }
  const platform = process.platform === 'darwin'
    ? 'Macintosh; Intel Mac OS X 10_15_7'
    : process.platform === 'win32'
      ? 'Windows NT 10.0; Win64; x64'
      : 'X11; Linux x86_64'
  return `Mozilla/5.0 (${platform}) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/${process.versions.chrome} Safari/537.36`
}

function externalBrowserPageKey(
  siteId: string,
  presentation: ExtensionExternalBrowserPresentation
): string {
  return `${siteId}\0${presentation}`
}

function nextZoomFactor(current: number, delta: number): number {
  return clamp(Math.round((current + delta) * 10) / 10, 0.3, 2)
}

export function initialExternalBrowserFitZoom(
  viewportWidth: number,
  contentWidth: number
): number {
  if (
    !Number.isFinite(viewportWidth) ||
    !Number.isFinite(contentWidth) ||
    viewportWidth <= 0 ||
    contentWidth <= viewportWidth * 1.1
  ) {
    return 1
  }
  return clamp(Math.floor((viewportWidth / contentWidth) * 10) / 10, 0.3, 1)
}

function externalBrowserPageWidth(value: unknown): {
  viewportWidth: number
  contentWidth: number
} | undefined {
  if (!value || typeof value !== 'object') return undefined
  const viewportWidth = Reflect.get(value, 'viewportWidth')
  const contentWidth = Reflect.get(value, 'contentWidth')
  return typeof viewportWidth === 'number' && typeof contentWidth === 'number'
    ? { viewportWidth, contentWidth }
    : undefined
}

function clamp(value: number, minimum: number, maximum: number): number {
  if (!Number.isFinite(value)) return minimum
  return Math.min(maximum, Math.max(minimum, value))
}
