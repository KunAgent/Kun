import { create } from 'zustand'
import type { BrowserUseRect } from '@shared/browser-use'
import type { BrowserPreviewOwner } from './agent-browser-preview-state'

export interface AgentBrowserSurface extends BrowserPreviewOwner {
  owner: symbol
  rect: BrowserUseRect
  variant: 'full' | 'pip'
}

export const useAgentBrowserSurfaceStore = create<{
  byThreadId: Record<string, AgentBrowserSurface>
  claim: (surface: AgentBrowserSurface) => void
  present: (surface: AgentBrowserSurface) => void
  release: (threadId: string, owner: symbol) => void
}>((set) => ({
  byThreadId: {},
  claim: (surface) => set((state) => surface.threadId
    ? { byThreadId: { ...state.byThreadId, [surface.threadId]: surface } } : state),
  present: (surface) => set((state) => {
    if (!surface.threadId) return state
    const before = state.byThreadId[surface.threadId]
    if (before?.owner !== surface.owner) return state
    if (before?.owner === surface.owner && before.variant === surface.variant &&
      before.rect.x === surface.rect.x && before.rect.y === surface.rect.y &&
      before.rect.width === surface.rect.width && before.rect.height === surface.rect.height) return state
    return { byThreadId: { ...state.byThreadId, [surface.threadId]: surface } }
  }),
  // A same-commit slot handoff keeps the native page mounted and supervised.
  release: (threadId, owner) => queueMicrotask(() => set((state) => {
    if (state.byThreadId[threadId]?.owner !== owner) return state
    const byThreadId = { ...state.byThreadId }
    delete byThreadId[threadId]
    return { byThreadId }
  }))
}))
