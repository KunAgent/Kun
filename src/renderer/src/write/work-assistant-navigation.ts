import { create } from 'zustand'

export type WorkAssistantSurface = 'assistant' | 'workspace'
type NavigationState = {
  surface: WorkAssistantSurface
  previous: WorkAssistantSurface | null
  docked: boolean
  dockAssistant: () => void
  openAssistant: () => void
  openWorkspace: () => void
  back: () => void
}

// Presentation only. Never changes startup mode, active document, thread,
// draft, attachment state or runtime execution. Work opens here by default.
let returnFocus: HTMLElement | null = null
export const useWorkAssistantNavigation = create<NavigationState>((set, get) => ({
  surface: 'assistant',
  previous: null,
  docked: false,
  dockAssistant: () => {
    set({ surface: 'workspace', previous: 'assistant', docked: true })
  },
  openAssistant: () => {
    if (get().surface === 'assistant') return
    returnFocus = typeof document !== 'undefined' && document.activeElement instanceof HTMLElement
      ? document.activeElement : null
    set({ surface: 'assistant', previous: 'workspace', docked: false })
  },
  openWorkspace: () => {
    if (get().surface === 'workspace' && !get().docked) return
    set({ surface: 'workspace', previous: 'assistant', docked: false })
    if (typeof window !== 'undefined' && returnFocus) (window.requestAnimationFrame ?? ((callback: FrameRequestCallback) => window.setTimeout(callback, 0)))(() => {
      if (returnFocus?.isConnected) returnFocus.focus({ preventScroll: true })
      returnFocus = null
    })
  },
  back: () => {
    if (get().previous === 'workspace') get().openWorkspace()
    else if (get().previous === 'assistant') get().openAssistant()
  }
}))
