import { create } from 'zustand'

// Shared by the settings watcher and asynchronous readers. No history content
// belongs in this store; revision fences requests made under an older mode.
export const useCodexReferenceState = create<{
  enabled: boolean | null
  revision: number
}>(() => ({ enabled: null, revision: 0 }))

export function codexReferenceRevision(): number {
  return useCodexReferenceState.getState().revision
}

export function sourceHistoryAllowed(): boolean {
  return useCodexReferenceState.getState().enabled !== false
}
