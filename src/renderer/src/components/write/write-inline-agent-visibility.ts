import type { WriteEditorSelectionState } from './write-markdown-editor-types'

export function shouldShowWriteInlineAgent(
  selection: WriteEditorSelectionState,
  pointerSelecting: boolean
): boolean {
  return selection.sourceKind !== 'spreadsheet' && selection.charCount > 0 && !pointerSelecting
}
