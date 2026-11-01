import { create } from 'zustand'
import { browserStorage, type BrowserStorageLike } from '../../lib/browser-storage'
import { compareVersions } from '@shared/release-notes-summary'
import type { ReleaseNotice } from '@shared/release-notice'
import { currentGuidedMode, type GuidedModeTourId, type GuidedTourId } from './guided-tour-steps'

/**
 * Bump a key whenever its tour changes enough that everyone should see it again.
 * code v2 = mode tab, new task, projects, where, controls, right panel (v1 ended on conversations,
 * which moved to their own 对话 mode).
 */
const SEEN_KEYS: Record<GuidedTourId, string> = {
  overview: 'kun.tour.overview.v1',
  code: 'kun.code.tour.v2',
  work: 'kun.work.tour.v1',
  chats: 'kun.chats.tour.v1'
}
/** First-run setup finished: greet with the overview on the next settled screen. */
const OVERVIEW_PENDING_KEY = 'kun.tour.overview.pending'
/**
 * Set once the overview closes. From then on each mode's tour starts the first time that mode
 * opens. Profiles that never saw the overview (test harnesses, old installs before the redesign
 * release) only get tours from the ? list.
 */
const MODES_ARMED_KEY = 'kun.tour.modes.armed'

/** The release that brought the Code / Work / 对话 layout; upgrading across it shows the overview. */
export const OVERVIEW_TOUR_RELEASE = '0.4.4'

function read(storage: BrowserStorageLike | null, key: string): string | null {
  try {
    return storage?.getItem(key) ?? null
  } catch {
    return null
  }
}

function write(storage: BrowserStorageLike | null, key: string, value: string): void {
  try {
    storage?.setItem(key, value)
  } catch {
    // Without storage a tour may show again next launch; the app still works.
  }
}

export function readTourSeen(id: GuidedTourId, storage: BrowserStorageLike | null = browserStorage()): boolean {
  return read(storage, SEEN_KEYS[id]) === '1'
}

export function markTourSeen(id: GuidedTourId, storage: BrowserStorageLike | null = browserStorage()): void {
  write(storage, SEEN_KEYS[id], '1')
  if (id === 'overview') {
    write(storage, OVERVIEW_PENDING_KEY, '0')
    write(storage, MODES_ARMED_KEY, '1')
  }
}

/** First-run setup just finished, or an update crossed the redesign: show the overview once. */
export function markOverviewTourPending(storage: BrowserStorageLike | null = browserStorage()): void {
  if (!readTourSeen('overview', storage)) write(storage, OVERVIEW_PENDING_KEY, '1')
}

export function readOverviewTourDue(storage: BrowserStorageLike | null = browserStorage()): boolean {
  return read(storage, OVERVIEW_PENDING_KEY) === '1' && !readTourSeen('overview', storage)
}

/** Whether this mode's tour should start the first time the mode is open. */
export function readModeTourDue(id: GuidedModeTourId, storage: BrowserStorageLike | null = browserStorage()): boolean {
  return read(storage, MODES_ARMED_KEY) === '1' && !readTourSeen(id, storage)
}

/**
 * The launch notice of an update from before the redesign release: the overview stands in for
 * the what's-new dialog this once, and links to the notes from its last card.
 */
export function overviewReplacesNotice(notice: Pick<ReleaseNotice, 'version' | 'previousVersion'>,
  storage: BrowserStorageLike | null = browserStorage()): boolean {
  if (!notice.previousVersion || readTourSeen('overview', storage)) return false
  return compareVersions(notice.previousVersion, OVERVIEW_TOUR_RELEASE) < 0 &&
    compareVersions(notice.version, OVERVIEW_TOUR_RELEASE) >= 0
}

type GuidedTourState = {
  /** The tour on screen; one at a time. */
  active: GuidedTourId | null
  step: number
  /** One-time pointer at the ? list after a tour closes. */
  hint: boolean
  /** Started from the overview's last card or the ? list; it opens once its mode is on screen. */
  requested: GuidedTourId | null
  /**
   * The mode the overview closed in. Its own tour waits until the user leaves and comes back,
   * so closing one tour never opens another on the same screen.
   */
  quietMode: GuidedModeTourId | null
  /** An update's notes the overview replaced; its last card links to them. */
  releaseNotesWaiting: boolean
  hubOpen: boolean
  start: (id: GuidedTourId) => void
  goTo: (step: number) => void
  close: () => void
  request: (id: GuidedTourId) => void
  clearQuietMode: () => void
  setReleaseNotesWaiting: (waiting: boolean) => void
  setHubOpen: (open: boolean) => void
  dismissHint: () => void
}

export const useGuidedTourStore = create<GuidedTourState>((set, get) => ({
  active: null,
  step: 0,
  hint: false,
  requested: null,
  quietMode: null,
  releaseNotesWaiting: false,
  hubOpen: false,
  start: (id) => set({ active: id, step: 0, hint: false, hubOpen: false, requested: null }),
  goTo: (step) => set({ step: Math.max(0, step) }),
  close: () => {
    const { active, requested } = get()
    if (!active) return
    markTourSeen(active)
    set({
      active: null,
      step: 0,
      // A mode picked on the overview's last card starts its own tour next; no hint in between.
      hint: requested === null,
      quietMode: active === 'overview' && requested === null ? currentModeOrNull() : get().quietMode
    })
  },
  request: (id) => set({ requested: id, quietMode: null }),
  clearQuietMode: () => set({ quietMode: null }),
  setReleaseNotesWaiting: (waiting) => set({ releaseNotesWaiting: waiting }),
  setHubOpen: (open) => set({ hubOpen: open }),
  dismissHint: () => set({ hint: false })
}))

function currentModeOrNull(): GuidedModeTourId | null {
  return typeof document === 'undefined' ? null : currentGuidedMode()
}

/** Replay entries (the ? list, Code's chip): start over from the tour's first card. */
export function startGuidedTour(id: GuidedTourId): void {
  useGuidedTourStore.getState().request(id)
}
