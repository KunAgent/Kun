// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { createElement } from 'react'
import {
  NODE_GRAPH_AUTO_REFRESH_MS,
  useNodeGraphAutoRefresh
} from './use-node-graph-auto-refresh'

let container: HTMLElement
let root: Root
let visibility: DocumentVisibilityState = 'visible'

function Probe({ enabled, onRefresh }: {
  enabled: boolean
  onRefresh: () => void
}): null {
  useNodeGraphAutoRefresh({ enabled, intervalMs: 1_000, onRefresh })
  return null
}

function mount(enabled: boolean, onRefresh: () => void): void {
  act(() => {
    root.render(createElement(Probe, { enabled, onRefresh }))
  })
}

function setVisibility(state: DocumentVisibilityState): void {
  visibility = state
  act(() => {
    document.dispatchEvent(new Event('visibilitychange'))
  })
}

beforeEach(() => {
  vi.useFakeTimers()
  visibility = 'visible'
  Object.defineProperty(document, 'visibilityState', {
    configurable: true,
    get: () => visibility
  })
  container = document.createElement('div')
  document.body.appendChild(container)
  root = createRoot(container)
  // React 19 logs an act-environment warning without this flag.
  ;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true
})

afterEach(() => {
  act(() => root.unmount())
  container.remove()
  vi.useRealTimers()
})

describe('useNodeGraphAutoRefresh', () => {
  it('refreshes on the interval', () => {
    const onRefresh = vi.fn()
    mount(true, onRefresh)
    expect(onRefresh).not.toHaveBeenCalled()
    act(() => void vi.advanceTimersByTime(3_500))
    expect(onRefresh).toHaveBeenCalledTimes(3)
  })

  it('does nothing while disabled', () => {
    const onRefresh = vi.fn()
    mount(false, onRefresh)
    act(() => void vi.advanceTimersByTime(5_000))
    expect(onRefresh).not.toHaveBeenCalled()
  })

  it('stops while the document is hidden', () => {
    const onRefresh = vi.fn()
    mount(true, onRefresh)
    act(() => void vi.advanceTimersByTime(1_000))
    expect(onRefresh).toHaveBeenCalledTimes(1)
    setVisibility('hidden')
    act(() => void vi.advanceTimersByTime(10_000))
    // A backgrounded window must not keep scanning the filesystem.
    expect(onRefresh).toHaveBeenCalledTimes(1)
  })

  it('catches up immediately when the document becomes visible again', () => {
    const onRefresh = vi.fn()
    mount(true, onRefresh)
    setVisibility('hidden')
    onRefresh.mockClear()
    setVisibility('visible')
    expect(onRefresh).toHaveBeenCalledTimes(1)
    act(() => void vi.advanceTimersByTime(1_000))
    expect(onRefresh).toHaveBeenCalledTimes(2)
  })

  it('stops once unmounted', () => {
    const onRefresh = vi.fn()
    mount(true, onRefresh)
    act(() => root.unmount())
    root = createRoot(container)
    onRefresh.mockClear()
    act(() => void vi.advanceTimersByTime(5_000))
    expect(onRefresh).not.toHaveBeenCalled()
  })

  it('exposes a sane default cadence', () => {
    expect(NODE_GRAPH_AUTO_REFRESH_MS).toBeGreaterThanOrEqual(1_000)
    expect(NODE_GRAPH_AUTO_REFRESH_MS).toBeLessThanOrEqual(15_000)
  })
})
