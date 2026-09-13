import { create } from 'zustand'

// Shared by the settings watcher and asynchronous readers. No history content
// belongs in this store; revision fences requests made under an older mode.
export const useCodexReferenceState = create<{
  opencodeEnabled: boolean
  claudeEnabled: boolean
  enabled: boolean | null
  revision: number
}>(() => ({ enabled: null, claudeEnabled: false, opencodeEnabled: false, revision: 0 }))

export function codexReferenceRevision(): number {
  return useCodexReferenceState.getState().revision
}

export function sourceHistoryAllowed(turnId?: string): boolean {
  const state = useCodexReferenceState.getState()
  if (turnId?.startsWith('opencode:')) return state.opencodeEnabled
  if (turnId?.startsWith('claude-code:')) return state.claudeEnabled
  if (turnId?.startsWith('codex:')) return state.enabled !== false
  return state.enabled !== false || state.claudeEnabled || state.opencodeEnabled
}
