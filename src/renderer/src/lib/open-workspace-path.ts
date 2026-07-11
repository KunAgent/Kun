import type { EditorOpenResult, OpenEditorPathOptions } from '@shared/editor'
import { readPreferredEditorId } from './editor-preferences'

export type WorkspacePathTarget = {
  path: string
  line?: number
  column?: number
}

async function invokeOpenEditorPath(options: OpenEditorPathOptions): Promise<EditorOpenResult> {
  if (typeof window === 'undefined' || typeof window.kunGui?.openEditorPath !== 'function') {
    return { ok: false, message: 'Editor bridge is unavailable.' }
  }

  try {
    return await window.kunGui.openEditorPath(options)
  } catch (error) {
    return { ok: false, message: error instanceof Error ? error.message : String(error) }
  }
}

export async function openWorkspacePathInEditor(
  target: WorkspacePathTarget,
  workspaceRoot?: string
): Promise<EditorOpenResult> {
  return invokeOpenEditorPath({
    path: target.path,
    line: target.line,
    column: target.column,
    workspaceRoot,
    editorId: readPreferredEditorId()
  })
}

export const openWorkspacePath = openWorkspacePathInEditor

export async function revealWorkspacePathInFileManager(
  targetPath: string,
  workspaceRoot?: string
): Promise<EditorOpenResult> {
  return invokeOpenEditorPath({
    path: targetPath,
    workspaceRoot,
    editorId: 'file-manager'
  })
}
