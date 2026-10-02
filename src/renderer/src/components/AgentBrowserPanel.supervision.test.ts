import { createElement } from 'react'
import { act, create, type ReactTestInstance, type ReactTestRenderer } from 'react-test-renderer'
import { afterEach, expect, it, vi } from 'vitest'
import type { BrowserWindow } from 'electron'
import type { KunBrowserUseSettingsV1 } from '@shared/app-settings'
import type { BrowserUseMountInput, BrowserUseViewState } from '@shared/browser-use'
import { BrowserUseManager } from '../../../main/browser-use/browser-use-manager'
import { AgentBrowserPanel } from './AgentBrowserPanel'
import i18n from '../i18n'

vi.mock('electron', () => ({ BrowserWindow: class {}, WebContentsView: class {} }))

const settings: KunBrowserUseSettingsV1 = {
  enabled: true, mode: 'public', approvalMode: 'always-ask', maxTabs: 2,
  maxObservationActionsPerTurn: 30, maxInteractionActionsPerTurn: 12,
  maxSnapshotNodes: 250, maxSnapshotTextChars: 20_000, maxImageDimension: 1280, idleTimeoutMs: 300_000
}

class SupervisionManager extends BrowserUseManager {
  requestFirstOrigin(): Promise<boolean> {
    const entry = this.createSession('thread-1', settings)
    entry.activeTurnId = 'turn-1'
    return this.ensureOriginGrant(entry, 'https://example.com', 'https://example.com/', undefined, new AbortController().signal)
  }
}

let renderer: ReactTestRenderer | undefined
let manager: SupervisionManager | undefined

afterEach(async () => {
  await act(async () => renderer?.unmount())
  await manager?.disposeAll()
  renderer = undefined
  manager = undefined
  vi.useRealTimers()
  vi.unstubAllGlobals()
})

function text(node: ReactTestInstance): string {
  return node.children.map((child) => typeof child === 'string' ? child : text(child)).join('')
}

it('completes the real first-origin supervision handshake before any browser tab exists', async () => {
  await i18n.changeLanguage('en')
  vi.useFakeTimers()
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)
  const handlers = new Set<(next: BrowserUseViewState) => void>()
  const observed: BrowserUseViewState[] = []
  manager = new SupervisionManager({ settings: () => settings, onState: (next) => {
    observed.push(next)
    handlers.forEach((handler) => handler(next))
  } })
  const currentManager = manager
  const window = {
    contentView: { children: [], addChildView: vi.fn(), removeChildView: vi.fn() },
    getContentBounds: () => ({ x: 0, y: 0, width: 800, height: 600 }),
    isDestroyed: () => false,
    webContents: { getZoomFactor: () => 1, isDestroyed: () => false, send: vi.fn() }
  } as unknown as BrowserWindow
  const mountBrowserUse = vi.fn(async (input: BrowserUseMountInput) => currentManager.mount(
    input.threadId, window, input.bounds, input.visible, input.supervisionActive, input.expectedTurnId
  ))
  vi.stubGlobal('window', {
    kunGui: {
      getBrowserUseState: async (threadId: string, turnId?: string) => currentManager.stateForThread(threadId, turnId),
      onBrowserUseState: (handler: (next: BrowserUseViewState) => void) => {
        handlers.add(handler)
        return () => handlers.delete(handler)
      },
      mountBrowserUse,
      decideBrowserUseOrigin: async (input: Parameters<BrowserUseManager['decideOrigin']>[0]) => currentManager.decideOrigin(input)
    },
    addEventListener: vi.fn(), removeEventListener: vi.fn()
  })
  vi.stubGlobal('ResizeObserver', class { observe() {} disconnect() {} })
  await act(async () => {
    renderer = create(createElement(AgentBrowserPanel, { threadId: 'thread-1', expectedTurnId: 'turn-1', active: true }), {
      createNodeMock: () => ({ getBoundingClientRect: () => ({ x: 0, y: 0, width: 500, height: 300 }) })
    })
  })
  let result: boolean | Error | undefined
  await act(async () => {
    void currentManager.requestFirstOrigin().then((value) => { result = value }).catch((error: Error) => { result = error })
  })
  // No timers advanced: an empty host must satisfy Main's mount waiter now.
  expect(observed.some((next) => next.lifecycle === 'mount-required' && next.tabs.length === 0)).toBe(true)
  expect(mountBrowserUse).toHaveBeenCalledWith(expect.objectContaining({ visible: true, supervisionActive: true }))
  expect(currentManager.stateForThread('thread-1')).toMatchObject({
    lifecycle: 'waiting-origin-consent', tabs: [], visible: false,
    pendingOriginConsent: { origin: 'https://example.com' }
  })
  expect(mountBrowserUse.mock.calls.every(([input]) => input.supervisionActive)).toBe(true)
  const allow = renderer!.root.findAllByType('button').find((button) => text(button) === 'Allow origin once')!
  await act(async () => allow.props.onClick())
  expect(result).toBe(true)
  expect(currentManager.stateForThread('thread-1')).toMatchObject({ lifecycle: 'ready', tabs: [] })
  expect(currentManager.stateForThread('thread-1').pendingOriginConsent).toBeUndefined()
})
