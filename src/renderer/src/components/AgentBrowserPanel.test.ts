import { createElement } from 'react'
import { act, create, type ReactTestInstance, type ReactTestRenderer } from 'react-test-renderer'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { BrowserUseViewState } from '@shared/browser-use'
import i18n from '../i18n'
import { AgentBrowserPanel } from './AgentBrowserPanel'

function textContent(node: ReactTestInstance): string {
  return node.children.map((child) => typeof child === 'string' ? child : textContent(child)).join('')
}

function state(overrides: Partial<BrowserUseViewState> = {}): BrowserUseViewState {
  return {
    contractVersion: 1,
    capabilityStatus: 'available',
    sessionId: 'session-1234567890',
    threadId: 'thread-1',
    lifecycle: 'ready',
    controlOwner: 'agent',
    visible: false,
    mounted: false,
    mode: 'public',
    tabs: [{
      id: 'tab-1',
      title: 'Example',
      origin: 'https://example.com',
      sanitizedUrl: 'https://example.com/page',
      active: true,
      loading: false,
      canGoBack: false,
      canGoForward: false
    }],
    activeTabId: 'tab-1',
    budget: { observationRemaining: 4, interactionRemaining: 2 },
    updatedAt: '2026-07-26T00:00:00.000Z',
    ...overrides
  }
}

function buttonByText(renderer: ReactTestRenderer, text: string): ReactTestInstance {
  return renderer.root.findAllByType('button').find((button) => textContent(button) === text)!
}

