import type { Rectangle } from 'electron'
import type {
  BrowserUseMode
} from '../../shared/browser-use'
import type { KunBrowserUseSettingsV1 } from '../../shared/app-settings'
import {
  BrowserUseToolResult,
  type BrowserUseKunApprovalMode,
  type BrowserUseSnapshot,
  type BrowserUseSnapshotNode,
  type BrowserUseToolResult as BrowserUseResult
} from '../../../kun/src/contracts/browser-use.js'
import { hardenRemoteSession } from '../browser-security/web-contents-hardening'
import {
  BrowserUseNetworkPolicyError,
  browserUseProxyConfiguration,
  normalizeBrowserUseOrigin,
  sanitizeBrowserUseUrl
} from './network-policy'
import { BrowserUseManagerFoundation } from './browser-use-manager-foundation'
import {
  BACKGROUND_VIEW_BOUNDS,
  BrowserUseOperationAbortedError,
  browserUseErrorCode,
  INTERACTIVE_ROLES,
  DOCUMENT_INVALIDATION_EVENTS,
  attributesRecord,
  axProperties,
  axString,
  errorMessage,
  isNearViewport,
  isDisabledTarget,
  isSensitiveTarget,
  originOnly,
  pathOnly,
  randomToken,
  resultError,
  resultOk,
  roundRect,
  safeOrigin,
  sanitizePageTitle,
  withBrowserUseDeadline,
  type AxNode,
  type BrowserSessionEntry,
  type BrowserTab,
  type BrowserTarget
} from './browser-use-manager-support'

export abstract class BrowserUseManagerNavigation extends BrowserUseManagerFoundation {
  protected createSession(
    threadId: string,
    settings: KunBrowserUseSettingsV1
  ): BrowserSessionEntry {
    const id = randomToken()
    const now = this.now().getTime()
    const entry: BrowserSessionEntry = {
      id,
      threadId,
      mode: settings.mode,
      partition: `temp:kun-browser-use-${id}`,
      createdAt: now,
      lastActivityAt: now,
      lifecycle: 'ready',
      controlOwner: 'agent',
      mountWaiters: new Set(),
      grants: new Set(),
      tabs: new Map(),
      documentGeneration: 0,
      refs: new Map(),
      prepared: new Map(),
      turnBudgets: new Map(),
      activeOperations: new Set(),
      operationQueue: Promise.resolve(),
      stopping: false,
      agentInputDispatchActive: false
    }
    this.sessions.set(threadId, entry)
    this.touch(entry, settings)
    this.audit(entry, {
      category: 'lifecycle',
      action: 'create',
      outcome: 'success'
    })
    this.publish(entry)
    return entry
  }

