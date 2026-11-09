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
  let targetDisabled = false
  let currentTarget = {
    role: 'button',
    name: 'Expand',
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
          properties: [
            { name: 'focusable', value: { value: true } },
            { name: 'disabled', value: { value: targetDisabled } }
          ]
        }]
      }
    }
    if (method === 'Accessibility.getPartialAXTree') {
      return {
        nodes: [{
          backendDOMNodeId: 7,
          role: { value: currentTarget.role },
          name: { value: currentTarget.name },
          properties: [{ name: 'disabled', value: { value: targetDisabled } }]
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
  let resolveLoad: (() => void) | undefined
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
    setDisabled: (disabled: boolean) => {
      targetDisabled = disabled
    },
    emitWebContents: (event: string, ...args: unknown[]) => {
      for (const listener of listeners.get(event) ?? []) listener(...args)
    },
    emitDebugger: (method: string) => {
      for (const listener of debuggerListeners.get('message') ?? []) listener({}, method)
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

  it('redacts secret-like values from page titles before publishing state', async () => {
    const harness = fakeHarness({ approvalMode: 'always-ask' })
    harness.setTitle('Dashboard token=top-secret api_live_1234567890')
    await openAuthorized(harness)

    const title = harness.manager.stateForThread('thread-1').tabs[0]?.title
    expect(title).toBe('Dashboard token=[redacted] [redacted]')
    expect(JSON.stringify(harness.states)).not.toContain('top-secret')
    expect(JSON.stringify(harness.states)).not.toContain('1234567890')
  })

  it('returns opaque refs and never bypasses target-specific allow-once consent', async () => {
    const harness = fakeHarness({ approvalMode: 'always-ask' })
    await openAuthorized(harness)
    const snapshot = await harness.manager.execute('thread-1', 'turn-1', { action: 'snapshot' })
    const ref = snapshot.snapshot?.nodes[0]?.ref
    expect(ref).toBeTruthy()
    expect(ref).not.toContain('button')

    const pending = harness.manager.execute(
      'thread-1',
      'turn-1',
      clickAction(snapshot)
    )
    await vi.waitFor(() => {
      expect(harness.manager.stateForThread('thread-1').pendingActionConsent).toBeTruthy()
    })
    const request = harness.manager.stateForThread('thread-1').pendingActionConsent!
    harness.manager.decideAction({
      threadId: 'thread-1',
      requestId: request.id,
      decision: 'deny'
    })

    await expect(pending).resolves.toMatchObject({ ok: false, code: 'consent_denied' })
    expect(harness.sendCommand).not.toHaveBeenCalledWith(
      'Input.dispatchMouseEvent',
      expect.anything()
    )
    expect(() => harness.manager.decideAction({
      threadId: 'thread-1',
      requestId: request.id,
      decision: 'allow-once'
    })).toThrow('stale')
    expect(JSON.stringify(harness.manager.auditSnapshot())).not.toContain('Continue')
  })

  it('auto-executes a validated low-risk public interaction without a consent prompt', async () => {
    const harness = fakeHarness()
    await expect(harness.manager.execute(
      'thread-1',
      'turn-1',
      { action: 'open', url: 'https://example.com/start' }
    )).resolves.toMatchObject({ ok: true, code: 'opened' })
    const snapshot = await harness.manager.execute('thread-1', 'turn-1', { action: 'snapshot' })

    await expect(harness.manager.execute(
      'thread-1',
      'turn-1',
      clickAction(snapshot)
    )).resolves.toMatchObject({ ok: true, code: 'action_executed' })

    expect(harness.manager.stateForThread('thread-1').pendingActionConsent).toBeUndefined()
    expect(harness.sendCommand).toHaveBeenCalledWith(
      'Input.dispatchMouseEvent',
      expect.objectContaining({ type: 'mousePressed' })
    )
    expect(harness.manager.auditSnapshot()).toContainEqual(expect.objectContaining({
      category: 'action-consent',
      action: 'auto-click',
      decision: 'allowed',
      outcome: 'success'
    }))
  })

  it('keeps public page refs usable when the floating preview is closed', async () => {
    const harness = fakeHarness()
    await openAuthorized(harness)
    const snapshot = await harness.manager.execute('thread-1', 'turn-1', { action: 'snapshot' })

    harness.manager.mount(
      'thread-1',
      harness.window as never,
      { x: 10, y: 10, width: 420, height: 640 },
      false,
      false
    )

    expect(harness.manager.stateForThread('thread-1')).toMatchObject({
      visible: false,
      mounted: true,
      controlOwner: 'agent'
    })
    await expect(harness.manager.execute(
      'thread-1',
      'turn-1',
      clickAction(snapshot)
    )).resolves.toMatchObject({ ok: true, code: 'action_executed' })
  })

  it('keeps an unchanged ref across an unrelated DOM mutation and live-revalidates it', async () => {
    const harness = fakeHarness()
    await openAuthorized(harness)
    const snapshot = await harness.manager.execute('thread-1', 'turn-1', { action: 'snapshot' })
    harness.emitDebugger('DOM.childNodeInserted')

    await expect(harness.manager.execute(
      'thread-1',
      'turn-1',
      clickAction(snapshot)
    )).resolves.toMatchObject({ ok: true, code: 'action_executed' })
    expect(harness.sendCommand).toHaveBeenCalledWith('Accessibility.getPartialAXTree', expect.anything())
  })

  it('aborts pending navigation on Stop and suppresses a late success', async () => {
    const harness = fakeHarness()
    harness.holdNextLoad()
    const pending = harness.manager.execute(
      'thread-1',
      'turn-1',
      { action: 'open', url: 'https://example.com/slow' }
    )
    await vi.waitFor(() => expect(harness.webContents.loadURL).toHaveBeenCalled())
    harness.manager.stop('thread-1')
    harness.finishLoad()

    await expect(pending).resolves.toMatchObject({ ok: false, code: 'aborted' })
    expect(harness.webContents.stop).toHaveBeenCalled()
  })

  it('never auto-executes a transaction commit target', async () => {
    const harness = fakeHarness()
    harness.setTarget({
      role: 'button',
      name: 'Place order',
      localName: 'button',
      nodeName: 'BUTTON',
      attributes: ['type', 'button']
    })
    await openAuthorized(harness)
    const snapshot = await harness.manager.execute('thread-1', 'turn-1', { action: 'snapshot' })

    await expect(harness.manager.execute(
      'thread-1',
      'turn-1',
      clickAction(snapshot)
    )).resolves.toMatchObject({
      ok: false,
      code: 'manual_interaction_required'
    })
    expect(harness.manager.stateForThread('thread-1').pendingActionConsent).toBeUndefined()
    expect(harness.sendCommand).not.toHaveBeenCalledWith(
      'Input.dispatchMouseEvent',
      expect.anything()
    )
  })

  it('rejects a target that becomes disabled after the snapshot', async () => {
    const harness = fakeHarness()
    await openAuthorized(harness)
    const snapshot = await harness.manager.execute('thread-1', 'turn-1', { action: 'snapshot' })
    harness.setDisabled(true)

    await expect(harness.manager.execute(
      'thread-1',
      'turn-1',
      clickAction(snapshot)
    )).resolves.toMatchObject({ ok: false, code: 'stale_reference' })
    expect(harness.sendCommand).not.toHaveBeenCalledWith(
      'Input.dispatchMouseEvent',
      expect.anything()
    )
  })

  it('reports select failure when the page does not accept the requested option', async () => {
    const harness = fakeHarness({ approvalMode: 'always-ask' })
    const fallbackSendCommand = harness.sendCommand.getMockImplementation()!
    harness.sendCommand.mockImplementation(async (method: string, ...args: unknown[]) => {
      if (
        method === 'Runtime.callFunctionOn' &&
        typeof (args[0] as { functionDeclaration?: unknown } | undefined)?.functionDeclaration === 'string' &&
        String((args[0] as { functionDeclaration: string }).functionDeclaration)
          .includes('HTMLSelectElement')
      ) {
        return { result: { value: false } }
      }
      return fallbackSendCommand(method)
    })
    harness.setTarget({
      role: 'combobox',
      name: 'Sort order',
      localName: 'select',
      nodeName: 'SELECT',
      attributes: []
    })
    await openAuthorized(harness)
    const snapshot = await harness.manager.execute('thread-1', 'turn-1', { action: 'snapshot' })
    const expected = expectedTarget(snapshot)
    const ref = snapshot.snapshot!.nodes.find((candidate) => candidate.ref)!.ref!
    const pending = harness.manager.execute('thread-1', 'turn-1', {
      action: 'select',
      ref,
      expectedTarget: expected,
      value: 'newest'
    })
    await vi.waitFor(() => {
      expect(harness.manager.stateForThread('thread-1').pendingActionConsent).toBeTruthy()
    })
    const request = harness.manager.stateForThread('thread-1').pendingActionConsent!
    harness.manager.decideAction({
      threadId: 'thread-1',
      requestId: request.id,
      decision: 'allow-once'
    })

    await expect(pending).resolves.toMatchObject({ ok: false, code: 'action_failed' })
  })

  it('does not let a Kun grant bypass live target fingerprint validation', async () => {
    const harness = fakeHarness({ approvalMode: 'always-ask' })
    await openAuthorized(harness, 'https://example.com/start')
    const snapshot = await harness.manager.execute(
      'thread-1',
      'turn-1',
      { action: 'snapshot' }
    )
    const click = clickAction(snapshot)
    harness.setBox([20, 20, 120, 20, 120, 60, 20, 60])

    await expect(harness.manager.execute(
      'thread-1',
      'turn-1',
      click,
      undefined,
      kunApprovalGrant(click),
      'agent'
    )).resolves.toMatchObject({ ok: false, code: 'stale_reference' })
    expect(harness.manager.stateForThread('thread-1').pendingActionConsent).toBeUndefined()
    expect(harness.sendCommand).not.toHaveBeenCalledWith(
      'Input.dispatchMouseEvent',
      expect.anything()
    )
  })

  it.each([
    ['sessionId', 'different-session-1234567890'],
    ['tabId', 'different-tab'],
    ['documentGeneration', 99],
    ['origin', 'https://other.example'],
    ['sanitizedUrl', 'https://example.com/other-path'],
    ['role', 'link'],
    ['name', 'Different target']
  ] as const)('rejects a reviewer-visible expectedTarget %s substitution', async (field, value) => {
    const harness = fakeHarness({ approvalMode: 'always-ask' })
    await openAuthorized(harness, 'https://example.com/start')
    const snapshot = await harness.manager.execute(
      'thread-1',
      'turn-1',
      { action: 'snapshot' }
    )
    const click = clickAction(snapshot)
    const substituted = {
      ...click,
      expectedTarget: {
        ...click.expectedTarget,
        [field]: value
      }
    }

    await expect(harness.manager.execute(
      'thread-1',
      'turn-1',
      substituted,
      undefined,
      kunApprovalGrant(substituted),
      'agent'
    )).resolves.toMatchObject({
      ok: false,
      code: 'target_binding_mismatch'
    })
    expect(harness.sendCommand).not.toHaveBeenCalledWith(
      'Input.dispatchMouseEvent',
      expect.anything()
    )
  })

  it.each([
    {
      role: 'textbox',
      name: 'Password',
      localName: 'input',
      nodeName: 'INPUT',
      attributes: ['type', 'password']
    },
    {
      role: 'textbox',
      name: 'Enter CAPTCHA',
      localName: 'input',
      nodeName: 'INPUT',
      attributes: ['type', 'text', 'aria-label', 'Human verification CAPTCHA']
    },
    {
      role: 'textbox',
      name: 'Email',
      localName: 'input',
      nodeName: 'INPUT',
      attributes: ['type', 'email', 'autocomplete', 'username']
    }
  ])('never issues an actionable ref for sensitive targets %#', async (target) => {
    const harness = fakeHarness()
    harness.setTarget(target)
    await openAuthorized(harness)
    const snapshot = await harness.manager.execute('thread-1', 'turn-1', { action: 'snapshot' })
    expect(snapshot.snapshot?.nodes[0]).toMatchObject({ sensitive: true })
    expect(snapshot.snapshot?.nodes[0]?.ref).toBeUndefined()
    expect(snapshot.snapshot?.nodes[0]?.value).toBeUndefined()
  })

  it('rejects a live geometry mutation after consent instead of replaying the click', async () => {
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
    harness.setBox([20, 20, 120, 20, 120, 60, 20, 60])
    const request = harness.manager.stateForThread('thread-1').pendingActionConsent!
    harness.manager.decideAction({
      threadId: 'thread-1',
      requestId: request.id,
      decision: 'allow-once'
    })

    await expect(pending).resolves.toMatchObject({ ok: false, code: 'target_changed' })
    expect(harness.sendCommand).not.toHaveBeenCalledWith(
      'Input.dispatchMouseEvent',
      expect.anything()
    )
  })

  it.each([
    ['same-origin path', async (harness: ReturnType<typeof fakeHarness>) => {
      await harness.webContents.loadURL('https://example.com/changed-after-consent')
    }],
    ['target name', async (harness: ReturnType<typeof fakeHarness>) => {
      harness.setTarget({
        role: 'button',
        name: 'Delete account',
        localName: 'button',
        nodeName: 'BUTTON',
        attributes: ['type', 'button']
      })
    }]
  ] as const)(
    'rechecks the reviewer-visible %s after Main consent before sending input',
    async (_case, mutate) => {
      const harness = fakeHarness({ approvalMode: 'always-ask' })
      await openAuthorized(harness)
      const snapshot = await harness.manager.execute(
        'thread-1',
        'turn-1',
        { action: 'snapshot' }
      )
      const pending = harness.manager.execute(
        'thread-1',
        'turn-1',
        clickAction(snapshot)
      )
      await vi.waitFor(() => {
        expect(harness.manager.stateForThread('thread-1').pendingActionConsent).toBeTruthy()
      })
      await mutate(harness)
      const request = harness.manager.stateForThread('thread-1').pendingActionConsent!
      harness.manager.decideAction({
        threadId: 'thread-1',
        requestId: request.id,
        decision: 'allow-once'
      })

      await expect(pending).resolves.toMatchObject({
        ok: false,
        code: 'target_binding_mismatch'
      })
      expect(harness.sendCommand).not.toHaveBeenCalledWith(
        'Input.dispatchMouseEvent',
        expect.anything()
      )
      expect(harness.sendCommand).not.toHaveBeenCalledWith(
        'Input.insertText',
        expect.anything()
      )
    }
  )

})
