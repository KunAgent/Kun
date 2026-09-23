// @vitest-environment jsdom
import { act, createElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { useMobileViewport } from './use-mobile-viewport'

let root: Root
let host: HTMLDivElement
let viewport: EventTarget & { height: number; offsetTop: number; scale: number }
const value = (name: string) => document.documentElement.style.getPropertyValue(`--kun-mobile-${name}`)
function Harness() {
  useMobileViewport()
  return null
}

beforeEach(() => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true })
  viewport = Object.assign(new EventTarget(), { height: 844, offsetTop: 0, scale: 1 })
  vi.stubGlobal('visualViewport', viewport)
  vi.stubGlobal('innerHeight', 844)
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

describe('mobile visual viewport', () => {
  it('tracks keyboard height and browser panning, then restores the full viewport', () => {
    act(() => root.render(createElement(Harness)))
    expect(value('height')).toBe('844px')
    act(() => {
      viewport.height = 390
      viewport.offsetTop = 48
      viewport.dispatchEvent(new Event('resize'))
    })
    expect(value('height')).toBe('390px')
    expect(value('top')).toBe('48px')
    expect(value('bottom')).toBe('406px')
    act(() => {
      viewport.offsetTop = 0
      viewport.dispatchEvent(new Event('scroll'))
    })
    expect(value('bottom')).toBe('454px')
    act(() => {
      viewport.height = 844
      viewport.dispatchEvent(new Event('resize'))
    })
    expect(value('height')).toBe('844px')
    expect(value('bottom')).toBe('0px')
  })

  it('does not reflow during pinch zoom or apply invalid dimensions', () => {
    act(() => root.render(createElement(Harness)))
    act(() => {
      viewport.height = 200
      viewport.scale = 2
      viewport.dispatchEvent(new Event('resize'))
    })
    expect(value('height')).toBe('844px')
    act(() => {
      viewport.scale = 1
      viewport.height = 0
      viewport.dispatchEvent(new Event('resize'))
    })
    expect(value('height')).toBe('844px')
  })

  it('falls back to the layout viewport and tracks orientation resize', () => {
    vi.stubGlobal('visualViewport', undefined)
    act(() => root.render(createElement(Harness)))
    act(() => {
      vi.stubGlobal('innerHeight', 390)
      window.dispatchEvent(new Event('resize'))
    })
    expect(value('height')).toBe('390px')
    expect(value('bottom')).toBe('0px')
  })

  it('cleans up listeners and CSS variables when leaving the mobile shell', () => {
    const remove = vi.spyOn(viewport, 'removeEventListener')
    act(() => root.render(createElement(Harness)))
    act(() => root.render(null))
    expect(remove).toHaveBeenCalledWith('resize', expect.any(Function))
    expect(remove).toHaveBeenCalledWith('scroll', expect.any(Function))
    expect(value('height')).toBe('')
    expect(value('top')).toBe('')
    expect(value('bottom')).toBe('')
  })
})
