// @vitest-environment jsdom
import { act, createElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { currentRemoteSurface, useRemoteSurface } from './use-remote-surface'
import type { RemoteSurface } from './remote-surface'

let root: Root
let host: HTMLDivElement
let surface: RemoteSurface
let coarse = false
let pointer: EventTarget & MediaQueryList
function Harness() {
  surface = useRemoteSurface()
  return null
}

beforeEach(() => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true })
  coarse = false
  pointer = new EventTarget() as EventTarget & MediaQueryList
  Object.defineProperty(pointer, 'matches', { get: () => coarse })
  vi.stubGlobal('matchMedia', () => pointer)
  vi.stubGlobal('innerWidth', 1280)
  vi.stubGlobal('screen', { width: 1920, height: 1080 })
  vi.stubGlobal('kunGui', { isRemoteWeb: true })
  host = document.createElement('div')
  document.body.append(host)
  root = createRoot(host)
})
afterEach(() => {
  act(() => root.unmount())
  host.remove()
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

describe('remote surface browser integration', () => {
  it('responds to layout width changes and removes listeners on unmount', () => {
    const remove = vi.spyOn(window, 'removeEventListener')
    act(() => root.render(createElement(Harness)))
    expect(surface).toBe('desktop')
    act(() => {
      vi.stubGlobal('innerWidth', 390)
      window.dispatchEvent(new Event('resize'))
    })
    expect(surface).toBe('mobile')
    act(() => root.render(null))
    expect(remove).toHaveBeenCalledWith('resize', expect.any(Function))
    expect(remove).toHaveBeenCalledWith('orientationchange', expect.any(Function))
  })

  it('keeps a touch phone mobile after orientation changes', () => {
    coarse = true
    vi.stubGlobal('innerWidth', 390)
    vi.stubGlobal('screen', { width: 390, height: 844 })
    act(() => root.render(createElement(Harness)))
    act(() => {
      vi.stubGlobal('innerWidth', 844)
      window.dispatchEvent(new Event('orientationchange'))
    })
    expect(surface).toBe('mobile')
  })

  it('does not inspect keyboard visual viewport dimensions', () => {
    vi.stubGlobal('visualViewport', { width: 390, height: 200 })
    expect(currentRemoteSurface()).toBe('desktop')
  })

  it('handles unavailable browser APIs and an Electron bridge', () => {
    vi.stubGlobal('matchMedia', undefined)
    vi.stubGlobal('screen', undefined)
    vi.stubGlobal('innerWidth', 390)
    expect(currentRemoteSurface()).toBe('mobile')
    vi.stubGlobal('kunGui', { isRemoteWeb: false })
    expect(currentRemoteSurface()).toBe('desktop')
  })
})
