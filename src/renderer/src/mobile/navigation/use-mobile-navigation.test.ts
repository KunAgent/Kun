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
    window.history.replaceState({}, '', '/?mode=rooms&mobile=invalid')
    act(() => root.render(createElement(Harness)))
    act(() => navigation.navigate({ mode: 'rooms', kind: 'home' }, true))
    expect(window.location.search).toBe('?mode=rooms&mobile=home')
    act(() => navigation.navigate({ mode: 'rooms', kind: 'room', roomId: '' }))
    expect(navigation.page).toEqual({ mode: 'rooms', kind: 'home' })
  })

  it('pushes once, preserves metadata and restores cross-mode popstate', () => {
    act(() => root.render(createElement(Harness)))
    const push = vi.spyOn(window.history, 'pushState')
    act(() => navigation.navigate({ mode: 'rooms', kind: 'reply', roomId: 'one', messageId: 'message' }))
    expect(navigation.page).toEqual({ mode: 'rooms', kind: 'reply', roomId: 'one', messageId: 'message' })
    expect(window.history.state).toEqual({ existing: true })
    act(() => navigation.navigate({ mode: 'rooms', kind: 'reply', roomId: 'one', messageId: 'message' }))
    expect(push).toHaveBeenCalledTimes(1)
    act(() => {
      window.history.replaceState({}, '', '/?mode=work&mobile=resource&resource=doc&view=review')
      window.dispatchEvent(new PopStateEvent('popstate'))
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
