import { create } from 'zustand'
import type { ImportCandidate } from './paper-import-plan'

/**
 * Drag payload for "drop papers on a sidebar folder". The browser hides drag
 * data during `dragover`, so the candidates live here while a drag is active.
 */
export const PAPER_IMPORT_DRAG_TYPE = 'application/x-kun-paper-import'

type DragState = {
  candidates: readonly ImportCandidate[]
  /** Import scope (job + selection) the dragged papers belong to. */
  scope: string
  /** Folder under the pointer (null = none). */
  overFolder: string | null
  begin: (candidates: readonly ImportCandidate[], scope: string) => void
  hover: (folder: string | null) => void
  end: () => void
}

export const usePaperImportDrag = create<DragState>((set) => ({
  candidates: [],
  scope: '',
  overFolder: null,
  begin: (candidates, scope) => set({ candidates, scope, overFolder: null }),
  hover: (overFolder) => set((state) => (state.overFolder === overFolder ? state : { overFolder })),
  end: () => set({ candidates: [], scope: '', overFolder: null })
}))

/** Mark a native drag as a paper-import drag and register its candidates. */
export function startPaperImportDrag(
  event: { dataTransfer: DataTransfer },
  candidates: readonly ImportCandidate[],
  scope: string
): void {
  event.dataTransfer.setData(PAPER_IMPORT_DRAG_TYPE, String(candidates.length))
  event.dataTransfer.setData('text/plain', candidates.map((candidate) => candidate.title).join('\n'))
  event.dataTransfer.effectAllowed = 'copy'
  usePaperImportDrag.getState().begin(candidates, scope)
}

export function isPaperImportDrag(dataTransfer: DataTransfer | null): boolean {
  return Boolean(dataTransfer?.types.includes(PAPER_IMPORT_DRAG_TYPE))
}