  protected async open(
    entry: BrowserSessionEntry,
    rawUrl: string,
    newTab: boolean,
    reviewerSource: BrowserUseKunApprovalMode | undefined,
    signal: AbortSignal
  ): Promise<BrowserUseResult> {
    let origin: string
    try {
      origin = normalizeBrowserUseOrigin(rawUrl, entry.mode)
    } catch (error) {
      const code = error instanceof BrowserUseNetworkPolicyError ? error.code : 'invalid_url'
      return resultError(code, errorMessage(error), entry)
    }

    if (newTab && entry.tabs.size >= this.options.settings().maxTabs) {
      return resultError('tab_limit_reached', 'Browser Use tab limit reached.', entry)
    }
    if (!(await this.ensureOriginGrant(entry, origin, rawUrl, reviewerSource, signal))) {
      return resultError('origin_denied', 'The exact origin was not granted for this session.', entry)
    }
    if (signal.aborted || entry.stopping) {
      return resultError('aborted', 'Browser Use navigation was cancelled.', entry)
    }
    const previousActive = this.activeTab(entry)
    const previousLifecycle = entry.lifecycle
    entry.lifecycle = 'loading'
    entry.reason = undefined
    this.publish(entry)
    let openedTab: BrowserTab | undefined
    try {
      await this.ensureProxy(entry, signal)
      if (signal.aborted || entry.stopping) {
        return resultError('aborted', 'Browser Use navigation was cancelled.', entry)
      }
      const tab = await this.ensureTab(entry, newTab, signal)
      openedTab = tab
      this.assertOperationActive(entry, signal, tab)
      await withBrowserUseDeadline(
        tab.view.webContents.loadURL(rawUrl),
        signal,
        this.timeouts.navigationMs,
        'navigation_timeout',
        'The authorized page did not finish loading in time.',
        () => tab.view.webContents.stop()
      )
      this.assertOperationActive(entry, signal, tab)
      if (tab.error) throw new Error(tab.error)
      entry.lifecycle = 'loading'
      this.publish(entry)
      await this.warmStructuredObservation(entry, tab, signal)
      this.assertOperationActive(entry, signal, tab)
      entry.lifecycle = 'ready'
      entry.reason = undefined
      this.audit(entry, {
        category: 'execution',
        action: 'open',
        origin,
        sanitizedPath: pathOnly(rawUrl),
        outcome: 'success'
      }, tab.id)
      return resultOk('opened', `Opened ${sanitizeBrowserUseUrl(rawUrl)}.`, entry)
    } catch (error) {
      if (
        signal.aborted ||
        entry.stopping ||
        error instanceof BrowserUseOperationAbortedError
      ) {
        return resultError('aborted', 'Browser Use navigation was cancelled.', entry)
      }
      const code = browserUseErrorCode(error, 'navigation_failed')
      const restoredPreviousTab = newTab && previousActive && this.activeTab(entry) === previousActive
      entry.lifecycle = restoredPreviousTab ? previousLifecycle : 'error'
      const reason = errorMessage(error).slice(0, 512) || 'The authorized page failed to load.'
      entry.reason = restoredPreviousTab ? undefined : reason
      if (openedTab) openedTab.error = reason
      this.audit(entry, {
        category: 'execution',
        action: 'open',
        origin,
        sanitizedPath: pathOnly(rawUrl),
        outcome: 'error',
        errorCode: code
      })
      this.publish(entry)
      const detail = reason
      return resultError(
        code,
        detail
          ? `The authorized page failed to load: ${detail}`
          : 'The authorized page failed to load.',
        entry
      )
    }
  }
  protected async ensureProxy(
    entry: BrowserSessionEntry,
    signal: AbortSignal
  ): Promise<void> {
    if (entry.proxy && entry.proxyUrl) return
    if (!entry.proxyStart) {
      const proxy = this.createProxy(
        entry.mode,
        entry.exactLocalOrigin,
        (event) => {
          if (entry.stopping || this.sessions.get(entry.threadId) !== entry) return
          this.audit(entry, {
            category: 'network-policy',
            action: 'network-request',
            sanitizedPath: pathOnly(event.sanitizedUrl),
            origin: originOnly(event.sanitizedUrl),
            outcome: event.outcome === 'allowed' ? 'success' : 'blocked',
            ...(event.code ? { errorCode: event.code } : {})
          })
        }
      )
      const pending = (async () => {
        try {
          const proxyUrl = await proxy.start()
          this.assertOperationActive(entry, signal)
          entry.proxy = proxy
          entry.proxyUrl = proxyUrl
        } catch (error) {
          await proxy.stop().catch(() => undefined)
          throw error
        }
      })()
      const start = pending.finally(() => {
        if (entry.proxyStart === start) entry.proxyStart = undefined
      })
      entry.proxyStart = start
    }
    await entry.proxyStart
    this.assertOperationActive(entry, signal)
  }

