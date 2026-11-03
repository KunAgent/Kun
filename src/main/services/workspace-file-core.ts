import { BrowserWindow, clipboard, dialog } from 'electron'
import {
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
  WorkspaceFileReadPayload,
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
  WORKSPACE_TEXT_PREVIEW_HEAD_BYTES,
  WORKSPACE_TEXT_PREVIEW_MAX_BYTES
} from '../../shared/workspace-file'
import {
  CONVERTED_IMAGE_EXTENSIONS,
  MAX_CONVERTED_IMAGE_SOURCE_BYTES,
  convertImageToPng
} from './workspace-image-conversion'
import { decodeWorkspaceText } from './workspace-text-decoding'
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

export const MAX_FILE_PREVIEW_BYTES = WORKSPACE_TEXT_PREVIEW_HEAD_BYTES

const BINARY_HEAD_BYTES = 4096

export const MAX_IMAGE_PREVIEW_BYTES = 40 * 1024 * 1024

export const MAX_PDF_PREVIEW_BYTES = 64 * 1024 * 1024

export const WORKSPACE_IMAGE_DIR = 'img'

export const CLIPBOARD_TEMP_DIR = join(tmpdir(), 'kun')

export const WORKSPACE_IMAGE_MIME_BY_EXT = new Map([
  ['.png', 'image/png'],
  ['.jpg', 'image/jpeg'],
  ['.jpeg', 'image/jpeg'],
  ['.gif', 'image/gif'],
  ['.webp', 'image/webp'],
  ['.svg', 'image/svg+xml'],
  ['.bmp', 'image/bmp'],
  ['.avif', 'image/avif'],
  ['.ico', 'image/x-icon']
])

export function decodeWorkspaceTextPreview(bytes: Buffer): string | null {
  return decodeWorkspaceText(bytes)?.text ?? null
}

function readFailureCode(error: unknown): 'not_found' | undefined {
  const code = (error as NodeJS.ErrnoException | null)?.code
  return code === 'ENOENT' || code === 'ENOTDIR' ? 'not_found' : undefined
}

export async function listWorkspaceDirectory(
  payload: WorkspaceDirectoryTarget
): Promise<WorkspaceDirectoryListResult> {
  try {
    const root = await resolveWorkspaceDirectory(payload)
    const entries = await readdir(root, { withFileTypes: true })
    const normalized = await Promise.all(entries
      .filter((entry) => entry.name !== '.DS_Store')
      .map(async (entry) => {
        const entryPath = join(root, entry.name)
        const metadata = await stat(entryPath).catch(() => null)
        return {
        name: entry.name,
        path: entryPath,
        type: entry.isDirectory() ? ('directory' as const) : ('file' as const),
        ext: entry.isDirectory() ? '' : extensionFromName(entry.name),
        ...(metadata ? { mtimeMs: metadata.mtimeMs } : {}),
        ...(metadata?.isFile() ? { size: metadata.size } : {})
        }
      }))
    normalized.sort(compareWorkspaceEntries)

    return { ok: true, root, entries: normalized }
  } catch (error) {
    return {
      ok: false,
      message: error instanceof Error ? error.message : String(error)
    }
  }
}

