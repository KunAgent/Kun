import { createElement, useRef, type ReactElement } from 'react'
import { act, create, type ReactTestRenderer } from 'react-test-renderer'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { useTimelineScroll, type UseTimelineScrollResult } from './use-timeline-scroll'

type ScrollNode = {
  scrollHeight: number
  scrollTop: number
  clientHeight: number
  scrollIntoView: ReturnType<typeof vi.fn>
  getBoundingClientRect: () => { height: number }
  addEventListener: (name: string, listener: () => void) => void
  removeEventListener: (name: string) => void
  listeners: Map<string, () => void>
}

let latestScroll: UseTimelineScrollResult | undefined

function Harness(props: { threadId: string; userTurnKey: string; contentKey: string }): ReactElement {
  const containerRef = useRef<HTMLDivElement>(null)
  const contentRef = useRef<HTMLDivElement>(null)
  const endRef = useRef<HTMLDivElement>(null)
  latestScroll = useTimelineScroll({
    containerRef,
    contentRef,
    endRef,
    activeThreadId: props.threadId,
    pageSize: 18,
    totalTurns: 24,
    busy: false,
    scrollDeps: {
      contentKey: props.contentKey,
      streaming: false,
      userTurnKey: props.userTurnKey
    }
  })
  return createElement('div', { 'data-node': 'container', ref: containerRef },
    createElement('div', { 'data-node': 'content', ref: contentRef }),
    createElement('div', { 'data-node': 'end', ref: endRef }))
}

describe('useTimelineScroll delayed layout behavior', () => {
  let renderer: ReactTestRenderer | undefined
  let container: ScrollNode
  let content: ScrollNode
  let end: ScrollNode
  let resizeCallback: ((entries: Array<{ contentRect: { height: number } }>) => void) | undefined
  let frames: Array<() => void>

  beforeEach(() => {
    ;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true
    frames = []
    const requestAnimationFrame = vi.fn((callback: FrameRequestCallback) => {
      frames.push(() => callback(0))
      return frames.length
    })
    vi.stubGlobal('window', {
      requestAnimationFrame,
      cancelAnimationFrame: vi.fn()
    })
    vi.stubGlobal('requestAnimationFrame', requestAnimationFrame)
    vi.stubGlobal('ResizeObserver', class {
      constructor(callback: typeof resizeCallback) {
        resizeCallback = callback
      }
      observe(): void {}
      disconnect(): void {}
    })
    container = scrollNode(2_000, 0, 500)
    content = scrollNode(1_000, 0, 0)
    end = scrollNode(0, 0, 0)
  })

  afterEach(async () => {
    if (renderer) await act(async () => renderer?.unmount())
    renderer = undefined
    latestScroll = undefined
    vi.unstubAllGlobals()
  })

  it('fences an earlier-turn restore when a new user turn is submitted', async () => {
    await mount('thread-a', 'user-a', 'content-a')
    flushFrames()
    end.scrollIntoView.mockClear()

    await act(async () => latestScroll?.loadEarlierTurns({ userInitiated: true }))
    container.scrollHeight = 2_500
    await act(async () => {
      renderer?.update(createElement(Harness, {
        threadId: 'thread-a', userTurnKey: 'user-b', contentKey: 'content-b'
      }))
    })
    flushFrames()

    expect(container.scrollTop).toBe(0)
    expect(end.scrollIntoView).toHaveBeenCalled()
  })

  it('follows asynchronous content growth only while pinned to the bottom', async () => {
    await mount('thread-a', 'user-a', 'content-a')
    flushFrames()
    end.scrollIntoView.mockClear()

    resizeCallback?.([{ contentRect: { height: 1_000 } }])
    resizeCallback?.([{ contentRect: { height: 1_300 } }])
    flushFrames()
    expect(end.scrollIntoView).toHaveBeenCalledTimes(1)

    end.scrollIntoView.mockClear()
    container.scrollTop = 500
    container.listeners.get('scroll')?.()
    resizeCallback?.([{ contentRect: { height: 1_500 } }])
    flushFrames()
    expect(end.scrollIntoView).not.toHaveBeenCalled()
  })

  async function mount(threadId: string, userTurnKey: string, contentKey: string): Promise<void> {
    await act(async () => {
      renderer = create(createElement(Harness, { threadId, userTurnKey, contentKey }), {
        createNodeMock: (element) => {
          const props = element.props as Record<string, unknown>
          if (props['data-node'] === 'container') return container
          if (props['data-node'] === 'content') return content
          if (props['data-node'] === 'end') return end
          return {}
        }
      })
    })
  }

  function flushFrames(): void {
    const pending = frames
    frames = []
    for (const frame of pending) frame()
  }
})

function scrollNode(scrollHeight: number, scrollTop: number, clientHeight: number): ScrollNode {
  const listeners = new Map<string, () => void>()
  return {
    scrollHeight,
    scrollTop,
    clientHeight,
    scrollIntoView: vi.fn(),
    getBoundingClientRect: () => ({ height: scrollHeight }),
    addEventListener: (name, listener) => listeners.set(name, listener),
    removeEventListener: (name) => listeners.delete(name),
    listeners
  }
}