  protected async ensureTab(
    entry: BrowserSessionEntry,
    createNew: boolean,
    signal: AbortSignal
  ): Promise<BrowserTab> {
    const active = this.activeTab(entry)
    if (active && !createNew) return active
    this.assertOperationActive(entry, signal)
    const settings = this.options.settings()
    if (entry.tabs.size >= settings.maxTabs) {
      throw new Error('Browser Use tab limit reached.')
    }
    if (!entry.proxyUrl) throw new Error('Browser Use policy proxy is unavailable.')
    const id = randomToken()
    const view = this.createView(entry.partition)
    view.setBounds(BACKGROUND_VIEW_BOUNDS)
    view.setVisible(false)
    const tab: BrowserTab = { id, view, loading: false }
    let inserted = false
    const previousActiveId = entry.activeTabId
    try {
      await withBrowserUseDeadline(
        view.webContents.session.setProxy(browserUseProxyConfiguration(entry.proxyUrl)),
        signal,
        this.timeouts.proxyConfigurationMs,
        'proxy_configuration_timeout',
        'Browser Use policy proxy configuration timed out.'
      )
      this.assertOperationActive(entry, signal)
      hardenRemoteSession(view.webContents.session)
      view.webContents.session.webRequest.onBeforeRequest(
        { urls: ['<all_urls>'] },
        (details, callback) => {
          if (details.resourceType !== 'mainFrame') {
            callback({ cancel: false })
            return
          }
          const requestedOrigin = safeOrigin(details.url)
          const cancel = !requestedOrigin || !entry.grants.has(requestedOrigin)
          callback({ cancel })
          if (cancel && requestedOrigin && !entry.stopping) {
            void this.queueOriginNavigation(entry, details.url)
          }
        }
      )
      this.hardenTab(entry, tab, signal)
      this.assertOperationActive(entry, signal)

      const previous = this.activeTab(entry)
      entry.tabs.set(id, tab)
      entry.activeTabId = id
      inserted = true
      if (previous) previous.view.setVisible(false)
      if (entry.mount) this.attachView(entry, tab)
      this.publish(entry)
      return tab
    } catch (error) {
      if (inserted) {
        this.detachView(entry, tab)
        entry.tabs.delete(id)
        entry.activeTabId = previousActiveId && entry.tabs.has(previousActiveId)
          ? previousActiveId
          : entry.tabs.keys().next().value
        const restored = this.activeTab(entry)
        if (restored) this.attachView(entry, restored)
      }
      if (!view.webContents.isDestroyed()) view.webContents.close()
      throw error
    }
  }

