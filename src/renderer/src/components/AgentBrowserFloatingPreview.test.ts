import { createElement } from 'react'
import { act, create, type ReactTestRenderer } from 'react-test-renderer'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { BrowserUseViewState } from '@shared/browser-use'
import i18n from '../i18n'
import { AgentBrowserFloatingPreview } from './AgentBrowserFloatingPreview'
import { AgentBrowserPanel } from './AgentBrowserPanel'
import { useAgentBrowserPreviewStore } from './agent-browser-preview-state'

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
      sanitizedUrl: 'https://example.com',
      active: true,
      loading: false,
      canGoBack: false,
      canGoForward: false
    }],
    activeTabId: 'tab-1',
    updatedAt: '2026-07-26T00:00:00.000Z',
    ...overrides
  }
}

function setup(initial = state()) {
  const handlers = new Set<(next: BrowserUseViewState) => void>()
  const retired: Array<(next: BrowserUseViewState) => void> = []
  const snapshots = new Map([[initial.threadId, initial]])
  const api = {
    getBrowserUseState: vi.fn(async (threadId: string) => snapshots.get(threadId) ?? state({ threadId })),
    onBrowserUseState: vi.fn((handler: (next: BrowserUseViewState) => void) => {
      handlers.add(handler)
      retired.push(handler)
      return () => handlers.delete(handler)
    }),
    mountBrowserUse: vi.fn(async () => state()),
    decideBrowserUseAction: vi.fn(), decideBrowserUseOrigin: vi.fn(), navigateBrowserUse: vi.fn(),
    setBrowserUseControl: vi.fn(async () => state({ controlOwner: 'manual' })),
    stopBrowserUse: vi.fn(), clearBrowserUse: vi.fn()
  }
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)
  vi.stubGlobal('window', { kunGui: api, addEventListener: vi.fn(), removeEventListener: vi.fn() })
  return {
    api, retired,
    publish: (next: BrowserUseViewState) => {
      snapshots.set(next.threadId, next)
      handlers.forEach((handler) => handler(next))
    }
  }
}

const renderers: ReactTestRenderer[] = []
async function renderPreview(activeThreadId: string | null = 'thread-1') {
  let renderer!: ReactTestRenderer
  await act(async () => { renderer = create(createElement(AgentBrowserFloatingPreview, { activeThreadId }), { createNodeMock }) })
  renderers.push(renderer)
  return renderer
}

function createNodeMock() {
  return { getBoundingClientRect: () => ({ x: 0, y: 0, width: 900, height: 600 }) }
}

function showTools(renderer: ReactTestRenderer) {
  return act(async () => renderer.root.findByProps({ 'aria-label': 'Move browser preview' }).props.onFocus())
}

async function collapse(renderer: ReactTestRenderer) {
  await showTools(renderer)
  return act(async () => renderer.root.findByProps({
    'aria-label': 'Close preview and keep safe work running in the background'
  }).props.onClick())
}

