import { createHash, randomBytes } from 'node:crypto'
import {
  WebContentsView
} from 'electron'
import type {
  BrowserUseAuditEntry,
  BrowserUseActionConsentRequest,
  BrowserUseBudgetState,
  BrowserUseOriginConsentRequest,
  BrowserUseRect,
  BrowserUseViewState
} from '../../shared/browser-use'
import type { KunBrowserUseSettingsV1 } from '../../shared/app-settings'
import {
  BrowserUseToolResult,
  type BrowserUseKunApprovalMode,
  type BrowserUseToolResult as BrowserUseResult
} from '../../../kun/src/contracts/browser-use.js'
import {
  BrowserUseNetworkPolicyError,
  BrowserUsePolicyProxy,
  normalizeBrowserUseOrigin,
  sanitizeBrowserUseUrl
} from './network-policy'
import {
  ACTION_DECISION_TIMEOUT_MS, BrowserUseOperationAbortedError, MAX_AUDIT_ENTRIES,
  MOUNT_TIMEOUT_MS, NAVIGATION_TIMEOUT_MS, ORIGIN_DECISION_TIMEOUT_MS,
  PROXY_CONFIGURATION_TIMEOUT_MS, STRUCTURED_OBSERVATION_TIMEOUT_MS,
  attributesRecord,
  assertBrowserUseOperationActive,
  auditDecision,
  axProperties,
  axString,
  createBrowserUseView,
  isDisabledTarget,
  isNearViewport,
  isSensitiveTarget,
  isVisibleMount,
  once,
  originOnly,
  pathOnly,
  randomToken,
  resultError,
  resultOk,
  roundRect,
  runSerializedBrowserUseOperation,
  safeOrigin,
  sanitizePageTitle,
  type AxNode,
  type BoxModelResult,
  type BrowserDecision,
  type BrowserSessionEntry,
  type BrowserTab,
  type BrowserTarget,
  type DomDescription,
  type PendingDecision,
  type PreparedAction,
  type BrowserUseManagerOptions
} from './browser-use-manager-support'

export abstract class BrowserUseManagerFoundation {
  protected readonly sessions = new Map<string, BrowserSessionEntry>()
  protected readonly auditEntries: BrowserUseAuditEntry[] = []
  protected readonly now: () => Date
  protected readonly createView: (partition: string) => WebContentsView
  protected readonly createProxy: NonNullable<BrowserUseManagerOptions['createProxy']>
  protected readonly fingerprintKey = randomBytes(32)
  protected readonly timeouts
  constructor(protected readonly options: BrowserUseManagerOptions) {
    this.now = options.now ?? (() => new Date())
    this.timeouts = {
      proxyConfigurationMs: options.timeouts?.proxyConfigurationMs ?? PROXY_CONFIGURATION_TIMEOUT_MS,
      navigationMs: options.timeouts?.navigationMs ?? NAVIGATION_TIMEOUT_MS,
      structuredObservationMs: options.timeouts?.structuredObservationMs ?? STRUCTURED_OBSERVATION_TIMEOUT_MS
    }
    this.createView = options.createView ?? createBrowserUseView
    this.createProxy = options.createProxy ?? ((mode, exactLocalOrigin, onPolicyEvent) =>
      new BrowserUsePolicyProxy({ mode, exactLocalOrigin, onPolicyEvent }))
  }
  abstract clear(threadId: string, reason?: string): Promise<boolean>

  protected tabs(
    entry: BrowserSessionEntry,
    operation: 'list' | 'switch' | 'close',
    tabId: string | undefined,
    signal: AbortSignal
  ): BrowserUseResult {
    if (signal.aborted || entry.stopping) {
      return resultError('aborted', 'Browser Use action was cancelled.', entry)
    }
    if (operation === 'switch') {
      if (!tabId || !entry.tabs.has(tabId)) {
        return resultError('tab_not_found', 'The requested tab does not belong to this session.', entry)
      }
      const previous = this.activeTab(entry)
      if (previous) previous.view.setVisible(false)
      entry.activeTabId = tabId
      const active = entry.tabs.get(tabId)!
      this.attachView(entry, active)
      this.invalidateDocument(entry, 'tab-switch')
    } else if (operation === 'close') {
      if (!tabId || !entry.tabs.has(tabId)) {
        return resultError('tab_not_found', 'The requested tab does not belong to this session.', entry)
      }
      const tab = entry.tabs.get(tabId)!
      this.detachView(entry, tab)
      if (!tab.view.webContents.isDestroyed()) tab.view.webContents.close()
      entry.tabs.delete(tabId)
      if (entry.activeTabId === tabId) entry.activeTabId = entry.tabs.keys().next().value
      const active = this.activeTab(entry)
      if (active) this.attachView(entry, active)
      this.invalidateDocument(entry, 'tab-close')
    }
    return BrowserUseToolResult.parse({
      ok: true,
      code: 'tabs',
      message: 'Returned bounded Browser Use tabs.',
      sessionId: entry.id,
      ...(entry.activeTabId ? { tabId: entry.activeTabId } : {}),
      tabs: [...entry.tabs.values()].map((tab) => ({
        id: tab.id,
        title: sanitizePageTitle(tab.view.webContents.getTitle()),
        origin: safeOrigin(tab.view.webContents.getURL()) ?? '',
        active: tab.id === entry.activeTabId
      }))
    })
  }

