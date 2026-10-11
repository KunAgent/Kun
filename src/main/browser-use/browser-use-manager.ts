import { BrowserWindow } from 'electron'
import type {
  BrowserUseAuditEntry,
  BrowserUseDecisionInput,
  BrowserUseRect,
  BrowserUseViewState
} from '../../shared/browser-use'
import {
  BrowserUseActionInput,
  type BrowserUseKunApprovalGrant,
  type BrowserUseKunApprovalMode,
  type BrowserUseToolResult as BrowserUseResult
} from '../../../kun/src/contracts/browser-use.js'
import { BrowserUseManagerInteractions } from './browser-use-manager-interactions'
import {
  abortableDelay,
  isInteractionAction,
  MAX_BROWSER_USE_SESSIONS,
  normalizeBounds,
  resultError,
  resultOk,
  type BrowserSessionEntry
} from './browser-use-manager-support'

export class BrowserUseManager extends BrowserUseManagerInteractions {
  async execute(
    threadId: string,
    turnId: string,
    input: unknown,
    signal?: AbortSignal,
    kunApprovalGrant?: BrowserUseKunApprovalGrant,
    kunApprovalMode?: BrowserUseKunApprovalMode
  ): Promise<BrowserUseResult> {
    const parsed = BrowserUseActionInput.safeParse(input)
    if (!parsed.success) {
      return resultError('invalid_action', 'Browser Use rejected malformed or unsupported arguments.')
    }
    if (signal?.aborted) return resultError('aborted', 'Browser Use action was cancelled.')
    const settings = this.options.settings()
    if (!settings.enabled) {
      return resultError('browser_use_disabled', 'Browser Use is disabled in Settings.')
    }

    const action = parsed.data
    // Full access bypasses only Kun's reviewer. It is deliberately not a
    // substitute for Browser Main's origin/action consent policy.
    const reviewerSource = kunApprovalMode && kunApprovalGrant?.source === kunApprovalMode
      ? kunApprovalGrant.source
      : undefined
    if (action.action === 'open') {
      const existing = this.sessions.get(threadId)
      if (!existing && this.sessions.size >= MAX_BROWSER_USE_SESSIONS) {
        return resultError(
          'session_limit_reached',
          `Browser Use concurrent session limit (${MAX_BROWSER_USE_SESSIONS}) reached.`
        )
      }
      const entry = existing ?? this.createSession(threadId, settings)
      this.adoptTurn(entry, turnId)
      this.touch(entry, settings)
      if (entry.stopping) {
        return resultError(
          'session_stopped',
          'This Browser Use session was stopped. Clear it before starting a new session.',
          entry
        )
      }
      if (entry.controlOwner === 'manual') {
        return resultError(
          'manual_control_active',
          'The user currently has manual control. Wait until control is returned to Kun.',
          entry
        )
      }
      const budgetError = this.consumeBudget(entry, turnId, 'observation', settings)
      if (budgetError) return budgetError
      return this.withAbort(
        entry,
        signal,
        (operationSignal) => this.open(
          entry,
          action.url,
          action.newTab === true,
          reviewerSource,
          operationSignal
        )
      )
    }

    const entry = this.sessions.get(threadId)
    if (!entry) return resultError('session_not_found', 'Open an authorized origin first.')
    this.adoptTurn(entry, turnId)
    this.touch(entry, settings)

    if (action.action === 'close') {
      await this.clear(threadId, 'closed')
      return resultOk('closed', 'Browser Use session closed.')
    }
    if (entry.stopping) {
      return resultError(
        'session_stopped',
        'This Browser Use session was stopped. Clear it before starting a new session.',
        entry
      )
    }

    const interaction = isInteractionAction(action)
    const budgetError = this.consumeBudget(
      entry,
      turnId,
      interaction ? 'interaction' : 'observation',
      settings
    )
    if (budgetError) return budgetError

    return this.withAbort(entry, signal, async (operationSignal) => {
      if (entry.controlOwner === 'manual') {
        return resultError(
          'manual_control_active',
          'The user currently has manual control. Wait until control is returned to Kun.',
          entry
        )
      }
      switch (action.action) {
        case 'snapshot':
          return this.snapshot(entry, operationSignal)
        case 'screenshot':
          return this.screenshot(entry, operationSignal)
        case 'click':
        case 'type':
        case 'select':
        case 'press':
          return this.interact(entry, action, reviewerSource, operationSignal)
        case 'scroll':
          return this.scroll(entry, action.direction, action.amount, operationSignal)
        case 'wait':
          await abortableDelay(action.milliseconds, operationSignal)
          return resultOk('waited', `Waited ${action.milliseconds}ms.`, entry)
        case 'tabs':
          return this.tabs(entry, action.operation, action.tabId, operationSignal)
        default:
          return resultError('unsupported_action', 'Unsupported Browser Use action.', entry)
      }
    })
  }

