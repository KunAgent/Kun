import { createElement } from 'react'
import { act, create, type ReactTestInstance, type ReactTestRenderer } from 'react-test-renderer'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { BrowserUseViewState } from '@shared/browser-use'
import i18n from '../i18n'
import { AgentBrowserPanel } from './AgentBrowserPanel'

function deferred<T>() {
  let resolve!: (value: T) => void
  let reject!: (error: Error) => void
  const promise = new Promise<T>((accept, fail) => { resolve = accept; reject = fail })
  return { promise, resolve, reject }
}

function state(threadId = 'thread-1', title = 'First task', overrides: Partial<BrowserUseViewState> = {}): BrowserUseViewState {
  return {
    contractVersion: 1, capabilityStatus: 'available', sessionId: `session-${threadId}-1234567890`,
    threadId, lifecycle: 'ready', controlOwner: 'agent', visible: false, mounted: false, mode: 'public',
    tabs: [{
      id: `tab-${threadId}`, title, origin: 'https://example.com', sanitizedUrl: 'https://example.com',
      active: true, loading: false, canGoBack: true, canGoForward: true
    }], activeTabId: `tab-${threadId}`, updatedAt: '2026-07-26T00:00:00.000Z', ...overrides
  }
}

function text(node: ReactTestInstance): string {
  return node.children.map((child) => typeof child === 'string' ? child : text(child)).join('')
}

function button(renderer: ReactTestRenderer, label: string): ReactTestInstance {
  return renderer.root.findAllByType('button').find((node) => text(node) === label || node.props['aria-label'] === label)!
}

function setup() {
  const handlers = new Set<(next: BrowserUseViewState) => void>()
  const oldHandlers: Array<(next: BrowserUseViewState) => void> = []
  const api = {
    getBrowserUseState: vi.fn(async (threadId: string) => state(threadId, threadId === 'thread-1' ? 'First task' : 'Second task')),
    onBrowserUseState: vi.fn((handler: (next: BrowserUseViewState) => void) => {
      handlers.add(handler)
      oldHandlers.push(handler)
      return () => handlers.delete(handler)
    }),
    mountBrowserUse: vi.fn(async (input: { threadId: string }) => state(input.threadId)),
    navigateBrowserUse: vi.fn(async () => state()),
    setBrowserUseControl: vi.fn(async () => state('thread-1', 'First task', { controlOwner: 'manual' })),
    stopBrowserUse: vi.fn(async () => state('thread-1', 'Stopped task', { lifecycle: 'stopped' })),
    clearBrowserUse: vi.fn(async () => state('thread-1', '', { sessionId: undefined, tabs: [], lifecycle: 'closed' })),
    decideBrowserUseOrigin: vi.fn(async () => state()),
    decideBrowserUseAction: vi.fn(async () => state())
  }
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)
  vi.stubGlobal('window', { kunGui: api, addEventListener: vi.fn(), removeEventListener: vi.fn() })
  vi.stubGlobal('ResizeObserver', class {
    observe = vi.fn()
    disconnect = vi.fn()
  })
  return { api, oldHandlers, publish: (next: BrowserUseViewState) => handlers.forEach((handler) => handler(next)) }
}

const renderers: ReactTestRenderer[] = []
async function render(props: Parameters<typeof AgentBrowserPanel>[0] = { threadId: 'thread-1', active: true }) {
  let renderer!: ReactTestRenderer
  await act(async () => {
    renderer = create(createElement(AgentBrowserPanel, props), {
      createNodeMock: (node) => node.type === 'div' ? {
        getBoundingClientRect: () => ({ x: 10, y: 20, width: 640, height: 480 })
      } : null
    })
  })
  renderers.push(renderer)
  return renderer
}

beforeEach(async () => { await i18n.changeLanguage('en') })
afterEach(async () => {
  await act(async () => { for (const renderer of renderers.splice(0)) renderer.unmount() })
  vi.unstubAllGlobals()
})