  protected async ensureOriginGrant(
    entry: BrowserSessionEntry,
    origin: string,
    rawUrl: string,
    reviewerSource: BrowserUseKunApprovalMode | undefined,
    signal: AbortSignal
  ): Promise<boolean> {
    this.assertOperationActive(entry, signal)
    if (entry.grants.has(origin)) return true
    const settings = this.options.settings()
    if (settings.approvalMode === 'auto-safe' && entry.mode === 'public') {
      entry.grants.add(origin)
      this.audit(entry, {
        category: 'origin-consent',
        action: 'auto-grant-public-origin',
        origin,
        sanitizedPath: pathOnly(rawUrl),
        ...(reviewerSource ? { reviewerSource } : {}),
        decision: 'allowed',
        outcome: 'success'
      })
      this.publish(entry)
      return true
    }
    if (entry.pendingOriginDecision) return false
    if (!(await this.ensureSupervised(entry, signal))) return false
    this.assertOperationActive(entry, signal)
    const request: BrowserUseOriginConsentRequest = {
      id: randomToken(),
      sessionId: entry.id,
      threadId: entry.threadId,
      origin,
      sanitizedUrl: sanitizeBrowserUseUrl(rawUrl),
      mode: entry.mode,
      createdAt: this.now().toISOString()
    }
    const decisionPromise = this.awaitOriginDecision(entry, request)
    entry.pendingOrigin = request
    entry.lifecycle = 'waiting-origin-consent'
    this.publish(entry)
    const decision = await decisionPromise
    this.assertOperationActive(entry, signal)
    entry.pendingOrigin = undefined
    entry.lifecycle = 'ready'
    if (decision === 'allow-once') {
      if (entry.mode === 'local-development') {
        if (entry.exactLocalOrigin && entry.exactLocalOrigin !== origin) {
          this.publish(entry)
          return false
        }
        entry.exactLocalOrigin = origin
      }
      entry.grants.add(origin)
    }
    this.audit(entry, {
      category: 'origin-consent',
      action: 'grant-origin',
      origin,
      sanitizedPath: pathOnly(rawUrl),
      ...(reviewerSource ? { reviewerSource } : {}),
      decision: auditDecision(decision),
      outcome: decision === 'allow-once' ? 'success' : 'blocked'
    })
    this.publish(entry)
    return decision === 'allow-once'
  }

  protected async queueOriginNavigation(
    entry: BrowserSessionEntry,
    rawUrl: string
  ): Promise<void> {
    if (entry.stopping || entry.pendingOriginDecision) return
    await this.withAbort(entry, undefined, async (signal) => {
      let origin: string
      try {
        origin = normalizeBrowserUseOrigin(rawUrl, entry.mode)
      } catch (error) {
        this.assertOperationActive(entry, signal)
        this.audit(entry, {
          category: 'network-policy',
          action: 'navigation-blocked',
          sanitizedPath: pathOnly(rawUrl),
          outcome: 'blocked',
          errorCode: error instanceof BrowserUseNetworkPolicyError ? error.code : 'invalid_url'
        })
        return resultError('navigation_blocked', 'Browser Use blocked page navigation.', entry)
      }
      if (!(await this.ensureOriginGrant(entry, origin, rawUrl, undefined, signal))) {
        return resultError('origin_denied', 'The exact origin was not granted.', entry)
      }
      this.assertOperationActive(entry, signal)
      const tab = this.activeTab(entry)
      if (!tab) return resultError('tab_not_found', 'Browser Use has no active tab.', entry)
      await tab.view.webContents.loadURL(rawUrl).catch(() => undefined)
      this.assertOperationActive(entry, signal, tab)
      return resultOk('opened', 'Opened the newly authorized origin.', entry, tab.id)
    })
  }