  mount(
    threadId: string,
    window: BrowserWindow,
    rawBounds: BrowserUseRect,
    visible: boolean,
    supervisionActive = visible,
    expectedTurnId?: string
  ): BrowserUseViewState {
    const entry = this.sessions.get(threadId)
    if (!entry) return this.defaultState()
    this.assertExpectedTurn(threadId, expectedTurnId)
    if (entry.mount && entry.mount.window !== window) {
      throw new Error('Browser Use session is already bound to another window.')
    }
    const bounds = normalizeBounds(rawBounds, window.getContentBounds(), window.webContents.getZoomFactor())
    const onRendererLost = entry.mount?.onRendererLost ?? (() => {
      void this.clear(threadId, 'renderer-lost')
    })
    if (!entry.mount) {
      const rendererContents = window.webContents as typeof window.webContents & {
        once?: (event: string, listener: () => void) => void
      }
      const lifecycleWindow = window as BrowserWindow & {
        once?: (event: string, listener: () => void) => void
      }
      rendererContents.once?.('render-process-gone', onRendererLost)
      lifecycleWindow.once?.('closed', onRendererLost)
    }
    entry.mount = {
      expectedTurnId,
      window,
      bounds,
      visible: visible && bounds.width > 0 && bounds.height > 0,
      supervisionActive,
      onRendererLost
    }
    if (!supervisionActive && (entry.pendingOriginDecision || entry.pendingActionDecision)) {
      this.cancelPending(entry, 'cancelled')
    }
    if (!supervisionActive && entry.controlOwner === 'manual') {
      entry.controlOwner = 'agent'
      entry.lifecycle = 'ready'
      this.invalidateDocument(entry, 'hidden-manual-control')
      for (const browserTab of entry.tabs.values()) {
        browserTab.view.webContents.setIgnoreMenuShortcuts(true)
      }
    }
    const tab = this.activeTab(entry)
    if (tab) this.attachView(entry, tab)
    if (entry.mount.visible) {
      for (const waiter of entry.mountWaiters) waiter()
      entry.mountWaiters.clear()
      if (entry.lifecycle === 'mount-required') entry.lifecycle = 'ready'
    }
    this.publish(entry)
    return this.state(entry)
  }

  setControlOwner(
    threadId: string,
    controlOwner: BrowserUseViewState['controlOwner'],
    expectedTurnId?: string
  ): BrowserUseViewState {
    this.assertExpectedTurn(threadId, expectedTurnId)
    const entry = this.requireSession(threadId)
    if (entry.controlOwner === controlOwner) return this.state(entry)
    entry.controlOwner = controlOwner
    entry.lifecycle = controlOwner === 'manual' ? 'manual-control' : 'ready'
    this.invalidateDocument(entry, 'control_handoff')
    if (controlOwner === 'manual') this.cancelActiveOperations(entry)
    for (const tab of entry.tabs.values()) {
      tab.view.webContents.setIgnoreMenuShortcuts(controlOwner !== 'manual')
    }
    this.audit(entry, {
      category: 'lifecycle',
      action: controlOwner === 'manual' ? 'manual-control' : 'agent-control',
      outcome: 'success'
    })
    this.publish(entry)
    return this.state(entry)
  }

  decideOrigin(input: BrowserUseDecisionInput): BrowserUseViewState {
    this.assertExpectedTurn(input.threadId, input.expectedTurnId)
    const entry = this.requireSession(input.threadId)
    const pending = entry.pendingOriginDecision
    if (!pending || pending.id !== input.requestId) {
      throw new Error('Origin consent request is stale or does not belong to this session.')
    }
    pending.resolve(input.decision)
    return this.state(entry)
  }

  decideAction(input: BrowserUseDecisionInput): BrowserUseViewState {
    this.assertExpectedTurn(input.threadId, input.expectedTurnId)
    const entry = this.requireSession(input.threadId)
    const pending = entry.pendingActionDecision
    if (!pending || pending.id !== input.requestId) {
      throw new Error('Action consent request is stale or does not belong to this session.')
    }
    pending.resolve(input.decision)
    return this.state(entry)
  }

  stop(threadId: string, expectedTurnId?: string): BrowserUseViewState {
    this.assertExpectedTurn(threadId, expectedTurnId)
    const entry = this.requireSession(threadId)
    entry.lifecycle = 'stopped'
    entry.stopping = true
    this.cancelActiveOperations(entry)
    this.invalidateDocument(entry, 'stopped')
    this.audit(entry, {
      category: 'lifecycle',
      action: 'stop',
      outcome: 'aborted'
    })
    this.publish(entry)
    return this.state(entry)
  }

