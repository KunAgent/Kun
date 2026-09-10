import { create } from 'zustand'

/**
 * Which Speak recordings exist on disk.
 *
 * Every assistant answer renders a Speak action, so the set of stored keys is
 * loaded once and shared, rather than asking the Main process per bubble.
 */
type SpeakTrackStoreState = {
  /** Keys of stored recordings; null until the first read lands. */
  keys: Set<string> | null
  setKeys: (keys: string[]) => void
  addKey: (key: string) => void
  clearKeys: () => void
}

export const useSpeakTrackStore = create<SpeakTrackStoreState>((set) => ({
  keys: null,
  setKeys: (keys) => set({ keys: new Set(keys) }),
  addKey: (key) =>
    set((state) => ({ keys: new Set(state.keys ? [...state.keys, key] : [key]) })),
  clearKeys: () => set({ keys: new Set() })
}))

/** True when this recording is known to be on disk. */
export function speakTrackStored(keys: Set<string> | null, key: string | null): boolean {
  return Boolean(key && keys?.has(key))
}

let loading = false

/**
 * Load the stored keys once. Repeat calls are ignored, so mounting any number
 * of answers costs a single read.
 */
export function ensureSpeakTrackKeys(): void {
  if (loading || typeof window === 'undefined') return
  if (typeof window.kunGui?.listLocalKokoroTrackKeys !== 'function') return
  loading = true
  void window.kunGui
    .listLocalKokoroTrackKeys()
    .then((keys) => useSpeakTrackStore.getState().setKeys(keys))
    .catch(() => {
      loading = false
    })
}

/** Reload the keys after they change outside the normal Speak flow. */
export function refreshSpeakTrackKeys(): void {
  if (typeof window.kunGui?.listLocalKokoroTrackKeys !== 'function') return
  void window.kunGui
    .listLocalKokoroTrackKeys()
    .then((keys) => useSpeakTrackStore.getState().setKeys(keys))
    .catch(() => undefined)
}