  protected awaitOriginDecision(
    entry: BrowserSessionEntry,
    request: BrowserUseOriginConsentRequest
  ): Promise<BrowserDecision> {
    return this.createDecision(entry, 'origin', request.id, ORIGIN_DECISION_TIMEOUT_MS)
  }

  protected awaitActionDecision(
    entry: BrowserSessionEntry,
    request: BrowserUseActionConsentRequest
  ): Promise<BrowserDecision> {
    return this.createDecision(entry, 'action', request.id, ACTION_DECISION_TIMEOUT_MS)
  }

  protected createDecision(
    entry: BrowserSessionEntry,
    kind: 'origin' | 'action',
    id: string,
    timeoutMs: number
  ): Promise<BrowserDecision> {
    return new Promise((resolve) => {
      const finish = once((decision: BrowserDecision) => {
        clearTimeout(pending.timer)
        if (kind === 'origin') entry.pendingOriginDecision = undefined
        else entry.pendingActionDecision = undefined
        resolve(decision)
      })
      const pending: PendingDecision = {
        id,
        resolve: finish,
        timer: setTimeout(() => finish('expired'), timeoutMs)
      }
      if (kind === 'origin') entry.pendingOriginDecision = pending
      else entry.pendingActionDecision = pending
    })
  }

  protected cancelPending(entry: BrowserSessionEntry, decision: BrowserDecision): void {
    entry.pendingOriginDecision?.resolve(decision)
    entry.pendingActionDecision?.resolve(decision)
    entry.pendingOrigin = undefined
    entry.pendingAction = undefined
    for (const prepared of entry.prepared.values()) prepared.used = true
    entry.prepared.clear()
  }

  protected async liveTarget(
    entry: BrowserSessionEntry,
    tab: BrowserTab,
    target: BrowserTarget,
    signal: AbortSignal
  ): Promise<BrowserTarget | undefined> {
    this.assertOperationActive(entry, signal, tab, target.documentGeneration)
    if (target.documentGeneration !== entry.documentGeneration) return undefined
    try {
      const description = await this.describeNode(tab, target.backendNodeId)
      this.assertOperationActive(entry, signal, tab, target.documentGeneration)
      if (!description.node?.backendNodeId) return undefined
      const attributes = attributesRecord(description.node.attributes)
      const box = await this.boxForNode(tab, target.backendNodeId)
      this.assertOperationActive(entry, signal, tab, target.documentGeneration)
      if (!box) return undefined
      const ax = await tab.view.webContents.debugger.sendCommand(
        'Accessibility.getPartialAXTree',
        { backendNodeId: target.backendNodeId, fetchRelatives: false }
      ) as { nodes?: AxNode[] }
      this.assertOperationActive(entry, signal, tab, target.documentGeneration)
      const node = ax.nodes?.[0]
      const role = axString(node?.role).slice(0, 128)
      const name = axString(node?.name).slice(0, 512)
      const sensitive = isSensitiveTarget(role, name, description, attributes)
      const disabled = isDisabledTarget(axProperties(node?.properties), attributes)
      if (!isNearViewport(box, entry.mount?.bounds)) return undefined
      return {
        ...target,
        role,
        name,
        sensitive,
        disabled,
        rect: box,
        fingerprint: this.fingerprint(entry, {
          tabId: tab.id,
          documentGeneration: entry.documentGeneration,
          backendNodeId: target.backendNodeId,
          role,
          name,
          sensitive,
          disabled,
          rect: box,
          attributes
        })
      }
    } catch (error) {
      if (error instanceof BrowserUseOperationAbortedError) throw error
      return undefined
    }
  }

  protected async describeNode(tab: BrowserTab, backendNodeId: number): Promise<DomDescription> {
    return tab.view.webContents.debugger.sendCommand('DOM.describeNode', {
      backendNodeId,
      depth: 0,
      pierce: true
    }) as Promise<DomDescription>
  }

