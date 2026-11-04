import { beforeEach, expect, it } from 'vitest'
import type { BrowserUseViewState } from '@shared/browser-use'
import { useAgentBrowserPreviewStore } from './agent-browser-preview-state'

const state = (turnId = 'turn-1'): BrowserUseViewState => ({
  contractVersion: 1, capabilityStatus: 'available', sessionId: 'session-1234567890', threadId: 'thread', turnId,
  lifecycle: 'ready', controlOwner: 'agent', visible: false, mounted: false, mode: 'public',
  tabs: [{ id: 'tab', title: '', origin: 'https://example.com', sanitizedUrl: 'https://example.com',
    active: true, loading: false, canGoBack: false, canGoForward: false }], updatedAt: '2026-11-04T00:00:00Z'
})
beforeEach(() => useAgentBrowserPreviewStore.setState({ byThreadId: {} }))

it('keeps the browser in its chosen panel and preserves its floating position across turns', () => {
  const store = useAgentBrowserPreviewStore.getState(), first = state()
  store.observe(first, 'thread')
  store.setGeometry(first, { width: 400, position: { x: 100, y: 150 } })
  store.setSurface(first, 'panel')
  const second = state('turn-2')
  store.observe(second, 'thread')
  expect(useAgentBrowserPreviewStore.getState().byThreadId.thread).toMatchObject({
    surface: 'panel', open: true, turnId: 'turn-2', geometry: { width: 400, position: { x: 100, y: 150 } }
  })
  store.setSurface(first, 'floating', false)
  store.setGeometry(first, { width: 800, position: { x: 1, y: 2 } })
  expect(useAgentBrowserPreviewStore.getState().byThreadId.thread).toMatchObject({ surface: 'panel', geometry: { width: 400 } })
  store.setSurface(second, 'floating')
  expect(useAgentBrowserPreviewStore.getState().byThreadId.thread).toMatchObject({ surface: 'floating', open: true })
})

it('leaves a dismissed panel collapsed until a new browser turn begins', () => {
  const store = useAgentBrowserPreviewStore.getState(), first = state()
  store.observe(first, 'thread')
  store.setSurface(first, 'panel')
  store.setSurface(first, 'floating', false)
  store.observe({ ...first, visible: false }, 'thread')
  expect(useAgentBrowserPreviewStore.getState().byThreadId.thread.open).toBe(false)
  store.observe(state('turn-2'), 'thread')
  expect(useAgentBrowserPreviewStore.getState().byThreadId.thread).toMatchObject({ surface: 'floating', open: true })
})

it('drops a cached panel when the authoritative read confirms the session has expired', () => {
  const store = useAgentBrowserPreviewStore.getState(), first = state()
  store.observe(first, 'thread')
  store.setSurface(first, 'panel')
  store.observe({ ...first, threadId: undefined, sessionId: undefined, lifecycle: 'closed', tabs: [] }, 'thread')
  expect(useAgentBrowserPreviewStore.getState().byThreadId.thread).toBeUndefined()
})
