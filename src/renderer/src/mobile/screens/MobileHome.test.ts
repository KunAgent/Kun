// @vitest-environment jsdom
import { act, createElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { MobileHome, type MobileHomeProps } from './MobileHome'

let root: Root
let host: HTMLDivElement
function props(): MobileHomeProps {
  return {
    labels: {
      title: 'Conversations', workspace: 'Project', search: 'Search', newConversation: 'New',
      settings: 'Settings', more: 'More', loadMore: 'Load more', retry: 'Retry', empty: 'No conversations',
      loading: 'Loading', back: 'Back'
    },
    threads: [{ id: 'one', title: 'First', updatedAt: '2026-09-20T00:00:00Z', model: 'model', mode: 'agent', preview: 'Preview' }],
    search: '', loading: false, error: null, hasMore: true,
    onSearch: vi.fn(), onOpenThread: vi.fn(), onThreadMenu: vi.fn(), onWorkspace: vi.fn(),
    onNewConversation: vi.fn(), onSettings: vi.fn(), onLoadMore: vi.fn(), onRetry: vi.fn()
  }
}
beforeEach(() => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true })
  host = document.createElement('div')
  document.body.append(host)
  root = createRoot(host)
})
afterEach(() => {
  act(() => root.unmount())
  host.remove()
})

describe('mobile conversation home', () => {
  it('exposes explicit open and menu actions without hover gestures', () => {
    const input = props()
    act(() => root.render(createElement(MobileHome, input)))
    act(() => (host.querySelector('.kun-mobile-thread-open') as HTMLButtonElement).click())
    expect(input.onOpenThread).toHaveBeenCalledWith('one')
    act(() => (host.querySelector('[aria-label="More: First"]') as HTMLButtonElement).click())
    expect(input.onThreadMenu).toHaveBeenCalledWith('one')
    expect(host.textContent).toContain('Preview')
  })

  it('disables pagination while loading and exposes recovery errors', () => {
    const input = { ...props(), loading: true, error: 'Network unavailable' }
    act(() => root.render(createElement(MobileHome, input)))
    expect((host.querySelector('.kun-mobile-load-more') as HTMLButtonElement).disabled).toBe(true)
    expect(host.querySelector('[role="alert"]')?.textContent).toContain('Network unavailable')
    act(() => (host.querySelector('[role="alert"] button') as HTMLButtonElement).click())
    expect(input.onRetry).not.toHaveBeenCalled()
    act(() => root.render(createElement(MobileHome, { ...input, loading: false, threads: [] })))
    expect(host.querySelector('[role="status"]')).toBeNull()
    act(() => (host.querySelector('[role="alert"] button') as HTMLButtonElement).click())
    expect(input.onRetry).toHaveBeenCalledOnce()
  })

  it('distinguishes empty and loading states', () => {
    const input = { ...props(), threads: [], hasMore: false }
    act(() => root.render(createElement(MobileHome, input)))
    expect(host.querySelector('[role="status"]')?.textContent).toBe('No conversations')
    act(() => root.render(createElement(MobileHome, { ...input, loading: true })))
    expect(host.querySelector('[role="status"]')?.textContent).toBe('Loading')
  })
})