  protected async boxForNode(
    tab: BrowserTab,
    backendNodeId: number
  ): Promise<BrowserUseRect | undefined> {
    try {
      const result = await tab.view.webContents.debugger.sendCommand('DOM.getBoxModel', {
        backendNodeId
      }) as BoxModelResult
      const quad = result.model?.border ?? result.model?.content
      if (!quad || quad.length < 8) return undefined
      const xs = [quad[0]!, quad[2]!, quad[4]!, quad[6]!]
      const ys = [quad[1]!, quad[3]!, quad[5]!, quad[7]!]
      const minX = Math.min(...xs)
      const maxX = Math.max(...xs)
      const minY = Math.min(...ys)
      const maxY = Math.max(...ys)
      if (maxX <= minX || maxY <= minY) return undefined
      return {
        x: roundRect(minX),
        y: roundRect(minY),
        width: roundRect(maxX - minX),
        height: roundRect(maxY - minY)
      }
    } catch {
      return undefined
    }
  }

  protected fingerprint(
    entry: BrowserSessionEntry,
    target: Omit<BrowserTarget, 'ref' | 'fingerprint'> & {
      attributes: Readonly<Record<string, string>>
    }
  ): string {
    return createHash('sha256')
      .update(this.fingerprintKey)
      .update('\0')
      .update(entry.id)
      .update('\0')
      .update(JSON.stringify(target))
      .digest('base64url')
  }

  protected consumeBudget(
    entry: BrowserSessionEntry,
    turnId: string,
    kind: 'observation' | 'interaction',
    settings: KunBrowserUseSettingsV1
  ): BrowserUseResult | undefined {
    let budget = entry.turnBudgets.get(turnId)
    if (!budget) {
      budget = { observationUsed: 0, interactionUsed: 0 }
      entry.turnBudgets.set(turnId, budget)
    }
    entry.activeTurnId = turnId
    const used = kind === 'observation' ? budget.observationUsed : budget.interactionUsed
    const max = kind === 'observation'
      ? settings.maxObservationActionsPerTurn
      : settings.maxInteractionActionsPerTurn
    if (used >= max) {
      return resultError(
        'action_budget_exhausted',
        `Browser Use ${kind} action limit (${max}) reached for this turn.`,
        entry
      )
    }
    if (kind === 'observation') budget.observationUsed += 1
    else budget.interactionUsed += 1
    if (entry.turnBudgets.size > 32) {
      for (const key of entry.turnBudgets.keys()) {
        if (key !== turnId) {
          entry.turnBudgets.delete(key)
          break
        }
      }
    }
    this.publish(entry)
    return undefined
  }

  protected budgetState(entry: BrowserSessionEntry): BrowserUseBudgetState | undefined {
    if (!entry.activeTurnId) return undefined
    const used = entry.turnBudgets.get(entry.activeTurnId)
    if (!used) return undefined
    const settings = this.options.settings()
    return {
      observationRemaining: Math.max(
        0,
        settings.maxObservationActionsPerTurn - used.observationUsed
      ),
      interactionRemaining: Math.max(
        0,
        settings.maxInteractionActionsPerTurn - used.interactionUsed
      )
    }
  }

  protected async ensureSupervised(
    entry: BrowserSessionEntry,
    signal: AbortSignal
  ): Promise<boolean> {
    this.assertOperationActive(entry, signal)
    if (isVisibleMount(entry.mount)) return true
    entry.lifecycle = 'mount-required'
    this.publish(entry)
    await new Promise<void>((resolve) => {
      const done = once(resolve)
      entry.mountWaiters.add(done)
      setTimeout(() => {
        entry.mountWaiters.delete(done)
        done()
      }, MOUNT_TIMEOUT_MS)
    })
    this.assertOperationActive(entry, signal)
    return isVisibleMount(entry.mount)
  }

  protected attachView(entry: BrowserSessionEntry, tab: BrowserTab): void {
    const mount = entry.mount
    if (!mount || mount.window.isDestroyed()) return
    const children = mount.window.contentView.children
    if (!children.includes(tab.view)) mount.window.contentView.addChildView(tab.view)
    tab.view.setBounds(mount.bounds)
    tab.view.setVisible(mount.visible && tab.id === entry.activeTabId)
    tab.view.webContents.setIgnoreMenuShortcuts(entry.controlOwner !== 'manual')
  }

  protected detachView(entry: BrowserSessionEntry, tab: BrowserTab): void {
    tab.view.setVisible(false)
    const window = entry.mount?.window
    if (window && !window.isDestroyed() && window.contentView.children.includes(tab.view)) {
      window.contentView.removeChildView(tab.view)
    }
  }