describe('AgentBrowserFloatingPreview', () => {
  beforeEach(async () => {
    useAgentBrowserPreviewStore.setState({ byThreadId: {} })
    vi.stubGlobal('ResizeObserver', class { observe() {} disconnect() {} })
    await i18n.changeLanguage('en')
  })

  afterEach(async () => {
    await act(async () => { for (const renderer of renderers.splice(0)) renderer.unmount() })
    vi.unstubAllGlobals()
  })

  it('automatically floats an agent browser, can be collapsed, and does not clear the session', async () => {
    const clearBrowserUse = vi.fn()
    const setBrowserUseControl = vi.fn(async () => state({ controlOwner: 'manual' }))
    vi.stubGlobal('window', {
      kunGui: {
        getBrowserUseState: vi.fn(async () => state()),
        onBrowserUseState: vi.fn(() => vi.fn()),
        mountBrowserUse: vi.fn(async () => state()),
        decideBrowserUseAction: vi.fn(),
        decideBrowserUseOrigin: vi.fn(),
        navigateBrowserUse: vi.fn(),
        setBrowserUseControl,
        stopBrowserUse: vi.fn(),
        clearBrowserUse
      },
      addEventListener: vi.fn(),
      removeEventListener: vi.fn()
    })

    let renderer!: ReactTestRenderer
    await act(async () => {
      renderer = create(createElement(AgentBrowserFloatingPreview, {
        activeThreadId: 'thread-1'
      }), { createNodeMock })
    })
    renderers.push(renderer)

    const preview = renderer.root.findByProps({ 'aria-label': 'Agent Browser' })
    expect(preview).toBeTruthy()
    expect(renderer.root.findByProps({
      'data-browser-use-variant': 'pip'
    })).toBeTruthy()
    await showTools(renderer)
    const takeControl = renderer.root.findByProps({ 'aria-label': 'Take control' })
    await act(async () => takeControl.props.onClick())
    expect(setBrowserUseControl).toHaveBeenCalledWith({
      threadId: 'thread-1',
      controlOwner: 'manual'
    })
    const close = renderer.root.findByProps({
      'aria-label': 'Close preview and keep safe work running in the background'
    })
    await act(async () => close.props.onClick())
    expect(renderer.root.findByProps({ 'aria-label': 'Show Agent Browser' })).toBeTruthy()
    expect(clearBrowserUse).not.toHaveBeenCalled()
  })

  it('opens automatically when Main requests a visible approval surface', async () => {
    let publish: ((next: BrowserUseViewState) => void) | undefined
    vi.stubGlobal('window', {
      kunGui: {
        getBrowserUseState: vi.fn(async () => state()),
        onBrowserUseState: vi.fn((handler: (next: BrowserUseViewState) => void) => {
          publish = handler
          return vi.fn()
        }),
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
      renderer = create(createElement(AgentBrowserFloatingPreview, {
        activeThreadId: 'thread-1'
      }), { createNodeMock })
    })
    renderers.push(renderer)
    act(() => publish?.(state({ lifecycle: 'mount-required' })))

    expect(renderer.root.findByProps({ 'aria-label': 'Agent Browser' })).toBeTruthy()
    expect(renderer.root.findAllByProps({ 'aria-label': 'Show Agent Browser' })).toHaveLength(0)
    await showTools(renderer)
    await act(async () => renderer.root.findByProps({ 'aria-label': 'More browser actions' }).props.onClick())
    expect(renderer.root.findByProps({ 'aria-label': 'Stop' })).toBeTruthy()
    expect(renderer.root.findByProps({ 'aria-label': 'Clear session' })).toBeTruthy()
  })

  it('reveals the first page and each new agent turn once, while respecting a collapsed preview', async () => {
    const fixture = setup(state({ turnId: 'turn-1', tabs: [], activeTabId: undefined }))
    const renderer = await renderPreview()
    expect(renderer.root.findByProps({ 'aria-label': 'Show Agent Browser' })).toBeTruthy()
    await act(async () => fixture.publish(state({ turnId: 'turn-1', lifecycle: 'loading' })))
    expect(renderer.root.findByProps({ 'aria-label': 'Agent Browser' })).toBeTruthy()
    await collapse(renderer)
    await act(async () => fixture.publish(state({ turnId: 'turn-1', visible: false })))
    expect(renderer.root.findByProps({ 'aria-label': 'Show Agent Browser' })).toBeTruthy()
    await act(async () => fixture.publish(state({ turnId: 'turn-2' })))
    expect(renderer.root.findByProps({ 'aria-label': 'Agent Browser' })).toBeTruthy()
    await collapse(renderer)
    await act(async () => fixture.publish(state({ turnId: 'turn-2', lifecycle: 'mount-required' })))
    expect(renderer.root.findByProps({ 'aria-label': 'Agent Browser' })).toBeTruthy()
  })

  it.each([
    { controlOwner: 'manual', lifecycle: 'manual-control' },
    { controlOwner: 'agent', lifecycle: 'stopped' },
    { controlOwner: 'agent', lifecycle: 'error' }
  ] as const)('keeps an existing $lifecycle browser collapsed on entry', async (overrides) => {
    setup(state(overrides))
    const renderer = await renderPreview()
    expect(renderer.root.findByProps({ 'aria-label': 'Show Agent Browser' })).toBeTruthy()
    expect(renderer.root.findAllByType(AgentBrowserPanel)).toHaveLength(0)
  })

  it('keeps collapse choices through conversation switches and remounts, ignoring retired callbacks', async () => {
    const fixture = setup()
    const renderer = await renderPreview()
    await collapse(renderer)
    const oldCallbacks = [...fixture.retired]
    await act(async () => renderer.update(createElement(AgentBrowserFloatingPreview, { activeThreadId: 'thread-2' })))
    await act(async () => { for (const callback of oldCallbacks) callback(state()) })
    expect(renderer.root.findByType(AgentBrowserPanel).props.threadId).toBe('thread-2')
    await act(async () => fixture.publish(state()))
    expect(renderer.root.findByType(AgentBrowserPanel).props.threadId).toBe('thread-2')
    await act(async () => renderer.update(createElement(AgentBrowserFloatingPreview, { activeThreadId: null })))
    expect(renderer.toJSON()).toBeNull()
    await act(async () => renderer.update(createElement(AgentBrowserFloatingPreview, { activeThreadId: 'thread-1' })))
    expect(renderer.root.findByProps({ 'aria-label': 'Show Agent Browser' })).toBeTruthy()
    await act(async () => renderer.unmount())
    const reopened = await renderPreview()
    expect(reopened.root.findByProps({ 'aria-label': 'Show Agent Browser' })).toBeTruthy()
  })

  it('ignores a late control reply after switching conversations', async () => {
    const fixture = setup()
    let resolve!: (next: BrowserUseViewState) => void
    fixture.api.setBrowserUseControl.mockReturnValueOnce(new Promise((accept) => { resolve = accept }))
    const renderer = await renderPreview()
    await showTools(renderer)
    const takeControl = renderer.root.findByProps({ 'aria-label': 'Take control' }).props.onClick
    await act(async () => takeControl())
    await act(async () => renderer.update(createElement(AgentBrowserFloatingPreview, { activeThreadId: 'thread-2' })))
    await act(async () => resolve(state({ controlOwner: 'manual' })))
    expect(renderer.root.findByType(AgentBrowserPanel).props.threadId).toBe('thread-2')
    fixture.api.setBrowserUseControl.mockClear()
    await act(async () => takeControl())
    expect(fixture.api.setBrowserUseControl).not.toHaveBeenCalled()
  })

  it('keeps a live browser event when the initial snapshot arrives late', async () => {
    const fixture = setup()
    let resolve!: (next: BrowserUseViewState) => void
    fixture.api.getBrowserUseState.mockReturnValueOnce(new Promise((accept) => { resolve = accept }))
    const renderer = await renderPreview()
    await act(async () => fixture.publish(state()))
    await act(async () => resolve(state({ sessionId: undefined, lifecycle: 'closed', tabs: [] })))
    expect(renderer.root.findByProps({ 'aria-label': 'Agent Browser' })).toBeTruthy()
    await act(async () => fixture.publish(state({ sessionId: undefined, lifecycle: 'closed', tabs: [] })))
    expect(renderer.toJSON()).toBeNull()
    await act(async () => fixture.publish(state({ sessionId: 'new-session-12345678' })))
    expect(renderer.root.findByProps({ 'aria-label': 'Agent Browser' })).toBeTruthy()
  })
})
