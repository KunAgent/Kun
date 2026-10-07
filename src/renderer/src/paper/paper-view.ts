import { activePaperViewId } from '../write/write-editor-layout'
import type { WritePaperViewId } from '../write/write-workspace-store-types'
import type { WriteWorkspaceState } from '../write/write-workspace-store-types'
import { useWriteWorkspaceStore } from '../write/write-workspace-store'
import type { PaperModeView } from './paper-conversation-scope'

/**
 * The paper "view" follows the focused editor group's active tab: a focused
 * library/discover tab maps to its page, anything else (a file tab — a reader,
 * notes, a document — or an empty group) counts as 'reader'.
 */
export function paperModeView(
  state: Pick<WriteWorkspaceState, 'editorLayout'> &
    Partial<Pick<WriteWorkspaceState, 'paperResearch'>>
): PaperModeView {
  const id = activePaperViewId(state.editorLayout)
  if (id === 'library') return 'library'
  if (id === 'discover:search' && state.paperResearch?.agentTab) return 'research'
  if (id) return 'discover'
  return 'reader'
}

/**
 * True while the focused paper view is the Agent research stage. The stage
 * hosts the Work assistant conversation itself, so the right assistant rail
 * steps aside to keep a single composer on screen.
 */
export function paperResearchStageActive(
  state: Pick<WriteWorkspaceState, 'editorLayout' | 'paperResearch'>
): boolean {
  return paperModeView(state) === 'research'
}

/** Research session the conversation resource resolves to (null = new research). */
export function paperResearchSessionId(
  state: Partial<Pick<WriteWorkspaceState, 'paperResearch'>>
): string | null {
  return state.paperResearch?.sessionId ?? null
}

/** Focused paper view tab id ('library' / 'discover:*') or null when reading. */
export function focusedPaperViewId(
  state: Pick<WriteWorkspaceState, 'editorLayout'>
): WritePaperViewId | null {
  return activePaperViewId(state.editorLayout)
}

export function openPaperViewTab(view: WritePaperViewId): void {
  useWriteWorkspaceStore.getState().openPaperViewTab(view)
}