describe('AgentBrowserPanel lifecycle fences', () => {
  it('keeps a newer event when the initial get resolves late, even with equal timestamps', async () => {
    const { api, publish } = setup()
    const get = deferred<BrowserUseViewState>()
    api.getBrowserUseState.mockReturnValueOnce(get.promise)
    const renderer = await render()
    await act(async () => publish(state('thread-1', 'New event')))
    await act(async () => get.resolve(state('thread-1', 'Old snapshot')))
    expect(text(renderer.root)).toContain('New event')
    expect(text(renderer.root)).not.toContain('Old snapshot')
  })

  it('ignores wrong-thread snapshots and events', async () => {
    const { api, publish } = setup()
    api.getBrowserUseState.mockResolvedValueOnce(state('thread-2', 'Wrong thread'))
    const renderer = await render()
    await act(async () => publish(state('thread-2', 'Wrong event')))
    expect(text(renderer.root)).not.toContain('Wrong')
    expect(api.mountBrowserUse).not.toHaveBeenCalled()
  })

  it('clears the old session before mounting a different thread and ignores retired subscriptions', async () => {
    const { api, oldHandlers } = setup()
    const renderer = await render()
    const get = deferred<BrowserUseViewState>()
    api.getBrowserUseState.mockReturnValueOnce(get.promise)
    api.mountBrowserUse.mockClear()
    await act(async () => renderer.update(createElement(AgentBrowserPanel, { threadId: 'thread-2', active: true })))
    expect(text(renderer.root)).not.toContain('First task')
    expect(api.mountBrowserUse.mock.calls.some(([input]) => input.threadId === 'thread-2')).toBe(false)
    expect(api.mountBrowserUse).toHaveBeenCalledWith(expect.objectContaining({ threadId: 'thread-1', visible: false, supervisionActive: false }))
    await act(async () => oldHandlers[0](state('thread-1', 'Retired event')))
    expect(text(renderer.root)).not.toContain('Retired event')
    await act(async () => get.resolve(state('thread-2', 'Second task')))
    expect(text(renderer.root)).toContain('Second task')
  })

  it.each(['resolve', 'reject'] as const)('does not let a late mount %s overwrite a new thread', async (outcome) => {
    const { api } = setup()
    const mount = deferred<BrowserUseViewState>()
    api.mountBrowserUse.mockReturnValueOnce(mount.promise)
    const renderer = await render()
    await act(async () => renderer.update(createElement(AgentBrowserPanel, { threadId: 'thread-2', active: true })))
    await act(async () => {
      if (outcome === 'resolve') mount.resolve(state('thread-1', 'Late mounted task'))
      else mount.reject(new Error('Retired mount failed'))
    })
    expect(text(renderer.root)).not.toContain('Retired mount failed')
    expect(text(renderer.root)).toContain('Second task')
    expect(text(renderer.root)).not.toContain('Late mounted task')
  })

  it.each(['resolve', 'reject'] as const)('discards a late action %s after a thread switch', async (outcome) => {
    const { api } = setup()
    const action = deferred<BrowserUseViewState>()
    api.setBrowserUseControl.mockReturnValueOnce(action.promise)
    const renderer = await render()
    const oldTakeControl = button(renderer, 'Take control').props.onClick
    await act(async () => oldTakeControl())
    await act(async () => renderer.update(createElement(AgentBrowserPanel, { threadId: 'thread-2', active: true })))
    await act(async () => {
      if (outcome === 'resolve') action.resolve(state('thread-1', 'Late action'))
      else action.reject(new Error('Retired action failed'))
    })
    expect(text(renderer.root)).toContain('Second task')
    expect(text(renderer.root)).not.toMatch(/Late action|Retired action failed/)
    await act(async () => oldTakeControl())
    expect(api.setBrowserUseControl).toHaveBeenCalledTimes(1)
  })

  it('does not accept late get failures after a valid event', async () => {
    const { api, publish } = setup()
    const get = deferred<BrowserUseViewState>()
    api.getBrowserUseState.mockReturnValueOnce(get.promise)
    const renderer = await render()
    await act(async () => publish(state('thread-1', 'Live task')))
    await act(async () => get.reject(new Error('Old get failed')))
    expect(text(renderer.root)).toContain('Live task')
    expect(text(renderer.root)).not.toContain('Old get failed')
  })

  it('unmounts the captured native view and cannot remount from a late response', async () => {
    const { api } = setup()
    const mount = deferred<BrowserUseViewState>()
    api.mountBrowserUse.mockReturnValueOnce(mount.promise)
    const renderer = await render()
    await act(async () => renderer.unmount())
    expect(api.mountBrowserUse).toHaveBeenLastCalledWith(expect.objectContaining({ threadId: 'thread-1', visible: false, supervisionActive: false }))
    const calls = api.mountBrowserUse.mock.calls.length
    await act(async () => mount.resolve(state('thread-1', 'Too late')))
    expect(api.mountBrowserUse).toHaveBeenCalledTimes(calls)
  })

  it('removes supervision when hidden and refuses stale controls', async () => {
    const { api } = setup()
    const renderer = await render()
    const takeControl = button(renderer, 'Take control').props.onClick
    await act(async () => renderer.update(createElement(AgentBrowserPanel, { threadId: 'thread-1', active: false })))
    expect(api.mountBrowserUse).toHaveBeenLastCalledWith(expect.objectContaining({ visible: false, supervisionActive: false }))
    expect(button(renderer, 'Take control').props.disabled).toBe(true)
    await act(async () => takeControl())
    expect(api.setBrowserUseControl).not.toHaveBeenCalled()
  })

  it('keeps supervision active while hiding the webpage for origin consent', async () => {
    const { api, publish } = setup()
    await render()
    api.mountBrowserUse.mockClear()
    await act(async () => publish(state('thread-1', 'Consent task', {
      lifecycle: 'waiting-origin-consent', pendingOriginConsent: {
        id: 'consent-1234567890', sessionId: 'session-thread-1-1234567890', threadId: 'thread-1',
        origin: 'https://example.com', sanitizedUrl: 'https://example.com', mode: 'public',
        createdAt: '2026-07-26T00:00:00.000Z'
      }
    })))
    expect(api.mountBrowserUse).toHaveBeenCalledWith(expect.objectContaining({ visible: false, supervisionActive: true }))
    expect(api.mountBrowserUse.mock.calls.some(([input]) => !(input as { supervisionActive?: boolean }).supervisionActive)).toBe(false)
  })

  it('serializes repeated controls but keeps Stop able to preempt a pending operation', async () => {
    const { api } = setup()
    const navigation = deferred<BrowserUseViewState>()
    api.navigateBrowserUse.mockReturnValueOnce(navigation.promise)
    const renderer = await render()
    const reload = button(renderer, 'Reload').props.onClick
    await act(async () => { reload(); reload() })
    expect(api.navigateBrowserUse).toHaveBeenCalledTimes(1)
    expect(button(renderer, 'Take control').props.disabled).toBe(true)
    expect(button(renderer, 'Stop').props.disabled).toBe(false)
    await act(async () => button(renderer, 'Stop').props.onClick())
    expect(api.stopBrowserUse).toHaveBeenCalledWith('thread-1')
    await act(async () => navigation.resolve(state('thread-1', 'Late navigation')))
    expect(text(renderer.root)).toContain('Stopped task')
    expect(text(renderer.root)).not.toContain('Late navigation')
  })

  it('reports an operation error and permits a retry', async () => {
    const { api } = setup()
    api.setBrowserUseControl.mockRejectedValueOnce(new Error('Takeover failed'))
    const renderer = await render()
    await act(async () => button(renderer, 'Take control').props.onClick())
    expect(text(renderer.root)).toContain('Takeover failed')
    expect(button(renderer, 'Take control').props.disabled).toBe(false)
    await act(async () => button(renderer, 'Take control').props.onClick())
    expect(text(renderer.root)).not.toContain('Takeover failed')
    expect(text(renderer.root)).toContain('Return to agent')
  })
})


