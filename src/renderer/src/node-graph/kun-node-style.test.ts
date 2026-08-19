// @vitest-environment jsdom
import { afterEach, describe, expect, it } from 'vitest'
import { act } from 'react'
import { createElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import {
  FOCUS_MODE_ATTRIBUTE,
  isKunStyledNodeKind,
  KUN_NODE_STYLE_KINDS,
  kunNodeStyleFromFocusMode,
  readKunNodeStyle,
  useKunNodeStyle
} from './kun-node-style'
import { FOCUS_MODE_STORAGE_KEY } from '../lib/focus-mode'

let root: Root | null = null

afterEach(() => {
  if (root) act(() => root!.unmount())
  root = null
  document.documentElement.removeAttribute(FOCUS_MODE_ATTRIBUTE)
  window.localStorage.clear()
})

describe('kunNodeStyleFromFocusMode', () => {
  it('is the inverse of focus mode', () => {
    expect(kunNodeStyleFromFocusMode('off', false)).toBe(true)
    expect(kunNodeStyleFromFocusMode('on', false)).toBe(false)
  })

  it('lets the attribute win over a stale stored preference', () => {
    // The workbench writes the attribute on every change; the store is only read
    // at startup, so disagreement means the attribute is the newer of the two.
    expect(kunNodeStyleFromFocusMode('on', false)).toBe(false)
    expect(kunNodeStyleFromFocusMode('off', true)).toBe(true)
  })

  it('falls back to the preference before the attribute is written', () => {
    expect(kunNodeStyleFromFocusMode(null, true)).toBe(false)
    expect(kunNodeStyleFromFocusMode(null, false)).toBe(true)
    // An unknown value is not a claim about focus mode either.
    expect(kunNodeStyleFromFocusMode('maybe', true)).toBe(false)
  })
})

describe('KUN_NODE_STYLE_KINDS', () => {
  it('covers exactly the four kinds that have artwork', () => {
    expect([...KUN_NODE_STYLE_KINDS]).toEqual(['workspace', 'thread', 'folder', 'document'])
    expect(isKunStyledNodeKind('workspace')).toBe(true)
    expect(isKunStyledNodeKind('memory')).toBe(false)
  })
})

describe('readKunNodeStyle', () => {
  it('reads the live attribute', () => {
    document.documentElement.setAttribute(FOCUS_MODE_ATTRIBUTE, 'on')
    expect(readKunNodeStyle()).toBe(false)
    document.documentElement.setAttribute(FOCUS_MODE_ATTRIBUTE, 'off')
    expect(readKunNodeStyle()).toBe(true)
  })

  it('reads the stored preference with no attribute present', () => {
    window.localStorage.setItem(FOCUS_MODE_STORAGE_KEY, '1')
    expect(readKunNodeStyle()).toBe(false)
  })
})

describe('useKunNodeStyle', () => {
  function mount(): { value: () => boolean } {
    const seen: boolean[] = []
    function Probe(): null {
      seen.push(useKunNodeStyle())
      return null
    }
    const container = document.createElement('div')
    document.body.appendChild(container)
    root = createRoot(container)
    act(() => root!.render(createElement(Probe)))
    return { value: () => seen[seen.length - 1]! }
  }

  // MutationObserver delivers on a microtask, so the switch lands one tick after
  // the attribute changes rather than synchronously with it.
  it('re-renders when focus mode is switched', async () => {
    document.documentElement.setAttribute(FOCUS_MODE_ATTRIBUTE, 'on')
    const probe = mount()
    expect(probe.value()).toBe(false)
    await act(async () => {
      document.documentElement.setAttribute(FOCUS_MODE_ATTRIBUTE, 'off')
    })
    expect(probe.value()).toBe(true)
  })

  it('stops observing once the last consumer unmounts', async () => {
    document.documentElement.setAttribute(FOCUS_MODE_ATTRIBUTE, 'on')
    const probe = mount()
    const before = probe.value()
    await act(async () => root!.unmount())
    root = null
    await act(async () => {
      document.documentElement.setAttribute(FOCUS_MODE_ATTRIBUTE, 'off')
    })
    expect(probe.value()).toBe(before)
  })
})
