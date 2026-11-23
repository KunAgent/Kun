import type { WriteEditorSelectionState } from '../../components/write/write-markdown-editor-types'

type SelectionTarget = (selection: WriteEditorSelectionState) => boolean
const targets = new Map<string, SelectionTarget>()

export function annotationDocumentKey(workspaceRoot: string, filePath: string): string {
  return JSON.stringify([workspaceRoot, filePath])
}

/** Only the focused editor group registers a target for the Work selection menu. */
export function registerAnnotationSelection(key: string, target: SelectionTarget): () => void {
  targets.set(key, target)
  return () => { if (targets.get(key) === target) targets.delete(key) }
}

export function annotateWorkSelection(workspaceRoot: string, path: string, selection: WriteEditorSelectionState): boolean {
  return targets.get(annotationDocumentKey(workspaceRoot, path))?.(selection) ?? false
}
