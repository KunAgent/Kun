import { describe, expect, it, vi } from 'vitest'
import {
  signBrowserUseKunApprovalGrant,
  type BrowserUseToolResult,
  BrowserUseActionInput,
  type BrowserUseKunApprovalGrant
} from '../../../kun/src/contracts/browser-use'
import { ToolOperationJournal } from '../../../kun/src/reliability/operation-journal'
import type { KunBrowserUseSettingsV1 } from '../../shared/app-settings'
import type { BrowserUseViewState } from '../../shared/browser-use'
import { BrowserUseManager } from './browser-use-manager'

vi.mock('electron', () => ({
  BrowserWindow: class {},
  WebContentsView: class {}
}))

const settings: KunBrowserUseSettingsV1 = {
  enabled: true,
  mode: 'public',
  approvalMode: 'auto-safe',
  maxTabs: 2,
  maxObservationActionsPerTurn: 30,
  maxInteractionActionsPerTurn: 12,
  maxSnapshotNodes: 250,
  maxSnapshotTextChars: 20_000,
  maxImageDimension: 1280,
  idleTimeoutMs: 300_000
}

let nextGrantId = 0
const APPROVAL_SIGNING_KEY = 's'.repeat(43)
function kunApprovalGrant(
  action: BrowserUseActionInput,
  source: BrowserUseKunApprovalGrant['source'] = 'agent',
  threadId = 'thread-1',
  turnId = 'turn-1'
): BrowserUseKunApprovalGrant {
  nextGrantId += 1
  const issuedAt = new Date()
  return signBrowserUseKunApprovalGrant({
    id: `${source === 'full-access' ? 'grant' : 'appr'}_${nextGrantId.toString(16).padStart(32, '0')}`,
    source,
    toolName: 'browser_use',
    threadId,
    turnId,
    callId: `call-browser-${nextGrantId}`,
    argumentsHash: ToolOperationJournal.argsHash(action),
    issuedAt: issuedAt.toISOString(),
    expiresAt: new Date(issuedAt.getTime() + 2 * 60 * 1_000).toISOString()
  }, APPROVAL_SIGNING_KEY)
}

function expectedTarget(result: BrowserUseToolResult) {
  const snapshot = result.snapshot
  const node = snapshot?.nodes.find((candidate) => candidate.ref)
  if (!snapshot || !node?.ref) {
    throw new Error('test snapshot did not contain an actionable Browser Use target')
  }
  return {
    sessionId: snapshot.sessionId,
    tabId: snapshot.tabId,
    documentGeneration: snapshot.documentGeneration,
    origin: snapshot.origin,
    sanitizedUrl: snapshot.sanitizedUrl,
    role: node.role,
    name: node.name
  }
}

function clickAction(result: BrowserUseToolResult) {
  const target = expectedTarget(result)
  const node = result.snapshot!.nodes.find((candidate) => candidate.ref)!
  return {
    action: 'click' as const,
    ref: node.ref!,
    expectedTarget: target
  }
}