  protected invalidateDocument(entry: BrowserSessionEntry, _reason: string): void {
    entry.documentGeneration += 1
    entry.refs.clear()
    for (const prepared of entry.prepared.values()) prepared.used = true
    entry.prepared.clear()
    entry.pendingActionDecision?.resolve('cancelled')
    entry.pendingAction = undefined
  }

  protected invalidateTarget(entry: BrowserSessionEntry, ref: string): void {
    entry.refs.delete(ref)
    for (const [id, prepared] of entry.prepared) {
      if (prepared.target.ref !== ref) continue
      prepared.used = true
      entry.prepared.delete(id)
      if (entry.pendingAction?.id === id) {
        entry.pendingActionDecision?.resolve('cancelled')
        entry.pendingAction = undefined
      }
    }
  }

  protected touch(entry: BrowserSessionEntry, settings: KunBrowserUseSettingsV1): void {
    entry.lastActivityAt = this.now().getTime()
    if (entry.idleTimer) clearTimeout(entry.idleTimer)
    entry.idleTimer = setTimeout(() => {
      void this.clear(entry.threadId, 'idle-expired')
    }, settings.idleTimeoutMs)
  }

  protected async withAbort(
    entry: BrowserSessionEntry,
    signal: AbortSignal | undefined,
    operation: (signal: AbortSignal) => Promise<BrowserUseResult>
  ): Promise<BrowserUseResult> {
    if (signal?.aborted || entry.stopping) {
      return resultError('aborted', 'Browser Use action was cancelled.', entry)
    }
    const controller = new AbortController()
    const onExternalAbort = () => controller.abort(signal?.reason)
    const onAbort = () => {
      this.cancelPending(entry, 'cancelled')
      this.stopOwnedPageWork(entry)
      for (const waiter of entry.mountWaiters) waiter()
      entry.mountWaiters.clear()
    }
    entry.activeOperations.add(controller)
    signal?.addEventListener('abort', onExternalAbort, { once: true })
    controller.signal.addEventListener('abort', onAbort, { once: true })
    if (signal?.aborted || entry.stopping) {
      controller.abort(signal?.reason ?? new Error('Browser Use session stopped.'))
    }
    let resolveAbort: ((result: BrowserUseResult) => void) | undefined
    const aborted = new Promise<BrowserUseResult>((resolve) => {
      resolveAbort = resolve
      controller.signal.addEventListener('abort', () => {
        resolve(resultError('aborted', 'Browser Use action was cancelled.', entry))
      }, { once: true })
    })
    try {
      const operationResult = runSerializedBrowserUseOperation(
        entry,
        controller.signal,
        () => this.assertOperationActive(entry, controller.signal),
        operation
      ).catch((error: unknown) => {
        if (
          controller.signal.aborted ||
          error instanceof BrowserUseOperationAbortedError
        ) {
          return resultError('aborted', 'Browser Use action was cancelled.', entry)
        }
        throw error
      })
      const result = await Promise.race([operationResult, aborted])
      return controller.signal.aborted
        ? resultError('aborted', 'Browser Use action was cancelled.', entry)
        : result
    } finally {
      entry.activeOperations.delete(controller)
      if (!controller.signal.aborted) {
        resolveAbort?.(resultError('aborted', 'Browser Use action scope finished.', entry))
      }
      signal?.removeEventListener('abort', onExternalAbort)
      controller.signal.removeEventListener('abort', onAbort)
    }
  }

  protected assertOperationActive(
    entry: BrowserSessionEntry,
    signal: AbortSignal,
    tab?: BrowserTab,
    documentGeneration?: number
  ): void {
    assertBrowserUseOperationActive(
      this.sessions.get(entry.threadId),
      entry,
      signal,
      tab,
      documentGeneration
    )
  }

  protected cancelActiveOperations(entry: BrowserSessionEntry): void {
    entry.agentInputDispatchActive = false
    for (const controller of entry.activeOperations) controller.abort(new Error('Browser Use session stopped.'))
    this.stopOwnedPageWork(entry)
    for (const waiter of entry.mountWaiters) waiter()
    entry.mountWaiters.clear()
    this.cancelPending(entry, 'cancelled')
  }
  private stopOwnedPageWork(entry: BrowserSessionEntry): void {
    for (const tab of entry.tabs.values()) {
      if (!tab.view.webContents.isDestroyed()) {
        try {
          tab.view.webContents.stop()
        } catch {
          // Teardown remains fail-closed when Chromium is already exiting.
        }
      }
      void tab.view.webContents.session.closeAllConnections().catch(() => undefined)
    }
  }

