import { afterEach, describe, expect, it, vi } from 'vitest'
import type { PetCursorSample, ScreenPoint } from '../../shared/pets'
import { PetCursorTracker } from './pet-cursor-tracker'

afterEach(() => vi.useRealTimers())

function createFixture(initial: ScreenPoint = { x: 800, y: 500 }) {
  let point = { ...initial }
  let typing = false
  let overlayInteractive = false
  const samples: PetCursorSample[] = []
  const tracker = new PetCursorTracker({
    cursor: () => point,
    placement: () => ({
      petCenter: { x: 1200, y: 700 },
      workArea: { x: 0, y: 0, width: 1440, height: 900 },
      mascotWidth: 112
    }),
    isTypingActive: () => typing,
    isOverlayInteractive: () => overlayInteractive,
    publish: (sample) => samples.push(sample),
    now: () => Date.now()
  })
  return {
    tracker,
    samples,
    moveTo(x: number, y: number) { point = { x, y } },
    setTyping(active: boolean) { typing = active },
    setOverlayInteractive(active: boolean) { overlayInteractive = active }
  }
}

describe('permissionless pet cursor tracker', () => {
  it('filters sub-pixel sensor jitter, tracks intentional travel, and sleeps with zero IPC when idle', () => {
    vi.useFakeTimers()
    vi.setSystemTime(1000)
    const f = createFixture({ x: 600, y: 450 })
    f.tracker.configure(true)

    // Initial baseline sample + sub-2px optical jitter must not emit IPC.
    vi.advanceTimersByTime(35)
    f.moveTo(601, 450.5)
    vi.advanceTimersByTime(125)
    expect(f.samples).toHaveLength(0)

    // Small intentional nudge wakes the idle watch into 30Hz tracking without opening the desk.
    f.moveTo(612, 445)
    vi.advanceTimersByTime(125)
    expect(f.samples).toHaveLength(1)
    expect(f.samples[0].active).toBe(true)
    expect(f.samples[0].gx).toBeLessThan(0)
    expect(f.samples[0].deskActiveAt).toBe(0)

    // Subsequent deliberate sweep (>= 92px) summons the desk at 33ms cadence.
    f.moveTo(730, 410)
    vi.advanceTimersByTime(35)
    expect(f.samples.at(-1)?.deskActiveAt).toBeGreaterThan(0)

    // Stationary cursor settles once after 2.4s and stops emitting further IPC.
    const countBeforeIdle = f.samples.length
    vi.advanceTimersByTime(2600)
    expect(f.samples.length).toBe(countBeforeIdle + 1)
    expect(f.samples.at(-1)).toMatchObject({ gx: 0, gy: 0, active: false })

    vi.advanceTimersByTime(5000)
    expect(f.samples.length).toBe(countBeforeIdle + 1)

    f.tracker.dispose()
    expect(vi.getTimerCount()).toBe(0)
  })

  it('excludes hovering or clicking over the pet and toolbar from summoning the desk', () => {
    vi.useFakeTimers()
    vi.setSystemTime(2000)
    const f = createFixture({ x: 1180, y: 690 })
    f.tracker.configure(true)
    vi.advanceTimersByTime(35)

    // Entering the mascot body reports overMascot + local coordinates for unfocused macOS hover/head-pat wakeup.
    expect(f.samples).toHaveLength(1)
    expect(f.samples[0]).toMatchObject({ overMascot: true, deskActiveAt: 0 })
    expect(f.samples[0].localX).toBeLessThan(0)
    expect(f.samples[0].localY).toBeLessThan(0)

    // Moving across the pet and its bottom toolbar (dist ~ 110px < 136px) updates gaze, clears overMascot, and keeps deskActiveAt at 0.
    f.moveTo(1200, 810)
    vi.advanceTimersByTime(125)
    expect(f.samples.at(-1)?.active).toBe(true)
    expect(f.samples.at(-1)?.overMascot).toBeUndefined()
    expect(f.samples.at(-1)?.deskActiveAt).toBe(0)

    // Clicking while overlay UI is interactive (e.g. context menu at 180px) also keeps deskActiveAt at 0.
    f.setOverlayInteractive(true)
    f.moveTo(1380, 720)
    f.tracker.noteMouse(-1, 1, 0, true)
    expect(f.samples.at(-1)?.deskActiveAt).toBe(0)
    f.tracker.dispose()
  })

  it('raises movement threshold while typing and deduplicates in-app clicks when global input is active', () => {
    vi.useFakeTimers()
    vi.setSystemTime(5000)
    const f = createFixture({ x: 500, y: 400 })
    f.setTyping(true)
    f.tracker.configure(true)
    vi.advanceTimersByTime(35)

    // A 30px wrist bump while typing does not steal the mouse paw.
    f.moveTo(530, 400)
    vi.advanceTimersByTime(125)
    expect(f.samples.at(-1)?.deskActiveAt).toBe(0)

    // Authoritative global mouse click updates buttons and wheel; local sender is ignored while global is active.
    f.tracker.noteMouse(-1, 1, 0, true)
    expect(f.samples.at(-1)).toMatchObject({ buttons: 1, clickSeq: 1, clickMask: 1, clickedAt: 5160, active: true, deskActiveAt: 5160 })
    const count = f.samples.length
    f.tracker.noteMouse(2, 2, 1, true)
    expect(f.samples.length).toBe(count)

    // Releasing after a long button hold refreshes deskActiveAt and preserves the last clickSeq/clickMask for sub-frame tap recovery.
    vi.advanceTimersByTime(2500)
    f.tracker.noteMouse(-1, 0, 0, true)
    expect(f.samples.at(-1)).toMatchObject({ buttons: 0, clickSeq: 1, clickMask: 1, deskActiveAt: 7660 })

    f.tracker.noteMouse(-1, 0, -1, true)
    expect(f.samples.at(-1)).toMatchObject({ buttons: 0, wheelSeq: 1, wheelDir: -1 })
    f.tracker.dispose()
  })
})