  protected hardenTab(
    entry: BrowserSessionEntry,
    tab: BrowserTab,
    signal: AbortSignal
  ): void {
    const guest = tab.view.webContents
    const ownsTab = () => entry.tabs.get(tab.id) === tab && !entry.stopping
    guest.setAudioMuted(true)
    guest.setWindowOpenHandler(({ url }) => {
      const origin = safeOrigin(url)
      if (origin && !entry.grants.has(origin) && ownsTab()) {
        void this.queueOriginNavigation(entry, url)
      }
      if (!ownsTab()) return { action: 'deny' }
      this.audit(entry, {
        category: 'network-policy',
        action: 'popup-blocked',
        origin: origin ?? undefined,
        sanitizedPath: pathOnly(url),
        outcome: 'blocked',
        errorCode: 'popup_blocked'
      })
      return { action: 'deny' }
    })
    guest.on('will-navigate', (event, url) => {
      if (!ownsTab()) {
        event.preventDefault()
        return
      }
      const origin = safeOrigin(url)
      if (!origin || !entry.grants.has(origin)) {
        event.preventDefault()
        if (origin) void this.queueOriginNavigation(entry, url)
      }
    })
    guest.on('will-redirect', (event, url) => {
      if (!ownsTab()) {
        event.preventDefault()
        return
      }
      const origin = safeOrigin(url)
      if (!origin || !entry.grants.has(origin)) {
        event.preventDefault()
        if (origin) void this.queueOriginNavigation(entry, url)
      }
    })
    guest.on('before-input-event', (event) => {
      if (entry.controlOwner === 'agent' && !entry.agentInputDispatchActive) {
        event.preventDefault()
      }
    })
    guest.on('before-mouse-event', (event) => {
      if (entry.controlOwner === 'agent' && !entry.agentInputDispatchActive) {
        event.preventDefault()
      }
    })
    guest.on('did-start-navigation', (_event, _url, _isInPlace, isMainFrame) => {
      if (isMainFrame && ownsTab()) this.invalidateDocument(entry, 'navigation')
    })
    guest.on('did-start-loading', () => {
      if (!ownsTab()) return
      tab.loading = true
      tab.error = undefined
      entry.reason = undefined
      if (!entry.stopping) entry.lifecycle = 'loading'
      this.publish(entry)
    })
    guest.on('did-stop-loading', () => {
      if (!ownsTab()) return
      tab.loading = false
      if (!entry.stopping) {
        entry.lifecycle = tab.error ? 'error' : 'ready'
        entry.reason = tab.error
      }
      this.publish(entry)
    })
    guest.on('did-navigate', () => {
      if (ownsTab()) this.publish(entry)
    })
    guest.on('did-navigate-in-page', () => {
      if (ownsTab()) this.publish(entry)
    })
    guest.on('page-title-updated', () => {
      if (ownsTab()) this.publish(entry)
    })
    guest.on('did-fail-load', (_event, errorCode, errorDescription, _url, isMainFrame) => {
      if (!ownsTab() || !isMainFrame || errorCode === -3) return
      tab.loading = false
      tab.error = errorDescription.slice(0, 1024)
      entry.reason = tab.error
      entry.lifecycle = 'error'
      this.publish(entry)
    })
    guest.on('render-process-gone', () => {
      if (!ownsTab()) return
      tab.error = 'Browser page process exited.'
      entry.reason = tab.error
      entry.lifecycle = 'error'
      this.cancelActiveOperations(entry)
      this.invalidateDocument(entry, 'render-process-gone')
      this.audit(entry, {
        category: 'lifecycle',
        action: 'render-process-gone',
        outcome: 'error',
        errorCode: 'render_process_gone'
      })
      this.publish(entry)
    })
    guest.once('destroyed', () => {
      entry.tabs.delete(tab.id)
      if (entry.activeTabId === tab.id) entry.activeTabId = undefined
    })
    try {
      guest.debugger.attach('1.3')
      this.assertOperationActive(entry, signal)
      guest.debugger.on('message', (_event, method) => {
        if (ownsTab() && DOCUMENT_INVALIDATION_EVENTS.has(method)) {
          this.invalidateDocument(entry, 'document-updated')
        }
      })
    } catch (error) {
      if (error instanceof BrowserUseOperationAbortedError) throw error
      throw new Error('Structured browser observation is unavailable.', { cause: error })
    }
  }
  protected async warmStructuredObservation(
    entry: BrowserSessionEntry,
    tab: BrowserTab,
    signal: AbortSignal
  ): Promise<void> {
    try {
      await withBrowserUseDeadline(
        tab.view.webContents.debugger.sendCommand('DOM.enable'), signal,
        this.timeouts.structuredObservationMs, 'structured_observation_timeout',
        'Structured browser observation initialization timed out.'
      )
      this.assertOperationActive(entry, signal, tab)
      await withBrowserUseDeadline(
        tab.view.webContents.debugger.sendCommand('Accessibility.enable'), signal,
        this.timeouts.structuredObservationMs, 'structured_observation_timeout',
        'Structured browser observation initialization timed out.'
      )
      this.assertOperationActive(entry, signal, tab)
    } catch (error) {
      if (error instanceof BrowserUseOperationAbortedError) throw error
      if (browserUseErrorCode(error, '') === 'structured_observation_timeout') throw error
      throw new Error('Structured browser observation is unavailable.', { cause: error })
    }
  }
  protected async highlightedPreview(
    entry: BrowserSessionEntry,
    tab: BrowserTab,
    backendNodeId: number,
    signal: AbortSignal,
    documentGeneration: number
  ): Promise<string | undefined> {
    try {
      this.assertOperationActive(entry, signal, tab, documentGeneration)
      await tab.view.webContents.debugger.sendCommand('Overlay.enable')
      this.assertOperationActive(entry, signal, tab, documentGeneration)
      await tab.view.webContents.debugger.sendCommand('Overlay.highlightNode', {
        backendNodeId,
        highlightConfig: {
          showInfo: true,
          showStyles: false,
          contentColor: { r: 53, g: 132, b: 228, a: 0.12 },
          borderColor: { r: 53, g: 132, b: 228, a: 1 }
        }
      })
      this.assertOperationActive(entry, signal, tab, documentGeneration)
      const image = await tab.view.webContents.capturePage()
      this.assertOperationActive(entry, signal, tab, documentGeneration)
      await tab.view.webContents.debugger.sendCommand('Overlay.hideHighlight')
      this.assertOperationActive(entry, signal, tab, documentGeneration)
      const size = image.getSize()
      const scale = Math.min(1, 800 / Math.max(size.width, size.height, 1))
      const bounded = scale < 1
        ? image.resize({
            width: Math.max(1, Math.round(size.width * scale)),
            height: Math.max(1, Math.round(size.height * scale))
          })
        : image
      return `data:image/png;base64,${bounded.toPNG().toString('base64')}`
    } catch (error) {
      try {
        await tab.view.webContents.debugger.sendCommand('Overlay.hideHighlight')
      } catch {
        // Preview failure must never weaken the action validation path.
      }
      if (
        error instanceof BrowserUseOperationAbortedError ||
        signal.aborted ||
        entry.stopping
      ) {
        throw new BrowserUseOperationAbortedError()
      }
      return undefined
    }
  }

