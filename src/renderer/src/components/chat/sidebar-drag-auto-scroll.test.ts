/** @vitest-environment jsdom */
import { describe, expect, it, vi } from 'vitest'
import {
  createSidebarDragAutoScroller,
  registerSidebarDragAutoScroll,
  SIDEBAR_DRAG_SCROLL_ATTRIBUTE,
  sidebarDragScrollVelocity,
  type SidebarDragAutoScroller
} from './sidebar-drag-auto-scroll'

describe('sidebarDragScrollVelocity', () => {
  const top = 100
  const bottom = 500
  const edge = 50
  const speed = 600

  it('is zero in the middle of the container', () => {
    expect(sidebarDragScrollVelocity(300, top, bottom, edge, speed)).toBe(0)
    expect(sidebarDragScrollVelocity(151, top, bottom, edge, speed)).toBe(0)
    expect(sidebarDragScrollVelocity(449, top, bottom, edge, speed)).toBe(0)
  })

  it('scrolls up near the top edge and down near the bottom edge', () => {
    expect(sidebarDragScrollVelocity(120, top, bottom, edge, speed)).toBeLessThan(0)
    expect(sidebarDragScrollVelocity(480, top, bottom, edge, speed)).toBeGreaterThan(0)
  })

  it('ramps up towards the edge and clamps beyond it', () => {
    const atEdge = sidebarDragScrollVelocity(top, top, bottom, edge, speed)
    expect(atEdge).toBe(-speed)
    expect(sidebarDragScrollVelocity(top - 30, top, bottom, edge, speed)).toBe(-speed)
    expect(sidebarDragScrollVelocity(bottom, top, bottom, edge, speed)).toBe(speed)
    const halfway = sidebarDragScrollVelocity(top + edge / 2, top, bottom, edge, speed)
    expect(halfway).toBeGreaterThan(-speed)
    expect(halfway).toBeLessThan(0)
  })

  it('keeps a visible minimum speed at the threshold boundary', () => {
    expect(sidebarDragScrollVelocity(150, top, bottom, edge, speed)).toBe(-speed * 0.2)
    expect(sidebarDragScrollVelocity(450, top, bottom, edge, speed)).toBe(speed * 0.2)
  })

  it('returns zero for degenerate geometry', () => {
    expect(sidebarDragScrollVelocity(100, 100, 100, edge, speed)).toBe(0)
    expect(sidebarDragScrollVelocity(100, top, bottom, 0, speed)).toBe(0)
  })
})

describe('createSidebarDragAutoScroller', () => {
  function createHarness(scrollTop = 0) {
    const container = {
      scrollTop,
      getBoundingClientRect: () => ({ top: 100, bottom: 500 })
    } as unknown as HTMLElement
    const frames: Array<() => void> = []
    let currentTime = 0
    const scroller = createSidebarDragAutoScroller(container, {
      edgeSize: 50,
      maxSpeed: 600,
      now: () => currentTime,
      requestFrame: (callback) => {
        frames.push(callback)
        return frames.length
      },
      cancelFrame: () => {
        frames.length = 0
      }
    })
    return {
      container,
      scroller,
      advance(ms: number) {
        currentTime += ms
        const pending = [...frames]
        frames.length = 0
        for (const callback of pending) callback()
      }
    }
  }

  it('scrolls up continuously while the pointer rests near the top edge', () => {
    const { container, scroller, advance } = createHarness(300)
    scroller.update(100)
    advance(16)
    expect(container.scrollTop).toBeLessThan(300)
    const afterFirst = container.scrollTop
    advance(16)
    expect(container.scrollTop).toBeLessThan(afterFirst)
  })

  it('scrolls down near the bottom edge and stops when the pointer returns to the middle', () => {
    const { container, scroller, advance } = createHarness(0)
    scroller.update(500)
    advance(16)
    expect(container.scrollTop).toBeGreaterThan(0)
    const before = container.scrollTop
    scroller.update(300)
    advance(16)
    expect(container.scrollTop).toBe(before)
  })

  it('stop cancels a pending frame', () => {
    const { container, scroller } = createHarness(300)
    scroller.update(100)
    scroller.stop()
    expect(container.scrollTop).toBe(300)
  })
})

describe('registerSidebarDragAutoScroll', () => {
  function dispatchDragOver(target: Element, clientY: number): void {
    target.dispatchEvent(new MouseEvent('dragover', { bubbles: true, clientY }))
  }

  function createFixture() {
    document.body.innerHTML = `
      <div id="list" ${SIDEBAR_DRAG_SCROLL_ATTRIBUTE}>
        <div id="row">row</div>
      </div>
      <div id="outside">outside</div>
    `
    const update = vi.fn()
    const stop = vi.fn()
    const createScroller = vi.fn((): SidebarDragAutoScroller => ({ update, stop }))
    const unregister = registerSidebarDragAutoScroll(document, createScroller)
    return { update, stop, createScroller, unregister }
  }

  it('starts a scroller for the marked container and forwards the pointer position', () => {
    const { update, createScroller, unregister } = createFixture()
    const list = document.getElementById('list')!
    const row = document.getElementById('row')!
    dispatchDragOver(row, 123)
    expect(createScroller).toHaveBeenCalledWith(list)
    expect(update).toHaveBeenCalledWith(123)
    unregister()
  })

  it('stops the active scroller when the pointer leaves the container, on drop and on dragend', () => {
    const { stop, unregister } = createFixture()
    const row = document.getElementById('row')!
    const outside = document.getElementById('outside')!
    dispatchDragOver(row, 100)
    dispatchDragOver(outside, 100)
    expect(stop).toHaveBeenCalledTimes(1)
    dispatchDragOver(row, 100)
    row.dispatchEvent(new MouseEvent('drop', { bubbles: true }))
    expect(stop).toHaveBeenCalledTimes(2)
    dispatchDragOver(row, 100)
    row.dispatchEvent(new MouseEvent('dragend', { bubbles: true }))
    expect(stop).toHaveBeenCalledTimes(3)
    unregister()
  })

  it('observes drags in capture phase even when a row stops propagation', () => {
    const { update, unregister } = createFixture()
    const row = document.getElementById('row')!
    row.addEventListener('dragover', (event) => event.stopPropagation())
    dispatchDragOver(row, 42)
    expect(update).toHaveBeenCalledWith(42)
    unregister()
  })
})