describe('AgentBrowserPanel expected-turn binding', () => {
  it.each(['old-turn', undefined])('does not mount or expose a session for mismatched turn %s', async (turnId) => {
    const { api, publish } = setup()
    api.getBrowserUseState.mockResolvedValueOnce(state('thread-1', 'Previous run', { turnId }))
    const renderer = await render({ threadId: 'thread-1', expectedTurnId: 'selected-turn', active: true })
    expect(api.getBrowserUseState).toHaveBeenCalledWith('thread-1', 'selected-turn')
    expect(text(renderer.root)).not.toContain('Previous run')
    expect(button(renderer, 'Take control').props.disabled).toBe(true)
    expect(api.mountBrowserUse).not.toHaveBeenCalled()
    await act(async () => publish(state('thread-1', 'Mismatched event', { turnId })))
    expect(text(renderer.root)).not.toContain('Mismatched event')
    expect(api.mountBrowserUse).not.toHaveBeenCalled()
    await act(async () => publish(state('thread-1', 'Selected run', { turnId: 'selected-turn' })))
    expect(text(renderer.root)).toContain('Selected run')
    expect(api.mountBrowserUse).toHaveBeenCalledWith(expect.objectContaining({
      threadId: 'thread-1', expectedTurnId: 'selected-turn', visible: true, supervisionActive: true
    }))
  })

  it('passes the expected turn through navigation, takeover, stop, clear and lease disposal', async () => {
    const { api } = setup()
    const selected = state('thread-1', 'Selected run', { turnId: 'selected-turn' })
    api.getBrowserUseState.mockResolvedValue(selected)
    api.navigateBrowserUse.mockResolvedValue(selected)
    api.setBrowserUseControl.mockResolvedValue(selected)
    api.stopBrowserUse.mockResolvedValue(selected)
    api.clearBrowserUse.mockResolvedValue(selected)
    const renderer = await render({ threadId: 'thread-1', expectedTurnId: 'selected-turn', active: true })
    await act(async () => button(renderer, 'Reload').props.onClick())
    await act(async () => button(renderer, 'Take control').props.onClick())
    await act(async () => button(renderer, 'Stop').props.onClick())
    await act(async () => button(renderer, 'Clear session').props.onClick())
    expect(api.navigateBrowserUse).toHaveBeenCalledWith({ threadId: 'thread-1', expectedTurnId: 'selected-turn', command: 'reload' })
    expect(api.setBrowserUseControl).toHaveBeenCalledWith({ threadId: 'thread-1', expectedTurnId: 'selected-turn', controlOwner: 'manual' })
    expect(api.stopBrowserUse).toHaveBeenCalledWith('thread-1', 'selected-turn')
    expect(api.clearBrowserUse).toHaveBeenCalledWith('thread-1', 'selected-turn')
    await act(async () => renderer.unmount())
    expect(api.mountBrowserUse).toHaveBeenLastCalledWith(expect.objectContaining({
      threadId: 'thread-1', expectedTurnId: 'selected-turn', visible: false, supervisionActive: false
    }))
  })

  it('passes the expected turn through both exact-request consent decisions', async () => {
    const { api, publish } = setup()
    const selected = state('thread-1', 'Selected run', { turnId: 'selected-turn' })
    api.getBrowserUseState.mockResolvedValue({ ...selected, pendingOriginConsent: {
      id: 'origin-1234567890', sessionId: selected.sessionId!, threadId: 'thread-1',
      origin: 'https://example.com', sanitizedUrl: 'https://example.com', mode: 'public',
      createdAt: '2026-07-26T00:00:00.000Z'
    } })
    api.decideBrowserUseOrigin.mockResolvedValue(selected)
    api.decideBrowserUseAction.mockResolvedValue(selected)
    const renderer = await render({ threadId: 'thread-1', expectedTurnId: 'selected-turn', active: true })
    await act(async () => button(renderer, 'Deny').props.onClick())
    expect(api.decideBrowserUseOrigin).toHaveBeenCalledWith({
      threadId: 'thread-1', expectedTurnId: 'selected-turn', requestId: 'origin-1234567890', decision: 'deny'
    })
    await act(async () => publish({ ...selected, pendingActionConsent: {
      id: 'action-1234567890', sessionId: selected.sessionId!, threadId: 'thread-1', tabId: 'tab-thread-1',
      origin: 'https://example.com', pageTitle: 'Example', action: 'click', risk: 'interaction',
      targetRole: 'button', targetName: 'Publish', targetRect: { x: 0, y: 0, width: 20, height: 20 },
      expiresAt: '2026-07-26T00:01:00.000Z'
    } }))
    await act(async () => button(renderer, 'Allow once').props.onClick())
    expect(api.decideBrowserUseAction).toHaveBeenCalledWith({
      threadId: 'thread-1', expectedTurnId: 'selected-turn', requestId: 'action-1234567890', decision: 'allow-once'
    })
  })

  it('retires the old turn before reading another run in the same thread', async () => {
    const { api, oldHandlers } = setup()
    api.getBrowserUseState.mockResolvedValueOnce(state('thread-1', 'First run', { turnId: 'turn-1' }))
    const action = deferred<BrowserUseViewState>()
    api.setBrowserUseControl.mockReturnValueOnce(action.promise)
    const renderer = await render({ threadId: 'thread-1', expectedTurnId: 'turn-1', active: true })
    await act(async () => button(renderer, 'Take control').props.onClick())
    const next = deferred<BrowserUseViewState>()
    api.getBrowserUseState.mockReturnValueOnce(next.promise)
    api.mountBrowserUse.mockClear()
    await act(async () => renderer.update(createElement(AgentBrowserPanel, {
      threadId: 'thread-1', expectedTurnId: 'turn-2', active: true
    })))
    expect(text(renderer.root)).not.toContain('First run')
    expect(api.mountBrowserUse).toHaveBeenCalledTimes(1)
    expect(api.mountBrowserUse).toHaveBeenLastCalledWith(expect.objectContaining({
      expectedTurnId: 'turn-1', visible: false, supervisionActive: false
    }))
    await act(async () => {
      action.resolve(state('thread-1', 'Late old run', { turnId: 'turn-1' }))
      oldHandlers[0](state('thread-1', 'Retired turn event', { turnId: 'turn-1' }))
    })
    expect(text(renderer.root)).not.toMatch(/Late old run|Retired turn event/)
    await act(async () => next.resolve(state('thread-1', 'Second run', { turnId: 'turn-2' })))
    expect(text(renderer.root)).toContain('Second run')
    expect(api.mountBrowserUse).toHaveBeenLastCalledWith(expect.objectContaining({ expectedTurnId: 'turn-2', visible: true }))
  })
})
