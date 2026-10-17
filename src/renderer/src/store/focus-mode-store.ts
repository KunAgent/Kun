import { create } from 'zustand'
import { readFocusModePreference, writeFocusModePreference } from '../lib/focus-mode'

type FocusModeState = {
  enabled: boolean
  setEnabled: (enabled: boolean) => void
}

/**
 * Focus mode is one app-wide preference: the sidebar switch and the
 * what's-new card both flip it, and the workbench reads it from here.
 */
export const useFocusModeStore = create<FocusModeState>((set) => ({
  enabled: readFocusModePreference(),
  setEnabled: (enabled) => {
    writeFocusModePreference(enabled)
    set({ enabled })
  }
}))