function fakeHarness(settingsPatch: Partial<KunBrowserUseSettingsV1> = {}) {
  const effectiveSettings = { ...settings, ...settingsPatch }
  const listeners = new Map<string, Array<(...args: unknown[]) => void>>()
  const debuggerListeners = new Map<string, Array<(...args: unknown[]) => void>>()
  let currentUrl = ''
  let currentTitle = 'Example'
  let currentBox = [10, 10, 110, 10, 110, 50, 10, 50]
  let currentTarget = {
    role: 'button',
    name: 'Continue',
    localName: 'button',
    nodeName: 'BUTTON',
    attributes: ['type', 'button']
  }
  const sendCommand = vi.fn(async (method: string) => {
    if (method === 'Accessibility.getFullAXTree') {
      return {
        nodes: [{
          backendDOMNodeId: 7,
          role: { value: currentTarget.role },
          name: { value: currentTarget.name },
          properties: [{ name: 'focusable', value: { value: true } }]
        }]
      }
    }
    if (method === 'Accessibility.getPartialAXTree') {
      return {
        nodes: [{
          backendDOMNodeId: 7,
          role: { value: currentTarget.role },
          name: { value: currentTarget.name }
        }]
      }
    }
    if (method === 'DOM.describeNode') {
      return {
        node: {
          backendNodeId: 7,
          localName: currentTarget.localName,
          nodeName: currentTarget.nodeName,
          attributes: currentTarget.attributes
        }
      }
    }
    if (method === 'DOM.getBoxModel') return { model: { border: currentBox } }
    if (method === 'DOM.resolveNode') return { object: { objectId: 'target-object' } }
    if (method === 'Runtime.callFunctionOn') return { result: { value: true } }
    return {}
  })
  const session = {
    setProxy: vi.fn(async () => undefined),
    setPermissionRequestHandler: vi.fn(),
    setPermissionCheckHandler: vi.fn(),
    setDevicePermissionHandler: vi.fn(),
    on: vi.fn(),
    closeAllConnections: vi.fn(async () => undefined),
    clearCache: vi.fn(async () => undefined),
    clearStorageData: vi.fn(async () => undefined),
    webRequest: { onBeforeRequest: vi.fn() }
  }
  const image = {
    getSize: () => ({ width: 800, height: 600 }),
    resize: () => image,
    toPNG: () => Buffer.from('bounded-image')
  }
  let resolveLoad: (() => void) | undefined
  const webContents = {
    id: 77,
    session,
    debugger: {
      attach: vi.fn(),
      sendCommand,
      on: vi.fn((event: string, listener: (...args: unknown[]) => void) => {
        debuggerListeners.set(event, [...(debuggerListeners.get(event) ?? []), listener])
      })
    },
    navigationHistory: {
      canGoBack: () => false,
      canGoForward: () => false
    },
    setAudioMuted: vi.fn(),
    setIgnoreMenuShortcuts: vi.fn(),
    setWindowOpenHandler: vi.fn(),
    on: vi.fn((event: string, listener: (...args: unknown[]) => void) => {
      listeners.set(event, [...(listeners.get(event) ?? []), listener])
    }),
    once: vi.fn((event: string, listener: (...args: unknown[]) => void) => {
      listeners.set(event, [...(listeners.get(event) ?? []), listener])
    }),
    loadURL: vi.fn(async (url: string) => {
      currentUrl = url
      for (const listener of listeners.get('did-start-loading') ?? []) listener()
      for (const listener of listeners.get('did-stop-loading') ?? []) listener()
    }),
    stop: vi.fn(),
    getURL: () => currentUrl,
    getTitle: () => currentTitle,
    capturePage: vi.fn(async () => image),
    isDestroyed: () => false,
    close: vi.fn()
  }
  const view = {
    webContents,
    setBackgroundColor: vi.fn(),
    setBounds: vi.fn(),
    setVisible: vi.fn(),
    setBorderRadius: vi.fn()
  }
  const children: unknown[] = []
  const window = {
    isDestroyed: () => false,
    getContentBounds: () => ({ x: 0, y: 0, width: 1200, height: 900 }),
    contentView: {
      children,
      addChildView: (child: unknown) => children.push(child),
      removeChildView: (child: unknown) => {
        const index = children.indexOf(child)
        if (index >= 0) children.splice(index, 1)
      }
    },
    webContents: {
      getZoomFactor: () => 1,
      isDestroyed: () => false,
      send: vi.fn()
    }
  }
  const proxy = {
    start: vi.fn(async () => 'http://127.0.0.1:34567'),
    stop: vi.fn(async () => undefined)
  }
  const states: BrowserUseViewState[] = []
  const manager = new BrowserUseManager({
    settings: () => effectiveSettings,
    createView: () => view as never,
    createProxy: () => proxy as never,
    onState: (state) => states.push(state)
  })
  return {
    manager,
    settings: effectiveSettings,
    states,
    view,
    webContents,
    sendCommand,
    proxy,
    window,
    setBox: (box: number[]) => {
      currentBox = box
    },
    setTarget: (target: typeof currentTarget) => {
      currentTarget = target
    },
    setTitle: (title: string) => {
      currentTitle = title
    },
    emitWebContents: (event: string, ...args: unknown[]) => {
      for (const listener of listeners.get(event) ?? []) listener(...args)
    },
    holdNextLoad: () => {
      webContents.loadURL.mockImplementationOnce(async (url: string) => {
        currentUrl = url
        for (const listener of listeners.get('did-start-loading') ?? []) listener()
        await new Promise<void>((resolve) => {
          resolveLoad = resolve
        })
      })
    },
    finishLoad: () => resolveLoad?.()
  }
}

