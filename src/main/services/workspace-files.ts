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

const MAX_FILE_PREVIEW_BYTES = 1_500_000
const MAX_IMAGE_PREVIEW_BYTES = 12 * 1024 * 1024
const MAX_PDF_PREVIEW_BYTES = 64 * 1024 * 1024
const WORKSPACE_IMAGE_DIR = 'img'
const CLIPBOARD_TEMP_DIR = join(tmpdir(), 'kun')

const WORKSPACE_IMAGE_MIME_BY_EXT = new Map([
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

export async function listWorkspaceDirectory(
  payload: WorkspaceDirectoryTarget
): Promise<WorkspaceDirectoryListResult> {
  try {
    const root = await resolveWorkspaceDirectory(payload)
    const entries = await readdir(root, { withFileTypes: true })
    const normalized = entries
      .filter((entry) => entry.name !== '.DS_Store')
      .map((entry) => ({
        name: entry.name,
        path: join(root, entry.name),
        type: entry.isDirectory() ? ('directory' as const) : ('file' as const),
        ext: entry.isDirectory() ? '' : extensionFromName(entry.name)
      }))
      .sort(compareWorkspaceEntries)

    return { ok: true, root, entries: normalized }
  } catch (error) {
    return {
      ok: false,
      message: error instanceof Error ? error.message : String(error)
    }
  }
}

export async function readWorkspaceFile(payload: WorkspaceFileTarget): Promise<WorkspaceFileReadResult> {
  try {
    const targetPath = await resolveOpenTargetPath(payload.path, payload.workspaceRoot)
    const fileInfo = await stat(targetPath)
    if (fileInfo.isDirectory()) {
      return { ok: false, message: 'Cannot preview a directory.' }
    }

    const maxBytes = Math.min(fileInfo.size, MAX_FILE_PREVIEW_BYTES)
    const handle = await openFile(targetPath, 'r')
    try {
      const buffer = Buffer.alloc(maxBytes)
      const { bytesRead } = await handle.read(buffer, 0, maxBytes, 0)
      const bytes = buffer.subarray(0, bytesRead)
      if (bytes.includes(0)) {
        return { ok: false, message: 'This file appears to be binary and cannot be previewed.' }
      }

      return {
        ok: true,
        path: targetPath,
        content: bytes.toString('utf8'),
        size: fileInfo.size,
        truncated: fileInfo.size > MAX_FILE_PREVIEW_BYTES,
        ...(payload.line ? { line: payload.line } : {}),
        ...(payload.column ? { column: payload.column } : {})
      }
    } finally {
      await handle.close()
    }
  } catch (error) {
    return {
      ok: false,
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
    if (fileInfo.size > MAX_IMAGE_PREVIEW_BYTES) {
      return { ok: false, message: 'This image is too large to preview.' }
    }

    const ext = extensionFromName(targetPath).toLowerCase()
    const mimeType = WORKSPACE_IMAGE_MIME_BY_EXT.get(ext)
    if (!mimeType) {
      return { ok: false, message: 'This image type is not supported in Write mode.' }
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
    return {
      ok: false,
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
      return { ok: false, message: 'This PDF is too large to preview in Write mode.' }
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
    return {
      ok: true,
      path: targetPath,
      savedAt: new Date().toISOString()
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

function buildWorkspaceImageName(now = new Date()): string {
  const iso = now.toISOString().replace(/[-:]/g, '').replace(/\..+$/, '').replace('T', '-')
  return `pasted-image-${iso}-${randomUUID().slice(0, 8)}.png`
}

function buildPickedImageName(ext: string, now = new Date()): string {
  const iso = now.toISOString().replace(/[-:]/g, '').replace(/\..+$/, '').replace('T', '-')
  const safeExt = /^\.[a-z0-9]{1,8}$/i.test(ext) ? ext.toLowerCase() : '.png'
  return `image-${iso}-${randomUUID().slice(0, 8)}${safeExt}`
}

function buildAnnotatedImageName(now = new Date()): string {
  const iso = now.toISOString().replace(/[-:]/g, '').replace(/\..+$/, '').replace('T', '-')
  return `annotated-${iso}-${randomUUID().slice(0, 8)}.png`
}

/** Directory the design agent's `generate_image` writes to (and reads references from). */
const GENERATED_IMAGE_DIR = '.deepseekgui-images'

function readUInt24LE(buffer: Buffer, offset: number): number {
  return buffer[offset] + (buffer[offset + 1] << 8) + (buffer[offset + 2] << 16)
}

function imageDimensionsFromBuffer(
  buffer: Buffer,
  ext: string
): { width: number; height: number } | null {
  const lowerExt = ext.toLowerCase()

  if (
    lowerExt === '.png' &&
    buffer.length >= 24 &&
    buffer[0] === 0x89 &&
    buffer.toString('ascii', 1, 4) === 'PNG'
  ) {
    return {
      width: buffer.readUInt32BE(16),
      height: buffer.readUInt32BE(20)
    }
  }

  if (
    lowerExt === '.gif' &&
    buffer.length >= 10 &&
    (buffer.toString('ascii', 0, 6) === 'GIF87a' || buffer.toString('ascii', 0, 6) === 'GIF89a')
  ) {
    return {
      width: buffer.readUInt16LE(6),
      height: buffer.readUInt16LE(8)
    }
  }

  if (lowerExt === '.webp' && buffer.length >= 30 && buffer.toString('ascii', 0, 4) === 'RIFF') {
    const chunk = buffer.toString('ascii', 12, 16)
    if (chunk === 'VP8X' && buffer.length >= 30) {
      return {
        width: readUInt24LE(buffer, 24) + 1,
        height: readUInt24LE(buffer, 27) + 1
      }
    }
  }

  if (
    (lowerExt === '.jpg' || lowerExt === '.jpeg') &&
    buffer.length >= 4 &&
    buffer[0] === 0xff &&
    buffer[1] === 0xd8
  ) {
    let offset = 2
    while (offset + 9 < buffer.length) {
      if (buffer[offset] !== 0xff) {
        offset += 1
        continue
      }
      while (buffer[offset] === 0xff) offset += 1
      const marker = buffer[offset]
      offset += 1
      if (marker === 0xd9 || marker === 0xda) break
      if (offset + 2 > buffer.length) break
      const length = buffer.readUInt16BE(offset)
      if (length < 2 || offset + length > buffer.length) break
      const isSof =
        (marker >= 0xc0 && marker <= 0xc3) ||
        (marker >= 0xc5 && marker <= 0xc7) ||
        (marker >= 0xc9 && marker <= 0xcb) ||
        (marker >= 0xcd && marker <= 0xcf)
      if (isSof && length >= 7) {
        return {
          height: buffer.readUInt16BE(offset + 3),
          width: buffer.readUInt16BE(offset + 5)
        }
      }
      offset += length
    }
  }

  return null
}

function buildClipboardTempImagePath(now = new Date()): string {
  return join(CLIPBOARD_TEMP_DIR, `${now.getTime()}.png`)
}

export async function readClipboardImage(): Promise<ClipboardImageReadResult> {
  try {
    const image = clipboard.readImage()
    if (image.isEmpty()) {
      return { ok: false, message: 'Clipboard does not currently contain an image.' }
    }

    const buffer = image.toPNG()
    if (!buffer.length) {
      return { ok: false, message: 'Clipboard image could not be encoded as PNG.' }
    }

    const localFilePath = buildClipboardTempImagePath()
    await mkdir(CLIPBOARD_TEMP_DIR, { recursive: true })
    await writeFile(localFilePath, buffer)

    const size = image.getSize()
    return {
      ok: true,
      name: buildWorkspaceImageName(),
      localFilePath,
      mimeType: 'image/png',
      dataBase64: buffer.toString('base64'),
      byteSize: buffer.length,
      ...(size.width > 0 ? { width: size.width } : {}),
      ...(size.height > 0 ? { height: size.height } : {})
    }
  } catch (error) {
    return {
      ok: false,
      message: error instanceof Error ? error.message : String(error)
    }
  }
}

export async function saveWorkspaceClipboardImage(
  payload: WorkspaceClipboardImageSavePayload
): Promise<WorkspaceClipboardImageSaveResult> {
  try {
    const currentFilePath = await resolveOpenTargetPath(payload.currentFilePath, payload.workspaceRoot, {
      allowBasenameFallback: false
    })
    const image = clipboard.readImage()
    if (image.isEmpty()) {
      return { ok: false, message: 'Clipboard does not currently contain an image.' }
    }

    const buffer = image.toPNG()
    if (!buffer.length) {
      return { ok: false, message: 'Clipboard image could not be encoded as PNG.' }
    }

    const imageDirectory = payload.imageDirectory?.trim() || WORKSPACE_IMAGE_DIR
    const imageDir = await resolveTargetPathWithinWorkspace(imageDirectory, payload.workspaceRoot)
    await mkdir(imageDir, { recursive: true })

    const targetPath = await resolveTargetPathWithinWorkspace(
      join(imageDir, buildWorkspaceImageName()),
      payload.workspaceRoot
    )
    await writeFile(targetPath, buffer)

    return {
      ok: true,
      path: targetPath,
      markdownPath: normalizePathSeparators(relative(dirname(currentFilePath), targetPath)),
      createdAt: new Date().toISOString()
    }
  } catch (error) {
    return {
      ok: false,
      message: error instanceof Error ? error.message : String(error)
    }
  }
}

/**
 * Save raw PNG/SVG bytes (base64) into the workspace's generated-image directory.
 * Used by flattened image annotations and deterministic whiteboard exports; the
 * returned relative path must stay within the workspace for previews/references.
 */
export async function saveWorkspaceImageBytes(
  payload: WorkspaceImageBytesSavePayload
): Promise<WorkspaceImageBytesSaveResult> {
  try {
    const buffer = Buffer.from(payload.dataBase64, 'base64')
    if (!buffer.length) {
      return { ok: false, message: 'Image data is empty.' }
    }

    const requestedFileName = payload.fileName?.trim()
    const requestedExtension = requestedFileName?.match(/\.(png|svg)$/i)?.[1]?.toLowerCase()
    if (
      requestedFileName &&
      (
        basename(requestedFileName) !== requestedFileName ||
        !/^[A-Za-z0-9][A-Za-z0-9._-]{0,199}\.(?:png|svg)$/i.test(requestedFileName)
      )
    ) {
      return { ok: false, message: 'Image fileName must be a safe PNG or SVG basename.' }
    }
    const expectedMimeType = requestedExtension === 'svg' ? 'image/svg+xml' : 'image/png'
    const suppliedMimeType = payload.mimeType?.trim().toLowerCase()
    if (
      (requestedExtension === 'svg' && suppliedMimeType !== expectedMimeType) ||
      (suppliedMimeType && suppliedMimeType !== expectedMimeType)
    ) {
      return { ok: false, message: `Image mimeType must match the .${requestedExtension ?? 'png'} file extension.` }
    }

    const imageDirectory = payload.imageDirectory?.trim() || GENERATED_IMAGE_DIR
    const imageDir = await resolveTargetPathWithinWorkspace(imageDirectory, payload.workspaceRoot)
    await mkdir(imageDir, { recursive: true })

    const targetPath = await resolveTargetPathWithinWorkspace(
      join(imageDir, requestedFileName || buildAnnotatedImageName()),
      payload.workspaceRoot
    )
    const tmpPath = `${targetPath}.${randomUUID()}.tmp`
    try {
      await writeFile(tmpPath, buffer)
      await rename(tmpPath, targetPath)
    } catch (writeError) {
      await unlink(tmpPath).catch(() => undefined)
      throw writeError
    }

    const workspacePath = await canonicalPath(resolve(expandHomePath(payload.workspaceRoot)))
    return {
      ok: true,
      path: targetPath,
      workspaceRelativePath: normalizePathSeparators(relative(workspacePath, targetPath)),
      createdAt: new Date().toISOString()
    }
  } catch (error) {
    return {
      ok: false,
      message: error instanceof Error ? error.message : String(error)
    }
  }
}

export async function pickAndSaveWorkspaceImage(
  payload: WorkspaceImagePickPayload,
  options?: { parentWindow?: BrowserWindow | null }
): Promise<WorkspaceImagePickResult> {
  try {
    const parentWindow = options?.parentWindow ?? null
    const result = parentWindow
      ? await dialog.showOpenDialog(parentWindow, {
          title: 'Pick an image',
          properties: ['openFile'],
          filters: [
            { name: 'Images', extensions: ['png', 'jpg', 'jpeg', 'gif', 'webp', 'svg', 'avif'] }
          ]
        })
      : await dialog.showOpenDialog({
          title: 'Pick an image',
          properties: ['openFile'],
          filters: [
            { name: 'Images', extensions: ['png', 'jpg', 'jpeg', 'gif', 'webp', 'svg', 'avif'] }
          ]
        })
    if (result.canceled || result.filePaths.length === 0) {
      return { ok: false, canceled: true }
    }
    const sourcePath = result.filePaths[0]
    const buffer = await readFile(sourcePath)
    if (!buffer.length) {
      return { ok: false, message: 'Selected image is empty.' }
    }
    const imageDirectory = payload.imageDirectory?.trim() || WORKSPACE_IMAGE_DIR
    const imageDir = await resolveTargetPathWithinWorkspace(imageDirectory, payload.workspaceRoot)
    await mkdir(imageDir, { recursive: true })
    const ext = extensionFromName(sourcePath)
    const targetPath = await resolveTargetPathWithinWorkspace(
      join(imageDir, buildPickedImageName(ext)),
      payload.workspaceRoot
    )
    await writeFile(targetPath, buffer)
    const workspacePath = await canonicalPath(resolve(expandHomePath(payload.workspaceRoot)))
    const workspaceRelativePath = normalizePathSeparators(relative(workspacePath, targetPath))
    const currentFilePath = payload.currentFilePath
      ? await resolveOpenTargetPath(payload.currentFilePath, payload.workspaceRoot, {
          allowBasenameFallback: false
        })
      : null
    const dimensions = imageDimensionsFromBuffer(buffer, ext)
    return {
      ok: true,
      path: targetPath,
      relativePath: currentFilePath
        ? normalizePathSeparators(relative(dirname(currentFilePath), targetPath))
        : workspaceRelativePath,
      workspaceRelativePath,
      ...(dimensions ? { width: dimensions.width, height: dimensions.height } : {}),
      createdAt: new Date().toISOString()
    }
  } catch (error) {
    return {
      ok: false,
      message: error instanceof Error ? error.message : String(error)
    }
  }
}

export async function renameWorkspaceEntry(
  payload: WorkspaceEntryRenamePayload
): Promise<WorkspaceEntryRenameResult> {
  try {
    const sourcePath = await resolveTargetPathWithinWorkspace(payload.path, payload.workspaceRoot)
    await stat(sourcePath)
    const nextName = validateEntryName(payload.newName)
    const targetPath = await resolveTargetPathWithinWorkspace(
      join(dirname(sourcePath), nextName),
      payload.workspaceRoot
    )
    if (sourcePath === targetPath) {
      return {
        ok: true,
        path: targetPath,
        previousPath: sourcePath,
        renamedAt: new Date().toISOString()
      }
    }
    if (await pathExists(targetPath)) {
      return { ok: false, message: 'A file or directory with that name already exists.' }
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
