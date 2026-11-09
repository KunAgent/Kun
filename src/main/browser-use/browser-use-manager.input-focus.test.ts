import { describe, expect, it, vi } from 'vitest'
import type { BrowserUseToolResult } from '../../../kun/src/contracts/browser-use'
import type { KunBrowserUseSettingsV1 } from '../../shared/app-settings'
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

type Target = {
  role: string
  name: string
  localName: string
  nodeName: string
  attributes: string[]
}

function expectedTarget(result: BrowserUseToolResult) {
  const snapshot = result.snapshot!
  const node = snapshot.nodes.find((candidate) => candidate.ref)!
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

function fakeHarness(target: Target) {
  const listeners = new Map<string, Array<(...args: unknown[]) => void>>()
  let currentUrl = ''
  let editableFocusAllowed = true
  const sendCommand = vi.fn(async (method: string, params?: unknown) => {
    if (method === 'Accessibility.getFullAXTree') {
      return {
        nodes: [{
          backendDOMNodeId: 7,
          role: { value: target.role },
          name: { value: target.name },
          properties: [{ name: 'focusable', value: { value: true } }]
        }]
      }
    }
    if (method === 'Accessibility.getPartialAXTree') {
      return {
        nodes: [{
          backendDOMNodeId: 7,
          role: { value: target.role },
          name: { value: target.name }
        }]
      }
    }
    if (method === 'DOM.describeNode') {
      return {
        node: {
          backendNodeId: 7,
          localName: target.localName,
          nodeName: target.nodeName,
          attributes: target.attributes
        }
      }
    }
    if (method === 'DOM.getBoxModel') {
      return { model: { border: [10, 10, 110, 10, 110, 50, 10, 50] } }
    }
    if (method === 'DOM.resolveNode') return { object: { objectId: 'target-object' } }
    if (method === 'Runtime.callFunctionOn') {
      const source = String((params as { functionDeclaration?: string } | undefined)
        ?.functionDeclaration)
      if (source.includes('textTypes')) return { result: { value: editableFocusAllowed } }
      return { result: { value: true } }
    }
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
    toPNG: () => Buffer.from('image')
  }
  const webContents = {
    id: 77,
    session,
    debugger: {
      attach: vi.fn(),
      sendCommand,
      on: vi.fn()
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
    }),
    stop: vi.fn(),
    getURL: () => currentUrl,
    getZoomFactor: () => 1,
    getTitle: () => 'Example',
    capturePage: vi.fn(async () => image),
    isDestroyed: () => false,
    close: vi.fn()
  }
  const view = {
    webContents,
    setBounds: vi.fn(),
    setVisible: vi.fn()
  }
  const children: unknown[] = []
  const window = {
    isDestroyed: () => false,
    getContentBounds: () => ({ x: 0, y: 0, width: 1200, height: 900 }),
    contentView: {
      children,
      addChildView: (child: unknown) => children.push(child),
      removeChildView: vi.fn()
    },
    webContents: {
      getZoomFactor: () => 1,
      isDestroyed: () => false,
      send: vi.fn()
    }
  }
  const manager = new BrowserUseManager({
    settings: () => settings,
    createView: () => view as never,
    createProxy: () => ({
      start: vi.fn(async () => 'http://127.0.0.1:34567'),
      stop: vi.fn(async () => undefined)
    }) as never
  })
  return {
    manager,
    sendCommand,
    window,
    rejectEditableFocus: () => {
      editableFocusAllowed = false
    }
  }
}

async function openAndSnapshot(harness: ReturnType<typeof fakeHarness>) {
  await expect(harness.manager.execute(
    'thread-1',
    'turn-1',
    { action: 'open', url: 'https://example.com/start' }
  )).resolves.toMatchObject({ ok: true, code: 'opened' })
  harness.manager.mount(
    'thread-1',
    harness.window as never,
    { x: 10, y: 10, width: 800, height: 600 },
    true
  )
  return harness.manager.execute('thread-1', 'turn-1', { action: 'snapshot' })
}

async function approvePending(harness: ReturnType<typeof fakeHarness>) {
  await vi.waitFor(() => {
    expect(harness.manager.stateForThread('thread-1').pendingActionConsent).toBeTruthy()
  })
  const request = harness.manager.stateForThread('thread-1').pendingActionConsent!
  harness.manager.decideAction({
    threadId: 'thread-1',
    requestId: request.id,
    decision: 'allow-once'
  })
}

describe('Browser Use keyboard and text focus', () => {
  it('focuses a press target without dispatching a mouse click', async () => {
    const harness = fakeHarness({
      role: 'button',
      name: 'Expand',
      localName: 'button',
      nodeName: 'BUTTON',
      attributes: ['type', 'button']
    })
    const snapshot = await openAndSnapshot(harness)
    const node = snapshot.snapshot!.nodes.find((candidate) => candidate.ref)!
    const pending = harness.manager.execute('thread-1', 'turn-1', {
      action: 'press',
      ref: node.ref!,
      expectedTarget: expectedTarget(snapshot),
      key: 'Escape'
    })
    await approvePending(harness)

    await expect(pending).resolves.toMatchObject({ ok: true, code: 'action_executed' })
    expect(harness.sendCommand).toHaveBeenCalledWith(
      'Input.dispatchKeyEvent',
      expect.objectContaining({ type: 'keyDown', key: 'Escape' })
    )
    expect(harness.sendCommand).not.toHaveBeenCalledWith('Input.dispatchMouseEvent', expect.anything())
  })

  it('types only into a verified editable text target and never clicks it', async () => {
    const harness = fakeHarness({
      role: 'textbox',
      name: 'Search',
      localName: 'input',
      nodeName: 'INPUT',
      attributes: ['type', 'search']
    })
    const snapshot = await openAndSnapshot(harness)
    const node = snapshot.snapshot!.nodes.find((candidate) => candidate.ref)!
    const pending = harness.manager.execute('thread-1', 'turn-1', {
      action: 'type',
      ref: node.ref!,
      expectedTarget: expectedTarget(snapshot),
      text: 'query'
    })
    await approvePending(harness)

    await expect(pending).resolves.toMatchObject({ ok: true, code: 'action_executed' })
    expect(harness.sendCommand).toHaveBeenCalledWith('Input.insertText', { text: 'query' })
    expect(harness.sendCommand).not.toHaveBeenCalledWith('Input.dispatchMouseEvent', expect.anything())
  })

  it('rejects type when the live DOM target is not editable', async () => {
    const harness = fakeHarness({
      role: 'button',
      name: 'Expand',
      localName: 'button',
      nodeName: 'BUTTON',
      attributes: ['type', 'button']
    })
    harness.rejectEditableFocus()
    const snapshot = await openAndSnapshot(harness)
    const node = snapshot.snapshot!.nodes.find((candidate) => candidate.ref)!
    const pending = harness.manager.execute('thread-1', 'turn-1', {
      action: 'type',
      ref: node.ref!,
      expectedTarget: expectedTarget(snapshot),
      text: 'must-not-type'
    })
    await approvePending(harness)

    await expect(pending).resolves.toMatchObject({ ok: false, code: 'action_failed' })
    expect(harness.sendCommand).not.toHaveBeenCalledWith('Input.insertText', expect.anything())
    expect(harness.sendCommand).not.toHaveBeenCalledWith('Input.dispatchMouseEvent', expect.anything())
  })
})