  async clear(threadId: string, reason = 'cleared', expectedTurnId?: string): Promise<boolean> {
    const entry = this.sessions.get(threadId)
    if (!entry) return false
    this.assertExpectedTurn(threadId, expectedTurnId)
    this.sessions.delete(threadId)
    entry.stopping = true
    this.cancelActiveOperations(entry)
    const boundWindow = entry.mount?.window
    const rendererLost = entry.mount?.onRendererLost
    if (boundWindow && rendererLost) {
      const rendererContents = boundWindow.webContents as typeof boundWindow.webContents & {
        removeListener?: (event: string, listener: () => void) => void
      }
      const lifecycleWindow = boundWindow as BrowserWindow & {
        removeListener?: (event: string, listener: () => void) => void
      }
      rendererContents.removeListener?.('render-process-gone', rendererLost)
      lifecycleWindow.removeListener?.('closed', rendererLost)
    }
    if (entry.idleTimer) clearTimeout(entry.idleTimer)
    if (entry.proxyStart) await entry.proxyStart.catch(() => undefined)
    for (const tab of entry.tabs.values()) {
      this.detachView(entry, tab)
      const targetSession = tab.view.webContents.session
      if (!tab.view.webContents.isDestroyed()) tab.view.webContents.close()
      await Promise.allSettled([
        targetSession.closeAllConnections(),
        targetSession.clearCache(),
        targetSession.clearStorageData()
      ])
    }
    entry.tabs.clear()
    if (entry.proxy) await entry.proxy.stop()
    this.audit(entry, {
      category: 'lifecycle',
      action: reason,
      outcome: 'success'
    })
    if (!this.sessions.has(threadId)) this.options.onState?.({
      ...this.defaultState(),
      threadId,
      turnId: entry.activeTurnId,
      mode: entry.mode,
      updatedAt: this.now().toISOString()
    })
    return true
  }

  async disposeAll(reason = 'runtime-shutdown'): Promise<void> {
    await Promise.all([...this.sessions.keys()].map((threadId) => this.clear(threadId, reason)))
  }

  stateForThread(threadId: string, expectedTurnId?: string): BrowserUseViewState {
    const entry = this.sessions.get(threadId)
    // Reads may race a new turn before it opens Browser Use. Return no stale
    // contents; mutating operations still reject an expected-turn mismatch.
    if (entry && expectedTurnId !== undefined && entry.activeTurnId !== expectedTurnId) return this.defaultState()
    return entry ? this.state(entry) : this.defaultState()
  }

  isBoundToWindow(threadId: string, window: BrowserWindow): boolean {
    return this.sessions.get(threadId)?.mount?.window === window
  }

  navigate(
    threadId: string,
    command: 'back' | 'forward' | 'reload',
    expectedTurnId?: string
  ): BrowserUseViewState {
    this.assertExpectedTurn(threadId, expectedTurnId)
    const entry = this.requireSession(threadId)
    const tab = this.requireActiveTab(entry)
    const history = tab.view.webContents.navigationHistory
    this.cancelActiveOperations(entry)
    this.invalidateDocument(entry, `user-${command}`)
    if (command === 'back' && history.canGoBack()) history.goBack()
    else if (command === 'forward' && history.canGoForward()) history.goForward()
    else if (command === 'reload') tab.view.webContents.reload()
    this.audit(entry, {
      category: 'lifecycle',
      action: `user-${command}`,
      outcome: 'success'
    }, tab.id)
    this.publish(entry)
    return this.state(entry)
  }

  private adoptTurn(entry: BrowserSessionEntry, turnId: string): void {
    if (entry.activeTurnId === turnId) return
    // A private panel supervises one turn only. Retire its native view now; its
    // delayed cleanup must not be allowed to hide a newer turn's remount.
    if (entry.mount?.expectedTurnId !== undefined && entry.mount.expectedTurnId !== turnId) {
      entry.mount.visible = false
      entry.mount.supervisionActive = false
      this.cancelActiveOperations(entry)
      this.invalidateDocument(entry, 'turn-changed')
      entry.controlOwner = 'agent'
      entry.lifecycle = entry.stopping ? 'stopped' : 'mount-required'
      for (const tab of entry.tabs.values()) {
        tab.view.setVisible(false)
        tab.view.webContents.setIgnoreMenuShortcuts(true)
      }
    }
    entry.activeTurnId = turnId
    this.publish(entry)
  }

  private assertExpectedTurn(threadId: string, expectedTurnId?: string): void {
    if (expectedTurnId !== undefined && this.sessions.get(threadId)?.activeTurnId !== expectedTurnId) {
      throw new Error('Browser Use turn changed; refresh the current execution before continuing.')
    }
  }

  auditSnapshot(): readonly BrowserUseAuditEntry[] {
    return this.auditEntries.map((entry) => ({ ...entry }))
  }

}