  protected async snapshot(
    entry: BrowserSessionEntry,
    signal: AbortSignal
  ): Promise<BrowserUseResult> {
    const tab = this.requireActiveTab(entry)
    const settings = this.options.settings()
    const documentGeneration = entry.documentGeneration
    const nextRefs = new Map<string, BrowserTarget>()
    try {
      this.assertOperationActive(entry, signal, tab, documentGeneration)
      await tab.view.webContents.debugger.sendCommand('DOM.getDocument', {
        depth: 1,
        pierce: true
      })
      this.assertOperationActive(entry, signal, tab, documentGeneration)
      const response = await tab.view.webContents.debugger.sendCommand(
        'Accessibility.getFullAXTree',
        { depth: 8 }
      ) as { nodes?: AxNode[] }
      this.assertOperationActive(entry, signal, tab, documentGeneration)
      const nodes: BrowserUseSnapshotNode[] = []
      let textChars = 0
      let truncated = false
      for (const axNode of response.nodes ?? []) {
        this.assertOperationActive(entry, signal, tab, documentGeneration)
        if (nodes.length >= settings.maxSnapshotNodes) {
          truncated = true
          break
        }
        const projected = await this.projectAxNode(
          entry,
          tab,
          axNode,
          signal,
          documentGeneration,
          nextRefs
        )
        if (!projected) continue
        const projectedChars = projected.role.length + projected.name.length + (projected.value?.length ?? 0)
        if (textChars + projectedChars > settings.maxSnapshotTextChars) {
          truncated = true
          break
        }
        textChars += projectedChars
        nodes.push(projected)
      }
      this.assertOperationActive(entry, signal, tab, documentGeneration)
      const currentUrl = tab.view.webContents.getURL()
      const snapshot: BrowserUseSnapshot = {
        untrustedContent: true,
        sessionId: entry.id,
        tabId: tab.id,
        origin: safeOrigin(currentUrl) ?? '',
        sanitizedUrl: sanitizeBrowserUseUrl(currentUrl),
        title: sanitizePageTitle(tab.view.webContents.getTitle()),
        documentGeneration,
        truncated,
        nodes
      }
      entry.refs.clear()
      for (const [ref, target] of nextRefs) entry.refs.set(ref, target)
      this.audit(entry, {
        category: 'execution',
        action: 'snapshot',
        origin: snapshot.origin,
        sanitizedPath: pathOnly(snapshot.sanitizedUrl),
        outcome: 'success'
      }, tab.id)
      return BrowserUseToolResult.parse({
        ok: true,
        code: 'snapshot',
        message: truncated
          ? 'Returned a bounded truncated snapshot of untrusted page content.'
          : 'Returned a bounded snapshot of untrusted page content.',
        sessionId: entry.id,
        tabId: tab.id,
        snapshot
      })
    } catch (error) {
      if (
        error instanceof BrowserUseOperationAbortedError ||
        signal.aborted ||
        entry.stopping
      ) {
        return resultError('aborted', 'Browser Use snapshot was cancelled.', entry, tab.id)
      }
      return resultError('snapshot_failed', errorMessage(error), entry, tab.id)
    }
  }

