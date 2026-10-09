// @vitest-environment jsdom
import { act, createElement, createRef } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { useMobileNavigation, type MobileNavigationGuard } from './use-mobile-navigation'

let root: Root
let host: HTMLDivElement
let navigation: ReturnType<typeof useMobileNavigation>
let guardRef = createRef<MobileNavigationGuard | null>()
function Harness() {
  navigation = useMobileNavigation(guardRef)
  return null
}
function RoomsFallbackHarness() {
  navigation = useMobileNavigation(guardRef, 'rooms')
  return null
}

async function traverseHistory(direction: 'back' | 'forward', search: string, events = 1) {
  // A rejected traversal emits a second popstate when the original entry is restored.
  const onPopState = vi.fn()
  window.addEventListener('popstate', onPopState)
  try {
    await act(async () => {
      window.history[direction]()
      await vi.waitFor(() => {
        expect(onPopState).toHaveBeenCalledTimes(events)
        expect(window.location.search).toBe(search)
      })
    })
  } finally {
    window.removeEventListener('popstate', onPopState)
  }
}

beforeEach(() => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true })
  window.history.replaceState({ existing: true }, '', '/')
  guardRef = createRef<MobileNavigationGuard | null>()
  host = document.createElement('div')
  document.body.append(host)
  root = createRoot(host)
})
afterEach(() => {
  act(() => root.unmount())
  host.remove()
  vi.restoreAllMocks()
})

describe('mobile navigation lifecycle', () => {
  it('uses the store-backed fallback only until the URL becomes explicit', async () => {
    act(() => root.render(createElement(RoomsFallbackHarness)))
    expect(navigation.page).toEqual({ mode: 'rooms', kind: 'home' })
    await act(async () => {
      window.history.replaceState({}, '', '/?mode=code&mobile=home')
      window.dispatchEvent(new PopStateEvent('popstate'))
      await Promise.resolve()
    })
    expect(navigation.page).toEqual({ mode: 'code', kind: 'home' })
  })

  it('restores the current URL when an async leave guard rejects popstate', async () => {
    window.history.replaceState({}, '', '/?mode=work&mobile=resource&resource=doc&view=edit')
    guardRef.current = vi.fn(async () => false)
    act(() => root.render(createElement(Harness)))
    act(() => {
      window.history.replaceState({}, '', '/?mode=code&mobile=home')
      window.dispatchEvent(new PopStateEvent('popstate'))
    })
    await act(async () => undefined)
    expect(navigation.page).toEqual({ mode: 'work', kind: 'resource', resourceKey: 'doc', view: 'edit' })
    expect(window.location.search).toBe('?mode=work&mobile=resource&resource=doc&view=edit')
    expect(guardRef.current).toHaveBeenCalled()
  })
  it('keeps the blocked history destination available after the user saves', async () => {
    window.history.replaceState({}, '', '/?mode=work&mobile=resource&resource=doc&view=edit')
    act(() => root.render(createElement(Harness)))
    act(() => navigation.navigate({ mode: 'code', kind: 'home' }))
    guardRef.current = vi.fn(async () => false)
    await traverseHistory('back', '?mode=code&mobile=home', 2)
    expect(navigation.page).toEqual({ mode: 'code', kind: 'home' })
    guardRef.current = vi.fn(async () => true)
    await traverseHistory('back', '?mode=work&mobile=resource&resource=doc&view=edit')
    expect(navigation.page).toEqual({ mode: 'work', kind: 'resource', resourceKey: 'doc', view: 'edit' })
  })
  it('restores the current page when a leave guard throws', async () => {
    window.history.replaceState({}, '', '/?mode=work&mobile=resource&resource=doc&view=edit')
    act(() => root.render(createElement(Harness)))
    act(() => navigation.navigate({ mode: 'code', kind: 'home' }))
    guardRef.current = () => { throw new Error('save failed') }
    await traverseHistory('back', '?mode=code&mobile=home', 2)
    expect(navigation.page).toEqual({ mode: 'code', kind: 'home' })
    expect(window.location.search).toBe('?mode=code&mobile=home')
  })
  it('preserves Forward after a leave guard rejects it', async () => {
    window.history.replaceState({}, '', '/?mode=work&mobile=resource&resource=doc&view=edit')
    guardRef.current = () => true
    act(() => root.render(createElement(Harness)))
    act(() => navigation.navigate({ mode: 'code', kind: 'home' }))
    await traverseHistory('back', '?mode=work&mobile=resource&resource=doc&view=edit')
    expect(navigation.page).toEqual({ mode: 'work', kind: 'resource', resourceKey: 'doc', view: 'edit' })
    guardRef.current = () => false
    await traverseHistory('forward', '?mode=work&mobile=resource&resource=doc&view=edit', 2)
    expect(navigation.page).toEqual({ mode: 'work', kind: 'resource', resourceKey: 'doc', view: 'edit' })
    expect(window.location.search).toContain('mobile=resource')
    guardRef.current = () => true
    await traverseHistory('forward', '?mode=code&mobile=home')
    expect(navigation.page).toEqual({ mode: 'code', kind: 'home' })
  })
  it('canonicalizes invalid targets consistently with refresh', () => {
    window.history.replaceState({}, '', '/?mode=rooms&mobile=invalid')
    act(() => root.render(createElement(Harness)))
    act(() => navigation.navigate({ mode: 'rooms', kind: 'home' }, true))
    expect(window.location.search).toBe('?mode=rooms&mobile=home')
    act(() => navigation.navigate({ mode: 'rooms', kind: 'room', roomId: '' }))
    expect(navigation.page).toEqual({ mode: 'rooms', kind: 'home' })
  })

  it('pushes once, preserves metadata and restores cross-mode popstate', async () => {
    act(() => root.render(createElement(Harness)))
    const push = vi.spyOn(window.history, 'pushState')
    act(() => navigation.navigate({ mode: 'rooms', kind: 'reply', roomId: 'one', messageId: 'message' }))
    expect(navigation.page).toEqual({ mode: 'rooms', kind: 'reply', roomId: 'one', messageId: 'message' })
    expect(window.history.state).toEqual(expect.objectContaining({ existing: true }))
    act(() => navigation.navigate({ mode: 'rooms', kind: 'reply', roomId: 'one', messageId: 'message' }))
    expect(push).toHaveBeenCalledTimes(1)
    await act(async () => {
      window.history.replaceState({}, '', '/?mode=work&mobile=resource&resource=doc&view=review')
      window.dispatchEvent(new PopStateEvent('popstate'))
      await Promise.resolve()
    })
    expect(navigation.page).toEqual({ mode: 'work', kind: 'resource', resourceKey: 'doc', view: 'review' })
    expect(push).toHaveBeenCalledTimes(1)
  })

  it('restores a direct Code URL and can replace it with another mode', () => {
    window.history.replaceState({}, '', '/?mode=code&mobile=conversation&thread=two')
    act(() => root.render(createElement(Harness)))
    expect(navigation.page).toEqual({ mode: 'code', kind: 'conversation', threadId: 'two' })
    const replace = vi.spyOn(window.history, 'replaceState')
    act(() => navigation.navigate({ mode: 'work', kind: 'home' }, true))
    expect(replace).toHaveBeenCalledTimes(1)
    expect(navigation.page).toEqual({ mode: 'work', kind: 'home' })
  })
})
