import { create } from 'zustand'

export type KunPresenceState = 'generating' | 'queued'

type PresenceEntry = { state: KunPresenceState; name: string }

type KunPresenceStore = {
  entries: Record<string, PresenceEntry>
  /** Largest number of boards active at once since the last idle moment. */
  runTotal: number
  report: (shapeId: string, entry: PresenceEntry | null) => void
}

/**
 * Which boards Kun is writing or about to write, reported by each board's
 * overlay. The canvas-level cursor and progress bar read from here.
 */
export const useKunPresenceStore = create<KunPresenceStore>((set) => ({
  entries: {},
  runTotal: 0,
  report: (shapeId, entry) => {
    set((state) => {
      const current = state.entries[shapeId]
      if (!entry && !current) return state
      if (entry && current && current.state === entry.state && current.name === entry.name) return state
      const entries = { ...state.entries }
      if (entry) entries[shapeId] = entry
      else delete entries[shapeId]
      const active = Object.keys(entries).length
      return { entries, runTotal: active === 0 ? 0 : Math.max(state.runTotal, active) }
    })
  }
}))