async function waitForCallCount(mock: { mock: { calls: unknown[][] } }, count: number): Promise<void> {
  await vi.waitFor(() => {
    expect(mock.mock.calls).toHaveLength(count)
  })
}

async function expectNoAdditionalCall(
  mock: { mock: { calls: unknown[][] } },
  count: number
): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, 0))
  expect(mock.mock.calls).toHaveLength(count)
}

async function openAuthorized(
  harness: ReturnType<typeof fakeHarness>,
  url = 'https://example.com/start?secret=redacted'
): Promise<void> {
  const pending = harness.manager.execute(
    'thread-1',
    'turn-1',
    { action: 'open', url }
  )
  await vi.waitFor(() => {
    expect(harness.states.at(-1)?.sessionId).toBeTruthy()
  })
  harness.manager.mount(
    'thread-1',
    harness.window as never,
    { x: 10, y: 10, width: 800, height: 600 },
    true
  )
  if (harness.settings.approvalMode === 'always-ask' ||
    harness.settings.mode === 'local-development') {
    await vi.waitFor(() => {
      expect(harness.manager.stateForThread('thread-1').pendingOriginConsent).toBeTruthy()
    })
    const request = harness.manager.stateForThread('thread-1').pendingOriginConsent!
    harness.manager.decideOrigin({
      threadId: 'thread-1',
      requestId: request.id,
      decision: 'allow-once'
    })
  }
  await expect(pending).resolves.toMatchObject({ ok: true, code: 'opened' })
}

