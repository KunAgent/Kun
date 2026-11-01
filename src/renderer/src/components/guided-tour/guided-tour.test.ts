// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { placeCoach, spotFor, toOverlayBox } from './guided-tour-geometry'
import {
  markOverviewTourPending,
  markTourSeen,
  overviewReplacesNotice,
  readModeTourDue,
  readOverviewTourDue,
  readTourSeen,
  useGuidedTourStore
} from './guided-tour-store'
import { currentGuidedMode, GUIDED_TOURS } from './guided-tour-steps'
import { dueGuidedTour } from './GuidedTourHost'

const viewport = { width: 1440, height: 900 }
const pop = { width: 340, height: 190 }

function memoryStorage(): { getItem: (key: string) => string | null; setItem: (key: string, value: string) => void } {
  const values = new Map<string, string>()
  return { getItem: (key) => values.get(key) ?? null, setItem: (key, value) => { values.set(key, value) } }
}

/** jsdom has no layout: give every element a visible box so the tours can find their targets. */
function withLayout(): void {
  HTMLElement.prototype.getBoundingClientRect = function () {
    return { left: 10, top: 10, width: 120, height: 32, right: 130, bottom: 42, x: 10, y: 10, toJSON: () => ({}) } as DOMRect
  }
}

function mountModePill(mode: 'chat' | 'write' | 'chats'): void {
  document.body.innerHTML = `
    <div data-workspace-mode-trigger data-workspace-mode="${mode}">
      <button class="kun-mode-tab" data-workspace-mode="chat"></button>
      <button class="kun-mode-tab" data-workspace-mode="write"></button>
      <button class="kun-mode-tab" data-workspace-mode="chats"></button>
    </div>`
}