  protected async withAgentInputDispatch<T>(
    entry: BrowserSessionEntry,
    operation: () => Promise<T>
  ): Promise<T> {
    entry.agentInputDispatchActive = true
    try {
      return await operation()
    } finally {
      entry.agentInputDispatchActive = false
    }
  }
  protected state(entry: BrowserSessionEntry): BrowserUseViewState {
    const tabs = [...entry.tabs.values()].slice(0, 3).map((tab) => {
      const url = tab.view.webContents.getURL()
      const history = tab.view.webContents.navigationHistory
      return {
        id: tab.id,
        title: sanitizePageTitle(tab.view.webContents.getTitle()),
        origin: safeOrigin(url) ?? '',
        sanitizedUrl: sanitizeBrowserUseUrl(url),
        active: tab.id === entry.activeTabId,
        loading: tab.loading,
        canGoBack: history.canGoBack(),
        canGoForward: history.canGoForward()
      }
    })
    return {
      contractVersion: 1,
      capabilityStatus: 'available',
      sessionId: entry.id,
      threadId: entry.threadId,
      lifecycle: entry.lifecycle,
      ...(entry.reason ? { reason: entry.reason } : {}),
      controlOwner: entry.controlOwner,
      visible: entry.mount?.visible === true,
      mounted: Boolean(entry.mount),
      mode: entry.mode,
      tabs,
      ...(entry.activeTabId ? { activeTabId: entry.activeTabId } : {}),
      ...(this.budgetState(entry) ? { budget: this.budgetState(entry) } : {}),
      ...(entry.pendingOrigin ? { pendingOriginConsent: entry.pendingOrigin } : {}),
      ...(entry.pendingAction ? { pendingActionConsent: entry.pendingAction } : {}),
      updatedAt: this.now().toISOString()
    }
  }
  protected defaultState(): BrowserUseViewState {
    const settings = this.options.settings()
    return {
      contractVersion: 1,
      capabilityStatus: settings.enabled ? 'available' : 'disabled',
      ...(!settings.enabled ? { reason: 'Browser Use is disabled in Settings.' } : {}),
      lifecycle: 'closed',
      controlOwner: 'agent',
      visible: false,
      mounted: false,
      mode: settings.mode,
      tabs: [],
      updatedAt: this.now().toISOString()
    }
  }
  protected publish(entry: BrowserSessionEntry): void {
    const state = this.state(entry)
    this.options.onState?.(state)
    const window = entry.mount?.window
    if (window && !window.isDestroyed() && !window.webContents.isDestroyed()) {
      window.webContents.send('browser-use:state', state)
    }
  }

  protected audit(
    entry: BrowserSessionEntry,
    value: Omit<BrowserUseAuditEntry, 'id' | 'timestamp' | 'threadId' | 'sessionId'>,
    tabId?: string
  ): void {
    const record: BrowserUseAuditEntry = {
      id: randomToken(),
      timestamp: this.now().toISOString(),
      threadId: entry.threadId,
      sessionId: entry.id,
      ...(tabId ? { tabId } : {}),
      ...value,
      ...(value.origin ? { origin: originOnly(value.origin) } : {}),
      ...(value.sanitizedPath ? { sanitizedPath: pathOnly(value.sanitizedPath) } : {}),
      ...(value.targetLabel ? { targetLabel: value.targetLabel.slice(0, 256) } : {})
    }
    this.auditEntries.push(record)
    if (this.auditEntries.length > MAX_AUDIT_ENTRIES) {
      this.auditEntries.splice(0, this.auditEntries.length - MAX_AUDIT_ENTRIES)
    }
    void this.options.onAudit?.(record)
  }

  protected activeTab(entry: BrowserSessionEntry): BrowserTab | undefined {
    return entry.activeTabId ? entry.tabs.get(entry.activeTabId) : undefined
  }

  protected requireActiveTab(entry: BrowserSessionEntry): BrowserTab {
    const tab = this.activeTab(entry)
    if (!tab) throw new Error('Browser Use has no active tab.')
    return tab
  }

  protected requireSession(threadId: string): BrowserSessionEntry {
    const entry = this.sessions.get(threadId)
    if (!entry) throw new Error('Browser Use session not found.')
    return entry
  }
}
