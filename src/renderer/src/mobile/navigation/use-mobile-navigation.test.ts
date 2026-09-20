// @vitest-environment jsdom
import { act, createElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { useMobileNavigation } from './use-mobile-navigation'

let root: Root
let host: HTMLDivElement
let navigation: ReturnType<typeof useMobileNavigation>
function Harness() {
  navigation = useMobileNavigation()
  return null
}

beforeEach(() => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true })
  window.history.replaceState({ existing: true }, '', '/')
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
  it('canonicalizes invalid targets consistently with refresh', () => {
    window.history.replaceState({}, '', '/?mobile=invalid')
    act(() => root.render(createElement(Harness)))
    act(() => navigation.navigate({ kind: 'home' }, true))
    expect(window.location.search).toBe('?mobile=home')
    act(() => navigation.navigate({ kind: 'conversation', threadId: '' }))
    expect(navigation.page).toEqual({ kind: 'home' })
    expect(window.location.search).toBe('?mobile=home')
  })
  it('pushes once, preserves history metadata and restores popstate without pushing', () => {
    act(() => root.render(createElement(Harness)))
    const push = vi.spyOn(window.history, 'pushState')
    act(() => navigation.navigate({ kind: 'conversation', threadId: 'one' }))
    expect(navigation.page).toEqual({ kind: 'conversation', threadId: 'one' })
    expect(window.history.state).toEqual({ existing: true })
    act(() => navigation.navigate({ kind: 'conversation', threadId: 'one' }))
    expect(push).toHaveBeenCalledTimes(1)
    act(() => {
      window.history.replaceState({}, '', '/?mobile=settings')
      window.dispatchEvent(new PopStateEvent('popstate'))
    })
    expect(navigation.page).toEqual({ kind: 'settings' })
    expect(push).toHaveBeenCalledTimes(1)
  })

  it('restores a direct conversation URL on mount and can replace an invalid route', () => {
    window.history.replaceState({}, '', '/?mobile=conversation&thread=two')
    act(() => root.render(createElement(Harness)))
    expect(navigation.page).toEqual({ kind: 'conversation', threadId: 'two' })
    const replace = vi.spyOn(window.history, 'replaceState')
    act(() => navigation.navigate({ kind: 'home' }, true))
    expect(replace).toHaveBeenCalledTimes(1)
    expect(navigation.page).toEqual({ kind: 'home' })
  })
})
