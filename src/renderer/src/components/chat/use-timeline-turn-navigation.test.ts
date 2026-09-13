import { createElement } from 'react'
import { act, create, type ReactTestRenderer } from 'react-test-renderer'
import { afterEach, expect, it, vi } from 'vitest'
import { useTimelineTurnNavigation } from './use-timeline-turn-navigation'
import { useThreadTurnTarget } from './thread-turn-target'

let renderer: ReactTestRenderer | undefined
afterEach(() => {
  if (renderer) act(() => renderer!.unmount())
  renderer = undefined
  useThreadTurnTarget.setState({ target: null })
  vi.unstubAllGlobals()
})

it('reveals a hidden historical target then scrolls to that exact node once, ignoring later live changes', async () => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)
  const frames = new Map<number, FrameRequestCallback>()
  let nextFrame = 0
  vi.stubGlobal('window', {
    requestAnimationFrame: (callback: FrameRequestCallback) => { frames.set(++nextFrame, callback); return nextFrame },
    cancelAnimationFrame: (id: number) => frames.delete(id)
  })
  const oldScroll = vi.fn(), latestScroll = vi.fn(), reveal = vi.fn(), onActive = vi.fn()
  const turns = Array.from({ length: 40 }, (_, index) => ({ turnId: `turn_${index}`, blocks: [] }))
  const turnRefMap = { current: new Map([
    ['turn_3', { scrollIntoView: oldScroll } as unknown as HTMLDivElement],
    ['turn_39', { scrollIntoView: latestScroll } as unknown as HTMLDivElement]
  ]) }
  useThreadTurnTarget.setState({ target: { threadId: 'thread', turnId: 'turn_3', blocks: [], revision: 1 } })
  function Harness({ hidden = 22, activeThreadId = 'thread' }) {
    useTimelineTurnNavigation({ activeThreadId, turns, hiddenTurnCount: hidden, turnRefMap, revealTurnAtIndex: reveal, onActive })
    return null
  }
  await act(async () => { renderer = create(createElement(Harness, {})) })
  expect(reveal).toHaveBeenCalledWith(3)
  expect(frames.size).toBe(0)
  await act(async () => { renderer!.update(createElement(Harness, { hidden: 0 })) })
  act(() => { for (const callback of frames.values()) callback(0); frames.clear() })
  expect(oldScroll).toHaveBeenCalledWith({ behavior: 'auto', block: 'start' })
  expect(latestScroll).not.toHaveBeenCalled()
  expect(onActive).toHaveBeenCalledWith('turn_3')
  await act(async () => { renderer!.update(createElement(Harness, { hidden: 1 })) })
  expect(oldScroll).toHaveBeenCalledTimes(1)
  act(() => useThreadTurnTarget.setState({ target: { threadId: 'other', turnId: 'turn_39', blocks: [], revision: 2 } }))
  expect(frames.size).toBe(0)
  expect(latestScroll).not.toHaveBeenCalled()
})
