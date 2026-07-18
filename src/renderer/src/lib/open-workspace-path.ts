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

async function resolveExactWorkspaceFile(
  targetPath: string,
  workspaceRoot: string
): Promise<{ ok: true; path: string } | { ok: false; message: string }> {
  const root = workspaceRoot.trim()
  if (!root) return { ok: false, message: 'Workspace root is required.' }
  if (typeof window === 'undefined' || typeof window.kunGui?.resolveWorkspaceFile !== 'function') {
    return { ok: false, message: 'Workspace file bridge is unavailable.' }
  }
  try {
    return await window.kunGui.resolveWorkspaceFile({ path: targetPath, workspaceRoot: root })
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

export async function openWorkspaceFileWithSystemDefault(
  targetPath: string,
  workspaceRoot: string,
  expectedSha256?: string
): Promise<EditorOpenResult> {
  const resolved = await resolveExactWorkspaceFile(targetPath, workspaceRoot)
  if (!resolved.ok) return resolved
  return invokeOpenEditorPath({
    path: resolved.path,
    workspaceRoot: workspaceRoot.trim(),
    editorId: 'system',
    openPolicy: 'presentation-artifact',
    ...(expectedSha256 ? { expectedSha256 } : {})
  })
}

export async function revealWorkspaceFileInFileManager(
  targetPath: string,
  workspaceRoot: string,
  expectedSha256?: string
): Promise<EditorOpenResult> {
  const resolved = await resolveExactWorkspaceFile(targetPath, workspaceRoot)
  if (!resolved.ok) return resolved
  return invokeOpenEditorPath({
    path: resolved.path,
    workspaceRoot: workspaceRoot.trim(),
    editorId: 'file-manager',
    openPolicy: 'presentation-artifact',
    ...(expectedSha256 ? { expectedSha256 } : {})
  })
}

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
