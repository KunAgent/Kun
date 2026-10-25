import { create } from 'zustand'

export type McpAppToolCallSnapshot = {
  toolName: string
  arguments: Record<string, unknown>
  result?: unknown
  isError?: boolean
}

/** A page shown in the large App panel instead of (or in addition to) its card. */
export type AppSurfacePanel =
  | { kind: 'gen-ui'; key: string; threadId: string; widgetId: string; title: string }
  | {
      kind: 'mcp-app'
      key: string
      threadId: string
      serverId: string
      resourceUri: string
      title: string
      toolCall?: McpAppToolCallSnapshot
    }

type AppSurfaceState = {
  panel: AppSurfacePanel | null
  /** Tool calls whose preferred fullscreen display was already honored once. */
  consumedFullscreenKeys: Record<string, true>
  openPanel: (panel: AppSurfacePanel) => void
  closePanel: () => void
  consumeFullscreen: (key: string) => boolean
}

export const useAppSurfaceStore = create<AppSurfaceState>((set, get) => ({
  panel: null,
  consumedFullscreenKeys: {},
  openPanel: (panel) => set({ panel }),
  closePanel: () => set({ panel: null }),
  consumeFullscreen: (key) => {
    if (get().consumedFullscreenKeys[key]) return false
    set((state) => ({ consumedFullscreenKeys: { ...state.consumedFullscreenKeys, [key]: true } }))
    return true
  }
}))
