// @vitest-environment jsdom

import { act, createElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { MAX_FINISH_MS } from './assistant-text-reveal'
import { resetRevealHandoffForTests } from './assistant-reveal-handoff'
import { useAssistantTextReveal } from './use-assistant-text-reveal'

function Probe({ text, streaming }: { text: string; streaming: boolean }) {
  const reveal = useAssistantTextReveal(text, streaming)
  return createElement('div', { 'data-fading': reveal.fade ? 'true' : 'false' }, reveal.text)
}

describe('assistant text reveal lifecycle', () => {
  let container: HTMLDivElement
  let root: Root
  let now: number
  let hidden: boolean
  let nextFrameId: number
  let frames: Map<number, FrameRequestCallback>

  beforeEach(() => {
    vi.useFakeTimers()
    ;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true
    now = 0
    hidden = false
    nextFrameId = 1
    frames = new Map()
    vi.spyOn(performance, 'now').mockImplementation(() => now)
    vi.spyOn(document, 'visibilityState', 'get').mockImplementation(() => hidden ? 'hidden' : 'visible')
    vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => {
      const id = nextFrameId++
      frames.set(id, callback)
      return id
    })
    vi.stubGlobal('cancelAnimationFrame', (id: number) => frames.delete(id))
    resetRevealHandoffForTests()
    container = document.createElement('div')
    document.body.appendChild(container)
    root = createRoot(container)
  })

  afterEach(async () => {
    await act(async () => root.unmount())
    container.remove()
    vi.useRealTimers()
    vi.restoreAllMocks()
    vi.unstubAllGlobals()
    ;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = false
  })

  const render = async (text: string, streaming = true) => {
    await act(async () => root.render(createElement(Probe, { text, streaming })))
  }
  const frame = async (elapsedMs = 16) => {
    now += elapsedMs
    const pending = [...frames.values()]
    frames.clear()
    await act(async () => pending.forEach((callback) => callback(now)))
  }
  const visibility = async (value: boolean) => {
    hidden = value
    await act(async () => document.dispatchEvent(new Event('visibilitychange')))
  }
  const expectIdle = () => {
    expect(frames.size).toBe(0)
    expect(vi.getTimerCount()).toBe(0)
  }
  const framesUntil = async (done: () => boolean, maxMs = MAX_FINISH_MS + 600) => {
    for (let elapsed = 0; elapsed < maxMs && !done(); elapsed += 16) await frame()
  }

  it('paints the full initial history or already-running response with no idle loop', async () => {
    const history = 'history '.repeat(20_000)
    await render(history)
    expect(container.textContent).toBe(history)
    expectIdle()
    await render(`${history} completed`, false)
    expect(container.textContent).toBe(`${history} completed`)
    expectIdle()
  })

  it('paces ordinary live growth, fades its tail and drains it once input goes idle', async () => {
    await render('prefix ')
    const text = `prefix ${'a'.repeat(100)}`
    await render(text)
    expect(container.textContent).toBe('prefix ')
    await frame()
    await frame(60)
    expect(container.textContent!.length).toBeGreaterThan(7)
    expect(container.textContent!.length).toBeLessThan(text.length)
    expect(container.firstElementChild?.getAttribute('data-fading')).toBe('true')
    await framesUntil(() => container.textContent === text)
    expect(container.textContent).toBe(text)
    await framesUntil(() => frames.size === 0, 400)
    expect(container.firstElementChild?.getAttribute('data-fading')).toBe('false')
    expectIdle()
  })

  it('does not restart the frame clock on each incoming delta', async () => {
    await render('')
    let text = 'a'.repeat(100)
    await render(text)
    const firstFrame = [...frames.keys()][0]
    for (let index = 0; index < 10; index += 1) {
      now += 5
      text += 'b'
      await render(text)
    }
    expect([...frames.keys()][0]).toBe(firstFrame)
    await framesUntil(() => frames.size === 0)
    expect(container.textContent).toBe(text)
    expectIdle()
  })

  it('shows a large accumulated burst directly without retyping it', async () => {
    await render('before ')
    const burst = `before ${'new content '.repeat(5000)}`
    await render(burst)
    expect(container.textContent).toBe(burst)
    expectIdle()
  })

  it('settles on hiding, keeps hidden updates current and resumes only new growth', async () => {
    await render('before ')
    const live = `before ${'x'.repeat(100)}`
    await render(live)
    await frame()
    expect(container.textContent).not.toBe(live)
    await visibility(true)
    expect(container.textContent).toBe(live)
    expectIdle()
    const background = `${live} background completion`
    await render(background)
    expect(container.textContent).toBe(background)
    expectIdle()
    await visibility(false)
    expect(container.textContent).toBe(background)
    expectIdle()
    await render(`${background} next live delta`)
    expect(container.textContent).toBe(background)
    expect(frames.size).toBe(1)
  })

  it('settles immediately on foreground even when no hidden event was delivered', async () => {
    await render('')
    const text = 'missed events '.repeat(100)
    await render(text)
    await visibility(false)
    expect(container.textContent).toBe(text)
    expectIdle()
  })

  it('shows replaced text immediately and finishes a stopped live tail within the deadline', async () => {
    await render('old ')
    await render(`old ${'pending '.repeat(10)}`)
    await render('interrupted', false)
    expect(container.textContent).toBe('interrupted')
    expectIdle()
    await render('latest cached text', false)
    await render('latest cached text', true)
    expect(container.textContent).toBe('latest cached text')
    expectIdle()
    await render('latest cached text with growth')
    expect(container.textContent).toBe('latest cached text')
    const stoppedAt = now
    await render('latest cached text with growth', false)
    await framesUntil(() => container.textContent === 'latest cached text with growth')
    expect(container.textContent).toBe('latest cached text with growth')
    expect(now - stoppedAt).toBeLessThanOrEqual(MAX_FINISH_MS)
    await framesUntil(() => frames.size === 0, 400)
    expectIdle()
  })

  it('lets a settled renderer that replaces the live one continue its unfinished tail', async () => {
    const live = `answer ${'z'.repeat(100)}`
    // The store moves live text into a persisted block in one update, so the
    // live renderer unmounts in the same commit the settled one mounts.
    const swap = (settled: boolean, text = live) => createElement(
      'section',
      null,
      settled
        ? createElement(Probe, { key: 'persisted-block', text, streaming: false })
        : createElement(Probe, { key: 'live-assistant', text, streaming: true })
    )
    await act(async () => root.render(swap(false, 'answer ')))
    await act(async () => root.render(swap(false)))
    await frame()
    await frame(60)
    const partial = container.textContent!
    expect(partial.length).toBeGreaterThan('answer '.length)
    expect(partial.length).toBeLessThan(live.length)

    await act(async () => root.render(swap(true)))
    expect(container.textContent).toBe(partial)
    expect(container.firstElementChild?.firstElementChild?.getAttribute('data-fading')).toBe('true')
    await framesUntil(() => container.textContent === live)
    expect(container.textContent).toBe(live)
    await framesUntil(() => frames.size === 0, 400)
    expectIdle()
  })

  it('shows settled text in full when nothing unfinished matches it', async () => {
    await render('unrelated live text ')
    await render(`unrelated live text ${'q'.repeat(100)}`)
    await frame()
    await act(async () => root.render(createElement(Probe, { key: 'other', text: 'a different settled answer', streaming: false })))
    expect(container.textContent).toBe('a different settled answer')
  })

  it('replaces shortened or corrected live text without a stale prefix', async () => {
    await render('old snapshot')
    await render('old snapshot appended')
    await render('new snapshot')
    expect(container.textContent).toBe('new snapshot')
    expectIdle()
    await render('new')
    expect(container.textContent).toBe('new')
    expectIdle()
  })

  it('catches up a delayed frame in one paint', async () => {
    await render('')
    const text = 'x'.repeat(100)
    await render(text)
    await frame()
    await frame(5000)
    expect(container.textContent).toBe(text)
    await frame(400)
    expectIdle()
  })

  it('uses the timer when frames stop and cancels the losing frame callbacks', async () => {
    await render('')
    const text = 'x'.repeat(100)
    await render(text)
    for (let index = 0; index < 60 && vi.getTimerCount() > 0; index += 1) {
      now += 48
      await act(async () => { await vi.advanceTimersByTimeAsync(48) })
    }
    expect(container.textContent).toBe(text)
    expect(frames.size).toBeLessThanOrEqual(1)
    expect(vi.getTimerCount()).toBe(0)
  })

  it('cancels both clocks and removes visibility listeners on unmount', async () => {
    const remove = vi.spyOn(document, 'removeEventListener')
    await render('')
    await render('x'.repeat(100))
    expect(frames.size).toBe(1)
    expect(vi.getTimerCount()).toBe(1)
    await act(async () => root.render(null))
    expectIdle()
    expect(remove).toHaveBeenCalledWith('visibilitychange', expect.any(Function))
  })
})
