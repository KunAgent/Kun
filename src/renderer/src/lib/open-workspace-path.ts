import type { EditorOpenResult } from '@shared/editor'
import { readPreferredEditorId } from './editor-preferences'

export type WorkspacePathTarget = {
  path: string
  line?: number
  column?: number
}

export async function openWorkspacePathInEditor(
  target: WorkspacePathTarget,
  workspaceRoot?: string
): Promise<EditorOpenResult> {
  if (typeof window.dsGui?.openEditorPath !== 'function') {
    return { ok: false, message: 'Editor bridge is unavailable.' }
  }

  return window.dsGui.openEditorPath({
    path: target.path,
    line: target.line,
    column: target.column,
    workspaceRoot,
    editorId: readPreferredEditorId()
  })
}

export const openWorkspacePath = openWorkspacePathInEditor
