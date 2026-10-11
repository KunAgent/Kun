import { create } from 'zustand'
import { browserStorage, type BrowserStorageLike } from '../../lib/browser-storage'

/**
 * Bumped whenever the tour changes enough that everyone should see it again.
 * v1 = new task / projects / where / composer controls / conversations.
 */
const CODE_TOUR_STORAGE_KEY = 'kun.code.tour.v1'
/**
 * Set when the first-run setup finishes, so the tour greets people who just
 * installed Kun. Profiles that never ran setup (upgrades, test harnesses) only
 * get the tour from its replay button.
 */
const CODE_TOUR_PENDING_KEY = 'kun.code.tour.pending'

export type CodeTourPhase = 'idle' | 'welcome' | 'coach' | 'done'

type CodeTourState = {
  phase: CodeTourPhase
  /** Index into the coach steps whose targets were on screen when the tour began. */
  step: number
  /** One-time pointer at the replay button after the tour closes. */
  hint: boolean
  open: () => void
  startCoach: () => void
  goTo: (step: number) => void
  showDone: () => void
  /** Closes the tour from any phase and remembers that it was seen. */
  close: () => void
  dismissHint: () => void
}

export function readCodeTourSeen(storage: BrowserStorageLike | null = browserStorage()): boolean {
  try {
    return storage?.getItem(CODE_TOUR_STORAGE_KEY) === '1'
  } catch {
    return false
  }
}

export function markCodeTourSeen(storage: BrowserStorageLike | null = browserStorage()): void {
  try {
    storage?.setItem(CODE_TOUR_STORAGE_KEY, '1')
    storage?.setItem(CODE_TOUR_PENDING_KEY, '0')
  } catch {
    // Without storage the tour may show again next launch; Code still works.
  }
}

/** First-run setup just finished: greet on the Code home unless this tour version was seen. */
export function markCodeTourPending(storage: BrowserStorageLike | null = browserStorage()): void {
  try {
    if (storage?.getItem(CODE_TOUR_STORAGE_KEY) !== '1') storage?.setItem(CODE_TOUR_PENDING_KEY, '1')
  } catch {
    // The replay button still opens the tour.
  }
}

/** Whether the tour should open on its own the next time the Code home settles. */
export function readCodeTourDue(storage: BrowserStorageLike | null = browserStorage()): boolean {
  try {
    return storage?.getItem(CODE_TOUR_PENDING_KEY) === '1' && storage?.getItem(CODE_TOUR_STORAGE_KEY) !== '1'
  } catch {
    return false
  }
}

export const useCodeTourStore = create<CodeTourState>((set, get) => ({
  phase: 'idle',
  step: 0,
  hint: false,
  open: () => set({ phase: 'welcome', step: 0, hint: false }),
  startCoach: () => set({ phase: 'coach', step: 0 }),
  goTo: (step) => set({ phase: 'coach', step: Math.max(0, step) }),
  showDone: () => set({ phase: 'done' }),
  close: () => {
    if (get().phase === 'idle') return
    markCodeTourSeen()
    set({ phase: 'idle', step: 0, hint: true })
  },
  dismissHint: () => set({ hint: false })
}))

/** Replay entry (under the home composer): always starts over from the welcome card. */
export function replayCodeTour(): void {
  useCodeTourStore.getState().open()
}
