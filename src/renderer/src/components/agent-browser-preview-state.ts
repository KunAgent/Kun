import { create } from 'zustand'
import type { BrowserUseViewState } from '@shared/browser-use'
import type { BrowserPreviewGeometry } from './agent-browser-preview-layout'

export function isBrowserUseSessionActive(state: BrowserUseViewState, threadId: string | null): boolean {
  return Boolean(threadId && state.threadId === threadId && state.sessionId && state.lifecycle !== 'closed')
}

export function browserUsePreviewNeedsAttention(state: BrowserUseViewState, threadId: string | null): boolean {
  return isBrowserUseSessionActive(state, threadId) && Boolean(
    state.lifecycle === 'mount-required' || state.pendingOriginConsent || state.pendingActionConsent
  )
}

export function shouldAutoOpenBrowserUsePreview(state: BrowserUseViewState, threadId: string | null): boolean {
  return browserUsePreviewNeedsAttention(state, threadId) || Boolean(
    isBrowserUseSessionActive(state, threadId) &&
    state.capabilityStatus === 'available' && state.controlOwner === 'agent' && state.tabs.length > 0 &&
    (state.lifecycle === 'ready' || state.lifecycle === 'loading')
  )
}

interface PreviewPresentation {
  sessionId: string
  turnId?: string
  open: boolean
  revealed: boolean
  surface?: 'floating' | 'panel'
  geometry?: BrowserPreviewGeometry
  snapshot?: BrowserUseViewState
}

export type BrowserPreviewOwner = Pick<BrowserUseViewState, 'threadId' | 'sessionId' | 'turnId'>

const sameScope = (presentation: PreviewPresentation | undefined, state: BrowserPreviewOwner): boolean =>
  Boolean(presentation && presentation.sessionId === state.sessionId && presentation.turnId === state.turnId)

interface PreviewStore {
  byThreadId: Record<string, PreviewPresentation>
  observe: (state: BrowserUseViewState, threadId: string) => void
  setOpen: (state: BrowserUseViewState, open: boolean) => void
  setSurface: (state: BrowserPreviewOwner, surface: 'floating' | 'panel', open?: boolean) => void
  setGeometry: (state: BrowserUseViewState, geometry: BrowserPreviewGeometry) => void
}

// Keep a user's choice across navigation; a new browser turn gets one automatic reveal.
export const useAgentBrowserPreviewStore = create<PreviewStore>((set) => ({
  byThreadId: {},
  observe: (state, threadId) => set((store) => {
    if (state.threadId !== threadId && (state.threadId || state.sessionId)) return store
    const previous = store.byThreadId[threadId]
    if (!isBrowserUseSessionActive(state, threadId)) {
      if (!previous) return store
      const byThreadId = { ...store.byThreadId }
      delete byThreadId[threadId]
      return { byThreadId }
    }
    const current: PreviewPresentation = previous && sameScope(previous, state) ? previous : {
      sessionId: state.sessionId!, turnId: state.turnId,
      open: previous?.sessionId === state.sessionId && previous?.open === true,
      revealed: false, surface: previous?.surface ?? 'floating', geometry: previous?.geometry
    }
    const reveal = browserUsePreviewNeedsAttention(state, threadId) ||
      (!current.revealed && shouldAutoOpenBrowserUsePreview(state, threadId))
    if (current === previous && previous.snapshot === state && (!reveal || (current.open && current.revealed))) return store
    return { byThreadId: {
      ...store.byThreadId,
      [threadId]: { ...current, snapshot: state, ...(reveal ? { open: true, revealed: true } : {}) }
    } }
  }),
  setOpen: (state, open) => set((store) => {
    if (!state.threadId) return store
    const current = store.byThreadId[state.threadId]
    if (!current || !sameScope(current, state) || (current.open === open && current.revealed)) return store
    return { byThreadId: {
      ...store.byThreadId, [state.threadId]: { ...current, open, revealed: true }
    } }
  }),
  setSurface: (state, surface, open = true) => set((store) => {
    const current = state.threadId ? store.byThreadId[state.threadId] : undefined
    if (!state.threadId || !current || !sameScope(current, state)) return store
    return { byThreadId: { ...store.byThreadId, [state.threadId]: { ...current, surface, open, revealed: true } } }
  }),
  setGeometry: (state, geometry) => set((store) => {
    const current = state.threadId ? store.byThreadId[state.threadId] : undefined
    if (!state.threadId || !current || !sameScope(current, state)) return store
    return { byThreadId: { ...store.byThreadId, [state.threadId]: { ...current, geometry } } }
  })
}))

export function isBrowserPreviewOpen(presentation: PreviewPresentation | undefined, state: BrowserUseViewState): boolean {
  return sameScope(presentation, state) && presentation?.open === true
}