describe('guided tour geometry', () => {
  it('maps zoomed client rects back into overlay pixels', () => {
    // body zoom 0.82: the overlay is 1440 layout px wide but 1180.8 px on screen.
    const box = toOverlayBox({ left: 82, top: 41, width: 164, height: 82 }, { left: 0, top: 0, width: 1180.8, height: 738 }, 1440)
    expect(box.left).toBeCloseTo(100)
    expect(box.top).toBeCloseTo(50)
    expect(box.width).toBeCloseTo(200)
    expect(box.height).toBeCloseTo(100)
  })

  it('pads the spot and caps a tall list', () => {
    const spot = spotFor({ left: 12, top: 260, width: 240, height: 600 }, viewport)
    expect(spot.left).toBe(6)
    expect(spot.top).toBe(254)
    expect(spot.height).toBe(260)
  })

  it('puts sidebar steps to the right of the target', () => {
    const placement = placeCoach({ left: 12, top: 92, width: 240, height: 40 }, viewport, pop, 'right')
    expect(placement.side).toBe('right')
    expect(placement.popover.left).toBe(6 + 252 + 14)
    expect(placement.popover.top).toBe(86)
  })

  it('puts a composer step above it and flips below when there is no room', () => {
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

describe('guided tour storage', () => {
  it('shows the overview once after first-run setup, then arms the mode tours', () => {
    const storage = memoryStorage()
    expect(readOverviewTourDue(storage)).toBe(false)
    expect(readModeTourDue('work', storage)).toBe(false)
    markOverviewTourPending(storage)
    expect(readOverviewTourDue(storage)).toBe(true)
    markTourSeen('overview', storage)
    expect(readOverviewTourDue(storage)).toBe(false)
    expect(readModeTourDue('work', storage)).toBe(true)
    markTourSeen('work', storage)
    expect(readModeTourDue('work', storage)).toBe(false)
    expect(readModeTourDue('chats', storage)).toBe(true)
    markOverviewTourPending(storage)
    expect(readOverviewTourDue(storage)).toBe(false)
  })

  it('stands in for the what\'s-new dialog only when an update crosses the redesign', () => {
    const storage = memoryStorage()
    expect(overviewReplacesNotice({ version: '0.4.4', previousVersion: '0.4.3' }, storage)).toBe(true)
    expect(overviewReplacesNotice({ version: '0.5.0', previousVersion: '0.3.8' }, storage)).toBe(true)
    expect(overviewReplacesNotice({ version: '0.4.5', previousVersion: '0.4.4' }, storage)).toBe(false)
    expect(overviewReplacesNotice({ version: '0.4.3', previousVersion: '0.3.8' }, storage)).toBe(false)
    // Reopened from Settings: no previous version.
    expect(overviewReplacesNotice({ version: '0.4.4' }, storage)).toBe(false)
    markTourSeen('overview', storage)
    expect(overviewReplacesNotice({ version: '0.4.4', previousVersion: '0.4.3' }, storage)).toBe(false)
  })
})

describe('guided tour scheduling', () => {
  beforeEach(() => {
    localStorage.clear()
    withLayout()
    useGuidedTourStore.setState({ active: null, step: 0, hint: false, requested: null, quietMode: null, hubOpen: false })
  })
  afterEach(() => { document.body.innerHTML = '' })

  it('reads the open mode from the mode pill', () => {
    mountModePill('write')
    expect(currentGuidedMode()).toBe('work')
    mountModePill('chats')
    expect(currentGuidedMode()).toBe('chats')
  })

  it('starts nothing for a profile that never ran setup or crossed the redesign', () => {
    mountModePill('chat')
    expect(dueGuidedTour()).toBeNull()
  })

  it('greets with the overview, then the open mode waits until the user comes back to it', () => {
    mountModePill('chat')
    markOverviewTourPending()
    expect(dueGuidedTour()).toBe('overview')
    useGuidedTourStore.getState().start('overview')
    useGuidedTourStore.getState().close()
    expect(readTourSeen('overview')).toBe(true)
    expect(useGuidedTourStore.getState()).toMatchObject({ active: null, hint: true, quietMode: 'code' })
    document.body.insertAdjacentHTML('beforeend', '<div data-primary-floating-composer></div>')
    expect(dueGuidedTour()).toBeNull()
    // Leaving for Work and back clears the quiet mode (the host does this on its next check).
    useGuidedTourStore.getState().clearQuietMode()
    expect(dueGuidedTour()).toBe('code')
  })

  it('starts the mode picked on the overview once that mode is on screen', () => {
    mountModePill('chat')
    markOverviewTourPending()
    const store = useGuidedTourStore.getState()
    store.start('overview')
    store.request('work')
    store.close()
    expect(useGuidedTourStore.getState()).toMatchObject({ hint: false, requested: 'work' })
    expect(dueGuidedTour()).toBeNull()
    mountModePill('write')
    expect(dueGuidedTour()).toBeNull()
    document.body.insertAdjacentHTML('beforeend', '<aside data-work-assistant><div data-floating-composer></div></aside>')
    expect(dueGuidedTour()).toBe('work')
    useGuidedTourStore.getState().start('work')
    expect(useGuidedTourStore.getState().requested).toBeNull()
  })
})

describe('guided tour content', () => {
  it('starts every tour with an intro and ends it with a last card', () => {
    for (const tour of Object.values(GUIDED_TOURS)) {
      expect(tour.steps[0]?.kind, tour.id).toBe('intro')
      expect(tour.steps[tour.steps.length - 1]?.kind, tour.id).toBe('last')
      expect(new Set(tour.steps.map((step) => step.id)).size, tour.id).toBe(tour.steps.length)
    }
  })

  it('has a title and body for every step in every locale', async () => {
    for (const locale of ['zh', 'en', 'ja', 'ko', 'ru', 'hi', 'th']) {
      const strings = (await import(`../../locales/${locale}/common/guided-tours.json`)).default as Record<string, string>
      for (const tour of Object.values(GUIDED_TOURS)) {
        for (const step of tour.steps) {
          expect(strings[`guidedTour_${tour.id}_${step.id}_title`], `${locale} ${tour.id} ${step.id}`).toBeTruthy()
          expect(strings[`guidedTour_${tour.id}_${step.id}_body`], `${locale} ${tour.id} ${step.id}`).toBeTruthy()
        }
        expect(strings[`guidedTourHub_${tour.id}`], `${locale} hub ${tour.id}`).toBeTruthy()
      }
    }
  })
})
