import { BrowserWindow, clipboard, dialog } from 'electron'
import {
  lstat,
  mkdir,
  open as openFile,
  readFile,
  readdir,
  rename,
  rm,
  stat,
  unlink,
  writeFile
} from 'node:fs/promises'
import { randomUUID } from 'node:crypto'
import { tmpdir } from 'node:os'
import { basename, dirname, isAbsolute, join, relative, resolve } from 'node:path'
import type {
  WorkspaceClipboardImageSavePayload,
  WorkspaceClipboardImageSaveResult,
  ClipboardImageReadResult,
  WorkspaceDirectoryCreatePayload,
  WorkspaceDirectoryCreateResult,
  WorkspaceDirectoryListResult,
  WorkspaceDirectoryTarget,
  WorkspaceEntryDeletePayload,
  WorkspaceEntryDeleteResult,
  WorkspaceEntryRenamePayload,
  WorkspaceEntryRenameResult,
  WorkspaceFileCreatePayload,
  WorkspaceFileCreateResult,
  WorkspaceFileReadResult,
  WorkspaceFileResolveResult,
  WorkspaceFileTarget,
  WorkspaceFileWritePayload,
  WorkspaceFileWriteResult,
  WorkspaceImageBytesSavePayload,
  WorkspaceImageBytesSaveResult,
  WorkspaceImagePickPayload,
  WorkspaceImagePickResult,
  WorkspaceImageReadResult,
  WorkspacePdfReadResult
} from '../../shared/workspace-file'
import {
  canonicalPath,
  compareWorkspaceEntries,
  expandHomePath,
  extensionFromName,
  normalizePathSeparators,
  normalizeUserPath,
  pathExists,
  resolveOpenTargetPath,
  resolveTargetPathWithinWorkspace,
  resolveWorkspaceDirectory,
  validateEntryName
} from './workspace-paths'

export async function renameWorkspaceEntry(
  payload: WorkspaceEntryRenamePayload
): Promise<WorkspaceEntryRenameResult> {
  try {
    const sourcePath = await resolveTargetPathWithinWorkspace(payload.path, payload.workspaceRoot)
    const sourceInfo = await stat(sourcePath)
    const nextName = validateEntryName(payload.newName)
    // Resolve/check the parent, not the leaf: realpath of an existing leaf can
    // erase a requested case-only rename on a case-insensitive filesystem.
    const targetParent = await resolveTargetPathWithinWorkspace(await canonicalPath(dirname(sourcePath)), payload.workspaceRoot)
    const targetPath = join(targetParent, nextName)
    if (basename(sourcePath) === nextName) {
      return {
        ok: true,
        path: targetPath,
        previousPath: sourcePath,
        renamedAt: new Date().toISOString()
      }
    }
    const targetInfo = await lstat(targetPath).catch((error: NodeJS.ErrnoException) => {
      if (error.code === 'ENOENT') return null
      throw error
    })
    if (targetInfo) {
      // Matching inode alone is insufficient: another spelling may be a distinct
      // hard link (or a symlink to this source). Only a non-exact directory lookup
      // of the source's own case-folded name is a case-only rename.
      const caseAlias = !targetInfo.isSymbolicLink() &&
        sourceInfo.dev === targetInfo.dev && sourceInfo.ino === targetInfo.ino &&
        basename(sourcePath).toLowerCase() === nextName.toLowerCase() &&
        !(await readdir(targetParent)).includes(nextName)
      if (!caseAlias) {
        return { ok: false, message: 'A file or directory with that name already exists.' }
      }
    }
    await rename(sourcePath, targetPath)
    return {
      ok: true,
      path: targetPath,
      previousPath: sourcePath,
      renamedAt: new Date().toISOString()
    }
  } catch (error) {
    return {
      ok: false,
      message: error instanceof Error ? error.message : String(error)
    }
  }
}

export async function deleteWorkspaceEntry(
  payload: WorkspaceEntryDeletePayload
): Promise<WorkspaceEntryDeleteResult> {
  try {
    const targetPath = await resolveTargetPathWithinWorkspace(payload.path, payload.workspaceRoot)
    const info = await stat(targetPath)
    if (payload.workspaceRoot?.trim()) {
      const workspacePath = await canonicalPath(resolve(expandHomePath(payload.workspaceRoot)))
      if (targetPath === workspacePath) {
        return { ok: false, message: 'Deleting the workspace root is not supported.' }
      }
    }
    if (info.isDirectory()) {
      await rm(targetPath, { recursive: true })
    } else {
      await unlink(targetPath)
    }
    return {
      ok: true,
      path: targetPath,
      deletedAt: new Date().toISOString()
    }
  } catch (error) {
    return {
      ok: false,
      message: error instanceof Error ? error.message : String(error)
    }
  }
}

export async function resolveWorkspaceFile(
  payload: WorkspaceFileTarget
): Promise<WorkspaceFileResolveResult> {
  try {
    const normalizedPath = normalizeUserPath(payload.path)
    const expandedPath = expandHomePath(normalizedPath)
    if (!isAbsolute(expandedPath) && !payload.workspaceRoot?.trim()) {
      return {
        ok: false,
        message: 'Workspace root is required to resolve a relative file path.'
      }
    }

    const targetPath = await resolveOpenTargetPath(payload.path, payload.workspaceRoot, {
      allowBasenameFallback: false
    })
    const info = await stat(targetPath)
    if (!info.isFile()) {
      return { ok: false, message: 'Path must point to a regular workspace file.' }
    }
    return { ok: true, path: targetPath }
  } catch (error) {
    return {
      ok: false,
      message: error instanceof Error ? error.message : String(error)
    }
  }
}
