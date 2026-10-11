// @vitest-environment jsdom

import { act, createElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { useAssistantTextReveal } from './use-assistant-text-reveal'

function Probe({ text, streaming }: { text: string; streaming: boolean }) {
  return createElement('div', null, useAssistantTextReveal(text, streaming))
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

  it('paints the full initial history or already-running response with no idle loop', async () => {
    const history = 'history '.repeat(20_000)
    await render(history)
    expect(container.textContent).toBe(history)
    expectIdle()
    await render(`${history} completed`, false)
    expect(container.textContent).toBe(`${history} completed`)
    expectIdle()
  })

  it('paces ordinary live growth but finishes one burst within a short deadline', async () => {
    await render('prefix ')
    const text = `prefix ${'a'.repeat(1000)}`
    await render(text)
    expect(container.textContent).toBe('prefix ')
    await frame()
    expect(container.textContent!.length).toBeGreaterThan(7)
    expect(container.textContent!.length).toBeLessThan(text.length)
    for (let index = 0; index < 12; index += 1) await frame()
    expect(container.textContent).toBe(text)
    expectIdle()
  })

  it('does not restart the frame clock or pending deadline on each incoming delta', async () => {
    await render('')
    let text = 'a'.repeat(500)
    await render(text)
    const firstFrame = [...frames.keys()][0]
    for (let index = 0; index < 10; index += 1) {
      now += 5
      text += 'b'
      await render(text)
    }
    expect([...frames.keys()][0]).toBe(firstFrame)
    await frame(160)
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
    const live = `before ${'x'.repeat(500)}`
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

  it('shows completed or interrupted text immediately and establishes a fresh streaming baseline', async () => {
    await render('old ')
    await render(`old ${'pending '.repeat(100)}`)
    await render('interrupted', false)
    expect(container.textContent).toBe('interrupted')
    expectIdle()
    await render('latest cached text', false)
    await render('latest cached text', true)
    expect(container.textContent).toBe('latest cached text')
    expectIdle()
    await render('latest cached text with growth')
    expect(container.textContent).toBe('latest cached text')
    await render('latest cached text with growth', false)
    expect(container.textContent).toBe('latest cached text with growth')
    expectIdle()
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
    const text = 'x'.repeat(1500)
    await render(text)
    await frame(5000)
    expect(container.textContent).toBe(text)
    expectIdle()
  })

  it('uses the timer when frames stop and cancels the losing frame callbacks', async () => {
    await render('')
    const text = 'x'.repeat(1500)
    await render(text)
    for (let index = 0; index < 5; index += 1) {
      now += 48
      await act(async () => { await vi.advanceTimersByTimeAsync(48) })
    }
    expect(container.textContent).toBe(text)
    expectIdle()
  })

  it('cancels both clocks and removes visibility listeners on unmount', async () => {
    const remove = vi.spyOn(document, 'removeEventListener')
    await render('')
    await render('x'.repeat(1000))
    expect(frames.size).toBe(1)
    expect(vi.getTimerCount()).toBe(1)
    await act(async () => root.render(null))
    expectIdle()
    expect(remove).toHaveBeenCalledWith('visibilitychange', expect.any(Function))
  })
})
