import { create } from 'zustand'

const STORAGE_KEY = 'kun.work.assistantMain.v1'

function readStored(): boolean {
  try {
    return window.localStorage.getItem(STORAGE_KEY) === '1'
  } catch {
    return false
  }
}

/**
 * Work has two slots: the main area and the side panel. By default files own
 * the main area and the session sits in the side panel; with `assistantMain`
 * the session takes the main area and the open files dock to the side. Only
 * matters while something is open; with nothing open the session is main.
 */
type WorkSlotsState = {
  assistantMain: boolean
  setAssistantMain: (value: boolean) => void
  swap: () => void
}

export const useWorkSlotsStore = create<WorkSlotsState>((set, get) => ({
  assistantMain: readStored(),
  setAssistantMain: (value) => {
    if (get().assistantMain === value) return
    try {
      window.localStorage.setItem(STORAGE_KEY, value ? '1' : '0')
    } catch {
      // The preference is a convenience; losing it is harmless.
    }
    set({ assistantMain: value })
  },
  swap: () => get().setAssistantMain(!get().assistantMain)
}))
