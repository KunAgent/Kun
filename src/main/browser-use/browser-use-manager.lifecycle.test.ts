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

function typeAction(result: BrowserUseToolResult, text: string) {
  const target = expectedTarget(result)
  const node = result.snapshot!.nodes.find((candidate) => candidate.ref)!
  return {
    action: 'type' as const,
    ref: node.ref!,
    expectedTarget: target,
    text
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
  let heldCommand: string | undefined
  let heldFunctionNeedle: string | undefined
  let releaseCommand: (() => void) | undefined
  const sendCommand = vi.fn(async (method: string, params?: unknown) => {
    if (
      method === heldCommand &&
      (!heldFunctionNeedle || String((params as { functionDeclaration?: string } | undefined)
        ?.functionDeclaration).includes(heldFunctionNeedle))
    ) {
      heldCommand = undefined
      heldFunctionNeedle = undefined
      await new Promise<void>((resolve) => {
        releaseCommand = resolve
      })
    }
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
  let holdCapture = false
  let releaseCapture: (() => void) | undefined
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
    getZoomFactor: () => 1,
    getTitle: () => currentTitle,
    capturePage: vi.fn(async () => {
      if (holdCapture) {
        holdCapture = false
        await new Promise<void>((resolve) => {
          releaseCapture = resolve
        })
      }
      return image
    }),
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
    holdNextCommand: (method: string) => {
      heldCommand = method
    },
    holdNextFunction: (needle: string) => {
      heldCommand = 'Runtime.callFunctionOn'
      heldFunctionNeedle = needle
    },
    finishCommand: () => releaseCommand?.(),
    holdNextCapture: () => {
      holdCapture = true
    },
    finishCapture: () => releaseCapture?.()
  }
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
  it('cancels a pending decision when the owning supervision surface is hidden', async () => {
    const harness = fakeHarness({ approvalMode: 'always-ask' })
    await openAuthorized(harness)
    const snapshot = await harness.manager.execute('thread-1', 'turn-1', { action: 'snapshot' })
    const pending = harness.manager.execute(
      'thread-1',
      'turn-1',
      clickAction(snapshot)
    )
    await vi.waitFor(() => {
      expect(harness.manager.stateForThread('thread-1').pendingActionConsent).toBeTruthy()
    })

    harness.manager.mount(
      'thread-1',
      harness.window as never,
      { x: 10, y: 10, width: 800, height: 600 },
      false,
      false
    )

    await expect(pending).resolves.toMatchObject({ ok: false, code: 'consent_cancelled' })
    expect(harness.sendCommand).not.toHaveBeenCalledWith(
      'Input.dispatchMouseEvent',
      expect.anything()
    )
  })

  it('revokes refs during manual takeover and destroys temporary session state', async () => {
    const harness = fakeHarness()
    await openAuthorized(harness)
    const blockedMouse = { preventDefault: vi.fn() }
    harness.emitWebContents('before-mouse-event', blockedMouse)
    expect(blockedMouse.preventDefault).toHaveBeenCalledOnce()

    const snapshot = await harness.manager.execute('thread-1', 'turn-1', { action: 'snapshot' })
    const click = clickAction(snapshot)
    harness.manager.setControlOwner('thread-1', 'manual')
    const manualMouse = { preventDefault: vi.fn() }
    harness.emitWebContents('before-mouse-event', manualMouse)
    expect(manualMouse.preventDefault).not.toHaveBeenCalled()
    await expect(harness.manager.execute(
      'thread-1',
      'turn-1',
      click
    )).resolves.toMatchObject({ ok: false, code: 'manual_control_active' })

    harness.manager.setControlOwner('thread-1', 'agent')
    await expect(harness.manager.execute(
      'thread-1',
      'turn-1',
      click
    )).resolves.toMatchObject({ ok: false, code: 'stale_reference' })

    await expect(harness.manager.clear('thread-1')).resolves.toBe(true)
    expect(harness.webContents.close).toHaveBeenCalledOnce()
    expect(harness.proxy.stop).toHaveBeenCalledOnce()
    const closedState = harness.manager.stateForThread('thread-1')
    expect(closedState.lifecycle).toBe('closed')
    expect(closedState).not.toHaveProperty('sessionId')
  })

  it('returns manual control to the agent when the floating preview closes', async () => {
    const harness = fakeHarness()
    await openAuthorized(harness)
    harness.manager.setControlOwner('thread-1', 'manual')

    harness.manager.mount(
      'thread-1',
      harness.window as never,
      { x: 10, y: 10, width: 420, height: 640 },
      false,
      false
    )

    expect(harness.manager.stateForThread('thread-1')).toMatchObject({
      visible: false,
      controlOwner: 'agent',
      lifecycle: 'ready'
    })
    expect(harness.webContents.setIgnoreMenuShortcuts).toHaveBeenLastCalledWith(true)
  })

  it('keeps Stop fail-closed until the user clears the session', async () => {
    const harness = fakeHarness()
    await openAuthorized(harness)
    expect(harness.manager.stop('thread-1').lifecycle).toBe('stopped')
    await expect(harness.manager.execute('thread-1', 'turn-2', { action: 'snapshot' }))
      .resolves.toMatchObject({ ok: false, code: 'session_stopped' })
    await expect(harness.manager.execute('thread-1', 'turn-2', {
      action: 'open',
      url: 'https://example.com/again'
    })).resolves.toMatchObject({ ok: false, code: 'session_stopped' })
    await expect(harness.manager.clear('thread-1')).resolves.toBe(true)
  })

  it('fails closed when the concurrent session cap is reached', async () => {
    const harness = fakeHarness()
    for (let index = 0; index < 4; index += 1) {
      await expect(harness.manager.execute(
        `thread-${index}`,
        `turn-${index}`,
        { action: 'open', url: `https://example.com/${index}` }
      )).resolves.toMatchObject({ ok: true, code: 'opened' })
    }
    await expect(harness.manager.execute(
      'thread-over-limit',
      'turn-over-limit',
      { action: 'open', url: 'https://example.com/limit' }
    )).resolves.toMatchObject({ ok: false, code: 'session_limit_reached' })
  })

  it('creates explicit new tabs up to maxTabs and leaves existing tabs intact at the cap', async () => {
    const harness = fakeHarness({ maxTabs: 2 })
    await openAuthorized(harness)
    await expect(harness.manager.execute(
      'thread-1',
      'turn-2',
      { action: 'open', url: 'https://example.com/second', newTab: true }
    )).resolves.toMatchObject({ ok: true, code: 'opened' })
    expect(harness.manager.stateForThread('thread-1').tabs).toHaveLength(2)

    await expect(harness.manager.execute(
      'thread-1',
      'turn-3',
      { action: 'open', url: 'https://example.com/third', newTab: true }
    )).resolves.toMatchObject({ ok: false, code: 'tab_limit_reached' })
    expect(harness.manager.stateForThread('thread-1').tabs).toHaveLength(2)
  })

  it('does not repopulate refs or audit snapshot success after Stop', async () => {
    const harness = fakeHarness()
    await openAuthorized(harness)
    harness.holdNextCommand('DOM.getBoxModel')
    const pending = harness.manager.execute('thread-1', 'turn-2', { action: 'snapshot' })
    await vi.waitFor(() => {
      expect(harness.sendCommand).toHaveBeenCalledWith('DOM.getBoxModel', expect.anything())
    })

    harness.manager.stop('thread-1')
    harness.finishCommand()
    await expect(pending).resolves.toMatchObject({ ok: false, code: 'aborted' })
    await new Promise((resolve) => setTimeout(resolve, 0))

    expect(harness.manager.auditSnapshot()).not.toContainEqual(expect.objectContaining({
      category: 'execution',
      action: 'snapshot',
      outcome: 'success'
    }))
  })

  it('aborts a held screenshot and a queued tab close without late tab mutation', async () => {
    const harness = fakeHarness()
    await openAuthorized(harness)
    const tabId = harness.manager.stateForThread('thread-1').activeTabId!
    harness.holdNextCapture()
    const screenshot = harness.manager.execute('thread-1', 'turn-2', { action: 'screenshot' })
    await vi.waitFor(() => expect(harness.webContents.capturePage).toHaveBeenCalled())
    const closeTab = harness.manager.execute('thread-1', 'turn-2', {
      action: 'tabs',
      operation: 'close',
      tabId
    })

    harness.manager.stop('thread-1')
    harness.finishCapture()
    await expect(screenshot).resolves.toMatchObject({ ok: false, code: 'aborted' })
    await expect(closeTab).resolves.toMatchObject({ ok: false, code: 'aborted' })
    expect(harness.manager.stateForThread('thread-1').tabs).toHaveLength(1)
    expect(harness.webContents.close).not.toHaveBeenCalled()
  })

  it('clear cancels queued operations so none can revive the removed session', async () => {
    const harness = fakeHarness()
    await openAuthorized(harness)
    harness.holdNextCapture()
    const screenshot = harness.manager.execute('thread-1', 'turn-2', { action: 'screenshot' })
    await vi.waitFor(() => expect(harness.webContents.capturePage).toHaveBeenCalled())
    const queuedScroll = harness.manager.execute('thread-1', 'turn-2', {
      action: 'scroll',
      direction: 'down',
      amount: 120
    })

    const clearing = harness.manager.clear('thread-1')
    harness.finishCapture()
    await expect(screenshot).resolves.toMatchObject({ ok: false, code: 'aborted' })
    await expect(queuedScroll).resolves.toMatchObject({ ok: false, code: 'aborted' })
    await expect(clearing).resolves.toBe(true)
    await new Promise((resolve) => setTimeout(resolve, 0))

    expect(harness.sendCommand).not.toHaveBeenCalledWith(
      'Input.dispatchMouseEvent',
      expect.objectContaining({ type: 'mouseWheel' })
    )
    expect(harness.manager.stateForThread('thread-1').lifecycle).toBe('closed')
  })

  it('returns aborted when Stop interrupts an in-flight scroll command', async () => {
    const harness = fakeHarness()
    await openAuthorized(harness)
    harness.holdNextCommand('Input.dispatchMouseEvent')
    const pending = harness.manager.execute('thread-1', 'turn-2', {
      action: 'scroll',
      direction: 'down',
      amount: 240
    })
    await vi.waitFor(() => {
      expect(harness.sendCommand).toHaveBeenCalledWith(
        'Input.dispatchMouseEvent',
        expect.objectContaining({ type: 'mouseWheel' })
      )
    })

    harness.manager.stop('thread-1')
    harness.finishCommand()
    await expect(pending).resolves.toMatchObject({ ok: false, code: 'aborted' })
  })

  it('does not insert text when Stop interrupts editable-target focus', async () => {
    const harness = fakeHarness({ approvalMode: 'always-ask' })
    harness.setTarget({
      role: 'textbox',
      name: 'Search',
      localName: 'input',
      nodeName: 'INPUT',
      attributes: ['type', 'search']
    })
    await openAuthorized(harness)
    const snapshot = await harness.manager.execute('thread-1', 'turn-1', { action: 'snapshot' })
    const pending = harness.manager.execute(
      'thread-1',
      'turn-2',
      typeAction(snapshot, 'must-not-be-inserted')
    )
    await vi.waitFor(() => {
      expect(harness.manager.stateForThread('thread-1').pendingActionConsent).toBeTruthy()
    })
    harness.holdNextFunction('textTypes')
    const request = harness.manager.stateForThread('thread-1').pendingActionConsent!
    harness.manager.decideAction({
      threadId: 'thread-1',
      requestId: request.id,
      decision: 'allow-once'
    })
    await vi.waitFor(() => {
      expect(harness.sendCommand).toHaveBeenCalledWith(
        'Runtime.callFunctionOn',
        expect.objectContaining({ functionDeclaration: expect.stringContaining('textTypes') })
      )
    })

    harness.manager.stop('thread-1')
    harness.finishCommand()
    await expect(pending).resolves.toMatchObject({ ok: false, code: 'aborted' })
    await new Promise((resolve) => setTimeout(resolve, 0))

    expect(harness.sendCommand).not.toHaveBeenCalledWith('Input.dispatchMouseEvent', expect.anything())
    expect(harness.sendCommand).not.toHaveBeenCalledWith('Input.insertText', expect.anything())
    expect(harness.manager.auditSnapshot()).not.toContainEqual(expect.objectContaining({
      category: 'execution',
      action: 'type',
      outcome: 'success'
    }))
  })

  it('does not dispatch a late mouse release when Stop interrupts a click', async () => {
    const harness = fakeHarness({ approvalMode: 'always-ask' })
    await openAuthorized(harness)
    const snapshot = await harness.manager.execute('thread-1', 'turn-1', { action: 'snapshot' })
    const pending = harness.manager.execute('thread-1', 'turn-2', clickAction(snapshot))
    await vi.waitFor(() => {
      expect(harness.manager.stateForThread('thread-1').pendingActionConsent).toBeTruthy()
    })
    harness.holdNextCommand('Input.dispatchMouseEvent')
    const request = harness.manager.stateForThread('thread-1').pendingActionConsent!
    harness.manager.decideAction({
      threadId: 'thread-1',
      requestId: request.id,
      decision: 'allow-once'
    })
    await vi.waitFor(() => {
      expect(harness.sendCommand).toHaveBeenCalledWith(
        'Input.dispatchMouseEvent',
        expect.objectContaining({ type: 'mousePressed' })
      )
    })

    harness.manager.stop('thread-1')
    harness.finishCommand()
    await expect(pending).resolves.toMatchObject({ ok: false, code: 'aborted' })
    await new Promise((resolve) => setTimeout(resolve, 0))

    expect(harness.sendCommand).not.toHaveBeenCalledWith(
      'Input.dispatchMouseEvent',
      expect.objectContaining({ type: 'mouseReleased' })
    )
    expect(harness.manager.auditSnapshot()).not.toContainEqual(expect.objectContaining({
      category: 'execution',
      action: 'click',
      outcome: 'success'
    }))
  })
})