describe('BrowserUseManager', () => {
  it('opens a policy-vetted public origin in a hidden background viewport', async () => {
    const harness = fakeHarness()
    await expect(harness.manager.execute(
      'thread-1',
      'turn-1',
      { action: 'open', url: 'https://example.com/start?secret=redacted' }
    )).resolves.toMatchObject({ ok: true, code: 'opened' })

    expect(harness.webContents.loadURL).toHaveBeenCalledWith(
      'https://example.com/start?secret=redacted'
    )
    const loadOrder = harness.webContents.loadURL.mock.invocationCallOrder[0]
    const domEnableOrder = harness.sendCommand.mock.invocationCallOrder[
      harness.sendCommand.mock.calls.findIndex(([method]) => method === 'DOM.enable')
    ]
    expect(loadOrder).toBeLessThan(domEnableOrder)
    expect(harness.view.setBounds).toHaveBeenCalledWith({
      x: 0,
      y: 0,
      width: 1280,
      height: 800
    })
    expect(harness.view.setVisible).toHaveBeenCalledWith(false)
    expect(harness.manager.stateForThread('thread-1')).toMatchObject({
      visible: false,
      mounted: false
    })
    expect(harness.proxy.start).toHaveBeenCalledOnce()
    expect(harness.manager.stateForThread('thread-1').pendingOriginConsent).toBeUndefined()
    expect(harness.manager.auditSnapshot().some((entry) =>
      entry.category === 'origin-consent' &&
      entry.action === 'auto-grant-public-origin' &&
      entry.decision === 'allowed' &&
      entry.origin === 'https://example.com'
    )).toBe(true)
    expect(JSON.stringify(harness.manager.auditSnapshot())).not.toContain('secret=redacted')
  })

  it('keeps a main-frame load failure visible after loading stops', async () => {
    const harness = fakeHarness()
    await openAuthorized(harness)
    harness.emitWebContents('did-fail-load', {}, -105, 'NAME_NOT_RESOLVED', '', true)
    harness.emitWebContents('did-stop-loading')
    expect(harness.manager.stateForThread('thread-1')).toMatchObject({
      lifecycle: 'error',
      reason: 'NAME_NOT_RESOLVED'
    })
  })

  it('stops a cross-origin redirect and asks for a new exact-origin decision', async () => {
    const harness = fakeHarness({ approvalMode: 'always-ask' })
    await openAuthorized(harness)
    const redirectEvent = { preventDefault: vi.fn() }
    harness.emitWebContents(
      'will-redirect',
      redirectEvent,
      'https://other.example/landing?token=secret'
    )

    await vi.waitFor(() => {
      expect(harness.manager.stateForThread('thread-1').pendingOriginConsent?.origin)
        .toBe('https://other.example')
    })
    expect(redirectEvent.preventDefault).toHaveBeenCalledOnce()
    expect(harness.manager.stateForThread('thread-1').pendingOriginConsent?.sanitizedUrl)
      .toBe('https://other.example/landing')
    const request = harness.manager.stateForThread('thread-1').pendingOriginConsent!
    harness.manager.decideOrigin({
      threadId: 'thread-1',
      requestId: request.id,
      decision: 'deny'
    })
  })

  it('still requires exact-origin approval in local-development mode', async () => {
    const harness = fakeHarness({ mode: 'local-development' })
    const pending = harness.manager.execute(
      'thread-1',
      'turn-1',
      { action: 'open', url: 'http://127.0.0.1:4173/app' }
    )
    await vi.waitFor(() => {
      expect(harness.states.at(-1)?.sessionId).toBeTruthy()
    })
    harness.manager.mount(
      'thread-1',
      harness.window as never,
      { x: 10, y: 10, width: 800, height: 600 },
      true
    )
    await vi.waitFor(() => {
      expect(harness.manager.stateForThread('thread-1').pendingOriginConsent?.origin)
        .toBe('http://127.0.0.1:4173')
    })
    const request = harness.manager.stateForThread('thread-1').pendingOriginConsent!
    harness.manager.decideOrigin({
      threadId: 'thread-1',
      requestId: request.id,
      decision: 'allow-once'
    })
    await expect(pending).resolves.toMatchObject({ ok: true, code: 'opened' })
  })

  it('does not let an agent Kun grant replace Main origin or action consent', async () => {
    const harness = fakeHarness({
      mode: 'local-development',
      approvalMode: 'always-ask'
    })
    const open = {
      action: 'open' as const,
      url: 'http://127.0.0.1:4173/app'
    }
    const pendingOpen = harness.manager.execute(
      'thread-1',
      'turn-1',
      open,
      undefined,
      kunApprovalGrant(open),
      'agent'
    )
    await vi.waitFor(() => expect(harness.states.at(-1)?.sessionId).toBeTruthy())
    harness.manager.mount(
      'thread-1',
      harness.window as never,
      { x: 10, y: 10, width: 800, height: 600 },
      true
    )
    await vi.waitFor(() => {
      expect(harness.manager.stateForThread('thread-1').pendingOriginConsent).toBeTruthy()
    })
    const originRequest = harness.manager.stateForThread('thread-1').pendingOriginConsent!
    harness.manager.decideOrigin({
      threadId: 'thread-1',
      requestId: originRequest.id,
      decision: 'allow-once'
    })
    await expect(pendingOpen).resolves.toMatchObject({ ok: true, code: 'opened' })

    const snapshot = await harness.manager.execute(
      'thread-1',
      'turn-1',
      { action: 'snapshot' }
    )
    const click = clickAction(snapshot)
    const pendingClick = harness.manager.execute(
      'thread-1',
      'turn-1',
      click,
      undefined,
      kunApprovalGrant(click),
      'agent'
    )
    await vi.waitFor(() => {
      expect(harness.manager.stateForThread('thread-1').pendingActionConsent).toBeTruthy()
    })
    const actionRequest = harness.manager.stateForThread('thread-1').pendingActionConsent!
    harness.manager.decideAction({
      threadId: 'thread-1',
      requestId: actionRequest.id,
      decision: 'allow-once'
    })
    await expect(pendingClick).resolves.toMatchObject({ ok: true, code: 'action_executed' })

    expect(harness.manager.auditSnapshot()).toEqual(expect.arrayContaining([
      expect.objectContaining({ category: 'origin-consent', reviewerSource: 'agent' }),
      expect.objectContaining({ category: 'action-consent', reviewerSource: 'agent' })
    ]))
  })

  it('retains Main origin and action consent in Full access', async () => {
    const harness = fakeHarness({
      mode: 'local-development',
      approvalMode: 'always-ask'
    })
    const open = {
      action: 'open' as const,
      url: 'http://127.0.0.1:4173/app'
    }
    const pendingOpen = harness.manager.execute(
      'thread-1',
      'turn-1',
      open,
      undefined,
      kunApprovalGrant(open, 'full-access'),
      'full-access'
    )
    await vi.waitFor(() => {
      expect(harness.states.at(-1)?.sessionId).toBeTruthy()
    })
    harness.manager.mount(
      'thread-1',
      harness.window as never,
      { x: 10, y: 10, width: 800, height: 600 },
      true
    )
    await vi.waitFor(() => {
      expect(harness.manager.stateForThread('thread-1').pendingOriginConsent).toBeTruthy()
    })
    const originRequest = harness.manager.stateForThread('thread-1').pendingOriginConsent!
    harness.manager.decideOrigin({
      threadId: 'thread-1',
      requestId: originRequest.id,
      decision: 'allow-once'
    })
    await expect(pendingOpen).resolves.toMatchObject({ ok: true, code: 'opened' })

    const snapshot = await harness.manager.execute(
      'thread-1',
      'turn-1',
      { action: 'snapshot' },
      undefined,
      undefined,
      'full-access'
    )
    const click = clickAction(snapshot)
    const pendingClick = harness.manager.execute(
      'thread-1',
      'turn-1',
      click,
      undefined,
      kunApprovalGrant(click, 'full-access'),
      'full-access'
    )
    await vi.waitFor(() => {
      expect(harness.manager.stateForThread('thread-1').pendingActionConsent).toBeTruthy()
    })
    const actionRequest = harness.manager.stateForThread('thread-1').pendingActionConsent!
    harness.manager.decideAction({
      threadId: 'thread-1',
      requestId: actionRequest.id,
      decision: 'allow-once'
    })
    await expect(pendingClick).resolves.toMatchObject({ ok: true, code: 'action_executed' })
  })

  it('serializes same-session opens and starts the policy proxy only once', async () => {
    const harness = fakeHarness()
    harness.holdNextLoad()
    const first = harness.manager.execute(
      'thread-1',
      'turn-1',
      { action: 'open', url: 'https://example.com/first' }
    )
    await waitForCallCount(harness.webContents.loadURL, 1)

    const second = harness.manager.execute(
      'thread-1',
      'turn-2',
      { action: 'open', url: 'https://example.com/second' }
    )
    await expectNoAdditionalCall(harness.webContents.loadURL, 1)
    harness.finishLoad()

    await expect(first).resolves.toMatchObject({ ok: true, code: 'opened' })
    await expect(second).resolves.toMatchObject({ ok: true, code: 'opened' })
    expect(harness.proxy.start).toHaveBeenCalledOnce()
    expect(harness.webContents.loadURL).toHaveBeenCalledTimes(2)
  })

  it('does not publish a tab when proxy assignment fails and retries with a fresh setup', async () => {
    const harness = fakeHarness()
    harness.webContents.session.setProxy.mockRejectedValueOnce(new Error('proxy rejected'))

    await expect(harness.manager.execute(
      'thread-1',
      'turn-1',
      { action: 'open', url: 'https://example.com/first' }
    )).resolves.toMatchObject({ ok: false, code: 'navigation_failed' })
    expect(harness.manager.stateForThread('thread-1').tabs).toHaveLength(0)
    expect(harness.webContents.loadURL).not.toHaveBeenCalled()
    expect(harness.webContents.close).toHaveBeenCalledOnce()

    await expect(harness.manager.execute(
      'thread-1',
      'turn-2',
      { action: 'open', url: 'https://example.com/retry' }
    )).resolves.toMatchObject({ ok: true, code: 'opened' })
    expect(harness.webContents.session.setProxy).toHaveBeenCalledTimes(2)
    expect(harness.manager.stateForThread('thread-1').tabs).toHaveLength(1)
  })

  it('closes a tab whose structured hardening fails without replacing the active tab', async () => {
    const harness = fakeHarness({ maxTabs: 2 })
    await openAuthorized(harness)
    const before = harness.manager.stateForThread('thread-1')
    harness.webContents.debugger.attach.mockImplementationOnce(() => {
      throw new Error('debugger unavailable')
    })

    await expect(harness.manager.execute(
      'thread-1',
      'turn-2',
      { action: 'open', url: 'https://example.com/second', newTab: true }
    )).resolves.toMatchObject({ ok: false, code: 'navigation_failed' })

    const after = harness.manager.stateForThread('thread-1')
    expect(after.lifecycle).toBe(before.lifecycle)
    expect(after.tabs).toHaveLength(1)
    expect(after.activeTabId).toBe(before.activeTabId)
    expect(after.tabs[0]).toMatchObject({
      id: before.tabs[0]?.id,
      origin: before.tabs[0]?.origin,
      active: true
    })
    expect(harness.webContents.close).toHaveBeenCalledOnce()
  })

})