export async function readWorkspaceFile(payload: WorkspaceFileReadPayload): Promise<WorkspaceFileReadResult> {
  try {
    const targetPath = await resolveOpenTargetPath(payload.path, payload.workspaceRoot)
    const fileInfo = await stat(targetPath)
    if (fileInfo.isDirectory()) {
      return { ok: false, code: 'directory', message: 'Cannot preview a directory.', path: targetPath }
    }

    const limit = Math.min(
      Math.max(1, Math.trunc(payload.maxBytes ?? MAX_FILE_PREVIEW_BYTES)),
      WORKSPACE_TEXT_PREVIEW_MAX_BYTES
    )
    const maxBytes = Math.min(fileInfo.size, limit)
    const handle = await openFile(targetPath, 'r')
    try {
      const buffer = Buffer.alloc(maxBytes)
      const { bytesRead } = await handle.read(buffer, 0, maxBytes, 0)
      const bytes = buffer.subarray(0, bytesRead)
      const truncated = fileInfo.size > bytesRead
      const decoded = decodeWorkspaceText(bytes, { forced: payload.encoding, truncated })
      if (!decoded) {
        return {
          ok: false,
          code: 'binary',
          message: 'This file appears to be binary and cannot be previewed.',
          path: targetPath,
          size: fileInfo.size,
          mtimeMs: fileInfo.mtimeMs,
          headBase64: bytes.subarray(0, BINARY_HEAD_BYTES).toString('base64')
        }
      }

      return {
        ok: true,
        path: targetPath,
        content: decoded.text,
        size: fileInfo.size,
        mtimeMs: fileInfo.mtimeMs,
        truncated,
        encoding: decoded.encoding,
        bytesRead,
        ...(payload.line ? { line: payload.line } : {}),
        ...(payload.column ? { column: payload.column } : {})
      }
    } finally {
      await handle.close()
    }
  } catch (error) {
    const code = readFailureCode(error)
    return {
      ok: false,
      ...(code ? { code } : {}),
      message: error instanceof Error ? error.message : String(error)
    }
  }
}

export async function readWorkspaceImage(
  payload: WorkspaceFileTarget
): Promise<WorkspaceImageReadResult> {
  try {
    const targetPath = await resolveOpenTargetPath(payload.path, payload.workspaceRoot)
    const fileInfo = await stat(targetPath)
    if (fileInfo.isDirectory()) {
      return { ok: false, message: 'Cannot preview a directory.' }
    }

    const ext = extensionFromName(targetPath).toLowerCase()
    if (CONVERTED_IMAGE_EXTENSIONS.has(ext)) {
      if (fileInfo.size > MAX_CONVERTED_IMAGE_SOURCE_BYTES) {
        return { ok: false, code: 'too_large', message: 'This image is too large to preview.' }
      }
      const png = await convertImageToPng(targetPath)
      if (!png) {
        return { ok: false, code: 'unsupported', message: 'This image format cannot be previewed on this system.' }
      }
      return {
        ok: true,
        path: targetPath,
        dataUrl: `data:image/png;base64,${png.toString('base64')}`,
        mimeType: 'image/png',
        size: fileInfo.size,
        convertedFrom: ext.slice(1).toUpperCase()
      }
    }
    if (fileInfo.size > MAX_IMAGE_PREVIEW_BYTES) {
      return { ok: false, code: 'too_large', message: 'This image is too large to preview.' }
    }
    const mimeType = WORKSPACE_IMAGE_MIME_BY_EXT.get(ext)
    if (!mimeType) {
      return { ok: false, code: 'unsupported', message: 'This image type is not supported in Work.' }
    }

    const bytes = await readFile(targetPath)
    return {
      ok: true,
      path: targetPath,
      dataUrl: `data:${mimeType};base64,${bytes.toString('base64')}`,
      mimeType,
      size: fileInfo.size
    }
  } catch (error) {
    const code = readFailureCode(error)
    return {
      ok: false,
      ...(code ? { code } : {}),
      message: error instanceof Error ? error.message : String(error)
    }
  }
}

export async function readWorkspacePdf(
  payload: WorkspaceFileTarget
): Promise<WorkspacePdfReadResult> {
  try {
    const targetPath = await resolveOpenTargetPath(payload.path, payload.workspaceRoot)
    const fileInfo = await stat(targetPath)
    if (fileInfo.isDirectory()) {
      return { ok: false, message: 'Cannot preview a directory.' }
    }
    if (fileInfo.size > MAX_PDF_PREVIEW_BYTES) {
      return { ok: false, message: 'This PDF is too large to preview in Work.' }
    }

    const ext = extensionFromName(targetPath).toLowerCase()
    if (ext !== '.pdf') {
      return { ok: false, message: 'This file is not a PDF document.' }
    }

    const bytes = await readFile(targetPath)
    return {
      ok: true,
      path: targetPath,
      dataBase64: bytes.toString('base64'),
      mimeType: 'application/pdf',
      size: fileInfo.size,
      mtimeMs: fileInfo.mtimeMs
    }
  } catch (error) {
    return {
      ok: false,
      message: error instanceof Error ? error.message : String(error)
    }
  }
}

