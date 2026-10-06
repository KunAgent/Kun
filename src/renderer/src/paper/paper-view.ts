import { useWorkAssistantNavigation } from '../write/work-assistant-navigation'
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
  state: Pick<WriteWorkspaceState, 'workSurface' | 'editorLayout'> &
    Partial<Pick<WriteWorkspaceState, 'paperResearch'>>
): PaperModeView {
  if (state.workSurface !== 'papers') return 'library'
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
  state: Pick<WriteWorkspaceState, 'workSurface' | 'editorLayout' | 'paperResearch'>
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
  state: Pick<WriteWorkspaceState, 'workSurface' | 'editorLayout'>
): WritePaperViewId | null {
  if (state.workSurface !== 'papers') return null
  return activePaperViewId(state.editorLayout)
}

export function openPaperViewTab(view: WritePaperViewId): void {
  useWorkAssistantNavigation.getState().openWorkspace()
  useWriteWorkspaceStore.getState().openPaperViewTab(view)
}