describe('AgentBrowserPanel supervision', () => {
  beforeEach(async () => {
    await i18n.changeLanguage('en')
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('sends an exact target-specific allow-once decision and never offers a permanent grant', async () => {
    const pending = state({
      lifecycle: 'waiting-action-consent',
      pendingActionConsent: {
        id: 'decision-12345678',
        sessionId: 'session-1234567890',
        threadId: 'thread-1',
        tabId: 'tab-1',
        origin: 'https://example.com',
        pageTitle: 'Example',
        action: 'click',
        risk: 'interaction',
        targetRole: 'button',
        targetName: 'Publish',
        targetRect: { x: 10, y: 20, width: 80, height: 24 },
        expiresAt: '2026-07-26T00:01:00.000Z'
      }
    })
    const decideBrowserUseAction = vi.fn(async () => state())
    let publish: ((next: BrowserUseViewState) => void) | undefined
    vi.stubGlobal('window', {
      kunGui: {
        getBrowserUseState: vi.fn(async () => pending),
        onBrowserUseState: vi.fn((handler: (next: BrowserUseViewState) => void) => {
          publish = handler
          return vi.fn()
        }),
        mountBrowserUse: vi.fn(async () => state()),
        decideBrowserUseAction,
        decideBrowserUseOrigin: vi.fn(),
        navigateBrowserUse: vi.fn(),
        setBrowserUseControl: vi.fn(),
        stopBrowserUse: vi.fn(),
        clearBrowserUse: vi.fn()
      },
      addEventListener: vi.fn(),
      removeEventListener: vi.fn()
    })

    let renderer!: ReactTestRenderer
    await act(async () => {
      renderer = create(createElement(AgentBrowserPanel, {
        threadId: 'thread-1',
        active: true
      }))
    })

    expect(textContent(renderer.root)).toContain('Publish')
    expect(textContent(renderer.root)).not.toMatch(/always|permanent/i)
    await act(async () => {
      buttonByText(renderer, 'Allow once').props.onClick()
    })
    expect(decideBrowserUseAction).toHaveBeenCalledWith({
      threadId: 'thread-1',
      requestId: 'decision-12345678',
      decision: 'allow-once'
    })

    act(() => publish?.(state({ threadId: 'thread-2' })))
    expect(textContent(renderer.root)).toContain('Example')
  })

  it('supports manual takeover, stop, and destructive session clearing for the owning thread', async () => {
    const setBrowserUseControl = vi.fn(async () => state({ controlOwner: 'manual' }))
    const stopBrowserUse = vi.fn(async () => state({ lifecycle: 'stopped' }))
    const clearBrowserUse = vi.fn(async () => state({
      sessionId: undefined,
      lifecycle: 'closed',
      tabs: []
    }))
    vi.stubGlobal('window', {
      kunGui: {
        getBrowserUseState: vi.fn(async () => state()),
        onBrowserUseState: vi.fn(() => vi.fn()),
        mountBrowserUse: vi.fn(async () => state()),
        decideBrowserUseAction: vi.fn(),
        decideBrowserUseOrigin: vi.fn(),
        navigateBrowserUse: vi.fn(),
        setBrowserUseControl,
        stopBrowserUse,
        clearBrowserUse
      },
      addEventListener: vi.fn(),
      removeEventListener: vi.fn()
    })

    let renderer!: ReactTestRenderer
    await act(async () => {
      renderer = create(createElement(AgentBrowserPanel, {
        threadId: 'thread-1',
        active: true
      }))
    })
    await act(async () => buttonByText(renderer, 'Take control').props.onClick())
    expect(setBrowserUseControl).toHaveBeenCalledWith({
      threadId: 'thread-1',
      controlOwner: 'manual'
    })
    await act(async () => buttonByText(renderer, 'Stop').props.onClick())
    expect(stopBrowserUse).toHaveBeenCalledWith('thread-1')
    const clear = renderer.root.findByProps({ 'aria-label': 'Clear session' })
    await act(async () => clear.props.onClick())
    expect(clearBrowserUse).toHaveBeenCalledWith('thread-1')
  })

  it.each([
    ['loading', undefined, 'Starting secure browser', 'Applying network safeguards'],
    ['error', 'Policy proxy configuration timed out.', 'Browser failed to start', 'Policy proxy configuration timed out.']
  ] as const)('renders an explicit no-tab %s state in the browser surface', async (lifecycle, reason, title, body) => {
    const next = state({ lifecycle, reason, tabs: [], activeTabId: undefined })
    vi.stubGlobal('window', {
      kunGui: {
        getBrowserUseState: vi.fn(async () => next),
        onBrowserUseState: vi.fn(() => vi.fn()),
        mountBrowserUse: vi.fn(async () => next),
        decideBrowserUseAction: vi.fn(), decideBrowserUseOrigin: vi.fn(),
        navigateBrowserUse: vi.fn(), setBrowserUseControl: vi.fn(),
        stopBrowserUse: vi.fn(), clearBrowserUse: vi.fn(async () => next)
      },
      addEventListener: vi.fn(), removeEventListener: vi.fn()
    })
    let renderer!: ReactTestRenderer
    await act(async () => {
      renderer = create(createElement(AgentBrowserPanel, { threadId: 'thread-1', active: true }))
    })
    expect(textContent(renderer.root)).toContain(title)
    expect(textContent(renderer.root)).toContain(body)
  })

  it('uses a webpage-first surface without permanent toolbars in picture-in-picture mode', async () => {
    vi.stubGlobal('window', {
      kunGui: {
        getBrowserUseState: vi.fn(async () => state()),
        onBrowserUseState: vi.fn(() => vi.fn()),
        mountBrowserUse: vi.fn(async () => state()),
        decideBrowserUseAction: vi.fn(),
        decideBrowserUseOrigin: vi.fn(),
        navigateBrowserUse: vi.fn(),
        setBrowserUseControl: vi.fn(),
        stopBrowserUse: vi.fn(),
        clearBrowserUse: vi.fn()
      },
      addEventListener: vi.fn(),
      removeEventListener: vi.fn()
    })

    let renderer!: ReactTestRenderer
    await act(async () => {
      renderer = create(createElement(AgentBrowserPanel, {
        threadId: 'thread-1',
        active: true,
        variant: 'pip'
      }))
    })

    expect(renderer.root.findByProps({
      'data-browser-use-variant': 'pip'
    })).toBeTruthy()
    expect(renderer.root.findAllByProps({ 'aria-label': 'Back' })).toHaveLength(0)
    expect(renderer.root.findAllByProps({ 'aria-label': 'Clear session' })).toHaveLength(0)
    expect(textContent(renderer.root)).not.toContain('Public web')
    expect(textContent(renderer.root)).not.toContain('Example')
  })
})