export async function writeWorkspaceFile(
  payload: WorkspaceFileWritePayload
): Promise<WorkspaceFileWriteResult> {
  // Atomic write: stage into a sibling `.tmp` then `rename` over the target.
  // On POSIX (and NTFS via Win32 MoveFileEx with REPLACE_EXISTING, which Node uses)
  // this is atomic within a single filesystem, so a crash mid-write leaves the
  // previous version intact rather than producing a half-written file.
  try {
    const targetPath = await resolveTargetPathWithinWorkspace(payload.path, payload.workspaceRoot)
    if (payload.expectedMtimeMs !== undefined && payload.force !== true) {
      const current = await stat(targetPath).catch(() => null)
      if (!current || current.mtimeMs !== payload.expectedMtimeMs) {
        return {
          ok: false,
          code: 'modified_on_disk',
          message: 'This file changed on disk after it was opened.',
          ...(current ? { mtimeMs: current.mtimeMs } : {})
        }
      }
    }
    await mkdir(dirname(targetPath), { recursive: true })
    const tmpPath = `${targetPath}.${randomUUID()}.tmp`
    try {
      await writeFile(tmpPath, payload.content, 'utf8')
      await rename(tmpPath, targetPath)
    } catch (writeError) {
      // Best-effort cleanup; ignore if the tmp file isn't there.
      await unlink(tmpPath).catch(() => undefined)
      throw writeError
    }
    const saved = await stat(targetPath)
    return {
      ok: true,
      path: targetPath,
      savedAt: new Date().toISOString(),
      mtimeMs: saved.mtimeMs
    }
  } catch (error) {
    return {
      ok: false,
      message: error instanceof Error ? error.message : String(error)
    }
  }
}

export async function createWorkspaceFile(
  payload: WorkspaceFileCreatePayload
): Promise<WorkspaceFileCreateResult> {
  try {
    const targetPath = await resolveTargetPathWithinWorkspace(payload.path, payload.workspaceRoot)
    await mkdir(dirname(targetPath), { recursive: true })
    if (await pathExists(targetPath)) {
      return { ok: false, message: 'File already exists.' }
    }
    await writeFile(targetPath, payload.content ?? '', { encoding: 'utf8', flag: 'wx' })
    return {
      ok: true,
      path: targetPath,
      createdAt: new Date().toISOString()
    }
  } catch (error) {
    return {
      ok: false,
      message: error instanceof Error ? error.message : String(error)
    }
  }
}

export async function createWorkspaceDirectory(
  payload: WorkspaceDirectoryCreatePayload
): Promise<WorkspaceDirectoryCreateResult> {
  try {
    const targetPath = await resolveTargetPathWithinWorkspace(payload.path, payload.workspaceRoot)
    if (await pathExists(targetPath)) {
      return { ok: false, message: 'Directory already exists.' }
    }
    await mkdir(targetPath)
    return {
      ok: true,
      path: targetPath,
      createdAt: new Date().toISOString()
    }
  } catch (error) {
    return {
      ok: false,
      message: error instanceof Error ? error.message : String(error)
    }
  }
}

export function buildWorkspaceImageName(now = new Date()): string {
  const iso = now.toISOString().replace(/[-:]/g, '').replace(/\..+$/, '').replace('T', '-')
  return `pasted-image-${iso}-${randomUUID().slice(0, 8)}.png`
}

export function buildPickedImageName(ext: string, now = new Date()): string {
  const iso = now.toISOString().replace(/[-:]/g, '').replace(/\..+$/, '').replace('T', '-')
  const safeExt = /^\.[a-z0-9]{1,8}$/i.test(ext) ? ext.toLowerCase() : '.png'
  return `image-${iso}-${randomUUID().slice(0, 8)}${safeExt}`
}

export function buildAnnotatedImageName(now = new Date()): string {
  const iso = now.toISOString().replace(/[-:]/g, '').replace(/\..+$/, '').replace('T', '-')
  return `annotated-${iso}-${randomUUID().slice(0, 8)}.png`
}
