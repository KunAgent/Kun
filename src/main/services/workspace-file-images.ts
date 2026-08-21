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
import { KUN_GENERATED_IMAGE_DIR } from '../../shared/generated-image-path'
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

import {
  CLIPBOARD_TEMP_DIR,
  WORKSPACE_IMAGE_DIR,
  buildAnnotatedImageName,
  buildPickedImageName,
  buildWorkspaceImageName
} from './workspace-file-core'

/** Directory Kun writes generated images, annotations, and canvas exports to. */
export const GENERATED_IMAGE_DIR = KUN_GENERATED_IMAGE_DIR

export function readUInt24LE(buffer: Buffer, offset: number): number {
  return buffer[offset] + (buffer[offset + 1] << 8) + (buffer[offset + 2] << 16)
}

export function imageDimensionsFromBuffer(
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

export function buildClipboardTempImagePath(now = new Date()): string {
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
