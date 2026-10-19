import { create } from 'zustand'
import type { AppSettingsV1 } from '@shared/app-settings'
import { getKunRuntimeSettings } from '../../../shared/app-settings-kun-defaults'
import { rendererRuntimeClient } from '../agent/runtime-client'
import { SETTINGS_CHANGED_EVENT } from '../lib/keyboard-shortcut-settings'

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
  flags: { genUi: boolean; mcpApps: boolean; loaded: boolean }
  panel: AppSurfacePanel | null
  /** Tool calls whose preferred fullscreen display was already honored once. */
  consumedFullscreenKeys: Record<string, true>
  openPanel: (panel: AppSurfacePanel) => void
  closePanel: () => void
  consumeFullscreen: (key: string) => boolean
}

export const useAppSurfaceStore = create<AppSurfaceState>((set, get) => ({
  flags: { genUi: false, mcpApps: false, loaded: false },
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

function applySettings(settings: AppSettingsV1): void {
  const lab = getKunRuntimeSettings(settings).lab
  useAppSurfaceStore.setState({
    flags: { genUi: lab.genUi?.enabled === true, mcpApps: lab.mcpApps?.enabled === true, loaded: true }
  })
}

let watching = false

/** Load the Lab flags once and follow later settings changes. */
export function ensureAppSurfaceFlags(): void {
  if (watching || typeof window === 'undefined') return
  watching = true
  // Deferred so a missing or failing settings bridge can never throw inside a
  // render effect; the flags simply stay off.
  void Promise.resolve()
    .then(() => rendererRuntimeClient.getSettings())
    .then(applySettings)
    .catch(() => undefined)
  window.addEventListener(SETTINGS_CHANGED_EVENT, (event) => {
    const settings = (event as CustomEvent<AppSettingsV1>).detail
    if (settings) applySettings(settings)
  })
}
