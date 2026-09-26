import { activePaperViewId } from '../write/write-editor-layout'
import type { WritePaperViewId } from '../write/write-workspace-store-types'
import type { WriteWorkspaceState } from '../write/write-workspace-store-types'
import { useWriteWorkspaceStore } from '../write/write-workspace-store'
import type { PaperModeView } from './paper-conversation-scope'

/**
 * Paper-mode "view" is derived from the focused editor group's active tab
 * (U4): a focused library/discover virtual tab maps to its surface, anything
 * else (a file tab — the reader, notes, interpretations — or an empty group)
 * counts as 'reader'.
 */
export function paperModeView(
  state: Pick<WriteWorkspaceState, 'workSurface' | 'editorLayout'>
): PaperModeView {
  if (state.workSurface !== 'papers') return 'library'
  const id = activePaperViewId(state.editorLayout)
  if (id === 'library') return 'library'
  if (id) return 'discover'
  return 'reader'
}

/** Focused paper view tab id ('library' / 'discover:*') or null when reading. */
export function focusedPaperViewId(
  state: Pick<WriteWorkspaceState, 'workSurface' | 'editorLayout'>
): WritePaperViewId | null {
  if (state.workSurface !== 'papers') return null
  return activePaperViewId(state.editorLayout)
}

export function openPaperViewTab(view: WritePaperViewId): void {
  useWriteWorkspaceStore.getState().openPaperViewTab(view)
}
