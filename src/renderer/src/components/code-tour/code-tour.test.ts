import { describe, expect, it } from 'vitest'
import { placeCoach, spotFor, toOverlayBox } from './code-tour-geometry'
import { markCodeTourPending, markCodeTourSeen, readCodeTourDue, readCodeTourSeen, useCodeTourStore } from './code-tour-store'

const viewport = { width: 1440, height: 900 }
const pop = { width: 360, height: 190 }

function memoryStorage(): { getItem: (key: string) => string | null; setItem: (key: string, value: string) => void } {
  const values = new Map<string, string>()
  return { getItem: (key) => values.get(key) ?? null, setItem: (key, value) => { values.set(key, value) } }
}

describe('code tour geometry', () => {
  it('maps zoomed client rects back into overlay pixels', () => {
    // body zoom 0.82: the overlay is 1440 layout px wide but 1180.8 px on screen.
    const box = toOverlayBox({ left: 82, top: 41, width: 164, height: 82 }, { left: 0, top: 0, width: 1180.8, height: 738 }, 1440)
    expect(box.left).toBeCloseTo(100)
    expect(box.top).toBeCloseTo(50)
    expect(box.width).toBeCloseTo(200)
    expect(box.height).toBeCloseTo(100)
  })

  it('pads the spot and caps a tall project list', () => {
    const spot = spotFor({ left: 12, top: 260, width: 240, height: 600 }, viewport)
    expect(spot.left).toBe(6)
    expect(spot.top).toBe(254)
    expect(spot.height).toBe(220)
  })

  it('puts sidebar steps to the right of the target', () => {
    const placement = placeCoach({ left: 12, top: 92, width: 240, height: 40 }, viewport, pop, 'right')
    expect(placement.side).toBe('right')
    expect(placement.popover.left).toBe(6 + 252 + 14)
    expect(placement.popover.top).toBe(86)
  })

  it('puts the composer step above it and flips below when there is no room', () => {
    const above = placeCoach({ left: 492, top: 600, width: 720, height: 150 }, viewport, pop, 'top')
    expect(above.side).toBe('top')
    expect(above.popover.top).toBe(594 - 14 - 190)
    const below = placeCoach({ left: 492, top: 60, width: 720, height: 150 }, viewport, pop, 'top')
    expect(below.side).toBe('bottom')
  })

  it('keeps the bubble inside a narrow window', () => {
    const placement = placeCoach({ left: 12, top: 92, width: 240, height: 40 }, { width: 520, height: 700 }, pop, 'right')
    expect(placement.popover.left + pop.width).toBeLessThanOrEqual(520 - 12)
  })
})

describe('code tour store', () => {
  it('remembers that the tour was seen', () => {
    const storage = memoryStorage()
    expect(readCodeTourSeen(storage)).toBe(false)
    markCodeTourSeen(storage)
    expect(readCodeTourSeen(storage)).toBe(true)
  })

  it('opens by itself only after first-run setup, and only until seen', () => {
    const storage = memoryStorage()
    expect(readCodeTourDue(storage)).toBe(false)
    markCodeTourPending(storage)
    expect(readCodeTourDue(storage)).toBe(true)
    markCodeTourSeen(storage)
    expect(readCodeTourDue(storage)).toBe(false)
    markCodeTourPending(storage)
    expect(readCodeTourDue(storage)).toBe(false)
  })

  it('walks welcome → steps → done and closes with the replay hint', () => {
    const store = useCodeTourStore.getState()
    store.open()
    expect(useCodeTourStore.getState().phase).toBe('welcome')
    store.startCoach()
    store.goTo(2)
    expect(useCodeTourStore.getState()).toMatchObject({ phase: 'coach', step: 2 })
    store.showDone()
    store.close()
    expect(useCodeTourStore.getState()).toMatchObject({ phase: 'idle', hint: true })
    store.dismissHint()
    expect(useCodeTourStore.getState().hint).toBe(false)
  })
})

describe('code tour content', () => {
  it('has a title and body for every step in every locale', async () => {
    const { CODE_TOUR_STEPS } = await import('./code-tour-geometry')
    for (const locale of ['zh', 'en', 'ja', 'ko', 'ru', 'hi', 'th']) {
      const strings = (await import(`../../locales/${locale}/common/code-tour.json`)).default as Record<string, string>
      for (const step of CODE_TOUR_STEPS) {
        expect(strings[`codeTourStep_${step.id}_title`], `${locale} ${step.id}`).toBeTruthy()
        expect(strings[`codeTourStep_${step.id}_body`], `${locale} ${step.id}`).toBeTruthy()
      }
    }
  })
})