  protected async projectAxNode(
    entry: BrowserSessionEntry,
    tab: BrowserTab,
    axNode: AxNode,
    signal: AbortSignal,
    documentGeneration: number,
    nextRefs: Map<string, BrowserTarget>
  ): Promise<BrowserUseSnapshotNode | undefined> {
    this.assertOperationActive(entry, signal, tab, documentGeneration)
    if (axNode.ignored || !axNode.backendDOMNodeId) return undefined
    const role = axString(axNode.role).slice(0, 128)
    const name = axString(axNode.name).slice(0, 512)
    if (!role && !name) return undefined
    const box = await this.boxForNode(tab, axNode.backendDOMNodeId)
    this.assertOperationActive(entry, signal, tab, documentGeneration)
    if (!box || !isNearViewport(box, entry.mount?.bounds)) return undefined
    const description = await this.describeNode(tab, axNode.backendDOMNodeId)
    this.assertOperationActive(entry, signal, tab, documentGeneration)
    const attributes = attributesRecord(description.node?.attributes)
    const sensitive = isSensitiveTarget(role, name, description, attributes)
    const properties = axProperties(axNode.properties)
    const disabled = isDisabledTarget(properties, attributes)
    const interactive = INTERACTIVE_ROLES.has(role.toLowerCase()) ||
      properties.get('focusable') === true
    let ref: string | undefined
    if (interactive && !sensitive && !disabled) {
      const targetRef = randomToken()
      ref = targetRef
      const target: BrowserTarget = {
        ref: targetRef,
        tabId: tab.id,
        documentGeneration,
        backendNodeId: axNode.backendDOMNodeId,
        role,
        name,
        sensitive,
        disabled,
        rect: box,
        fingerprint: this.fingerprint(entry, {
          tabId: tab.id,
          documentGeneration,
          backendNodeId: axNode.backendDOMNodeId,
          role,
          name,
          sensitive,
          disabled,
          rect: box,
          attributes
        })
      }
      nextRefs.set(targetRef, target)
    }
    const rawValue = axString(axNode.value).slice(0, 512)
    return {
      ...(ref ? { ref } : {}),
      role,
      name,
      ...(!sensitive && rawValue ? { value: rawValue } : {}),
      ...(disabled ? { disabled: true } : {}),
      ...(typeof properties.get('checked') === 'boolean'
        ? { checked: properties.get('checked') as boolean }
        : {}),
      ...(typeof properties.get('selected') === 'boolean'
        ? { selected: properties.get('selected') as boolean }
        : {}),
      ...(typeof properties.get('expanded') === 'boolean'
        ? { expanded: properties.get('expanded') as boolean }
        : {}),
      ...(sensitive ? { sensitive: true } : {}),
      rect: box
    }
  }

  protected async screenshot(
    entry: BrowserSessionEntry,
    signal: AbortSignal
  ): Promise<BrowserUseResult> {
    const tab = this.requireActiveTab(entry)
    const documentGeneration = entry.documentGeneration
    try {
      this.assertOperationActive(entry, signal, tab, documentGeneration)
      const image = await tab.view.webContents.capturePage()
      this.assertOperationActive(entry, signal, tab, documentGeneration)
      const size = image.getSize()
      const max = this.options.settings().maxImageDimension
      const scale = Math.min(1, max / Math.max(size.width, size.height, 1))
      const bounded = scale < 1
        ? image.resize({
            width: Math.max(1, Math.round(size.width * scale)),
            height: Math.max(1, Math.round(size.height * scale))
          })
        : image
      return BrowserUseToolResult.parse({
        ok: true,
        code: 'screenshot',
        message: 'Captured the visible isolated Browser Use page.',
        sessionId: entry.id,
        tabId: tab.id,
        image: {
          mediaType: 'image/png',
          data: bounded.toPNG().toString('base64')
        }
      })
    } catch (error) {
      if (
        error instanceof BrowserUseOperationAbortedError ||
        signal.aborted ||
        entry.stopping
      ) {
        return resultError('aborted', 'Browser Use screenshot was cancelled.', entry, tab.id)
      }
      return resultError('screenshot_failed', errorMessage(error), entry, tab.id)
    }
  }

}
