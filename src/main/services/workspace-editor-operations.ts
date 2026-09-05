import { app, nativeImage, shell } from 'electron'
import { execFile } from 'node:child_process'
import { readFile, stat, unlink } from 'node:fs/promises'
import { homedir, tmpdir } from 'node:os'
import { basename, dirname, extname, isAbsolute, join, posix } from 'node:path'
import { createHash, randomUUID } from 'node:crypto'
import { promisify } from 'node:util'
import type {
  EditorInfo,
  EditorListResult,
  EditorOpenResult,
  OpenEditorPathOptions
} from '../../shared/editor'
import { pathExists, resolveOpenTargetPath } from './workspace-paths'

import {
  DEFAULT_EDITOR_ID,
  GENERATED_DOCUMENT_FILE_SUFFIXES,
  MAX_KUN_PRESENTATION_HTML_BYTES,
  PRESENTATION_FILE_SUFFIXES,
  ResolvedEditor,
  defaultEditorId,
  editorIconDataUrl,
  execFileAsync,
  getAvailableEditors,
  isValidIconDataUrl,
  openPathWithShell
} from './workspace-editor-resolution'

export async function listEditorsResult(): Promise<EditorListResult> {
  const editors = await getAvailableEditors()
  const icons = await Promise.all(editors.map((editor) => editorIconDataUrl(editor)))
  return {
    editors: editors.map(
      (
        {
          command: _command,
          macAppName: _macAppName,
          appPath: _appPath,
          iconPaths: _iconPaths,
          lineStyle: _lineStyle,
          openDirectory: _openDirectory,
          ...editor
        },
        index
      ) => ({
        ...editor,
        ...(isValidIconDataUrl(icons[index]) ? { iconDataUrl: icons[index] } : {})
      })
    ),
    defaultEditorId: defaultEditorId(editors)
  }
}

export function formatPathForEditor(targetPath: string, line?: number, column?: number): string {
  const safeLine = typeof line === 'number' && line > 0 ? Math.floor(line) : undefined
  const safeColumn = typeof column === 'number' && column > 0 ? Math.floor(column) : undefined
  if (!safeLine) return targetPath
  return `${targetPath}:${safeLine}${safeColumn ? `:${safeColumn}` : ''}`
}

export function buildEditorArgs(editor: ResolvedEditor, targetPath: string, line?: number, column?: number): string[] {
  if (editor.openDirectory) return [targetPath]
  if (!editor.lineStyle || !line) return [targetPath]

  if (editor.lineStyle === 'xcode') return ['-l', String(Math.floor(line)), targetPath]
  if (editor.lineStyle === 'vscode') return ['-g', formatPathForEditor(targetPath, line, column)]
  if (editor.lineStyle === 'sublime' || editor.lineStyle === 'zed') {
    return [formatPathForEditor(targetPath, line, column)]
  }
  return [targetPath]
}

export async function directoryForOpenTarget(targetPath: string): Promise<string> {
  try {
    const info = await stat(targetPath)
    return info.isDirectory() ? targetPath : dirname(targetPath)
  } catch {
    return dirname(targetPath)
  }
}

export async function openWithResolvedEditor(
  editor: ResolvedEditor,
  targetPath: string,
  line?: number,
  column?: number
): Promise<void> {
  if (editor.id === 'finder' || editor.id === 'file-manager') {
    shell.showItemInFolder(targetPath)
    return
  }

  if (editor.id === 'system') {
    const result = await openPathWithShell(targetPath)
    if (!result.ok) throw new Error(result.message ?? 'Could not open path.')
    return
  }

  const openTarget = editor.openDirectory ? await directoryForOpenTarget(targetPath) : targetPath

  if (editor.command) {
    try {
      await execFileAsync(editor.command, buildEditorArgs(editor, openTarget, line, column), {
        timeout: 10_000,
        windowsHide: true
      })
      return
    } catch (error) {
      if (process.platform !== 'darwin' || !editor.macAppName) throw error
    }
  }

  if (process.platform === 'darwin' && editor.macAppName) {
    await execFileAsync('open', ['-a', editor.macAppName, openTarget], {
      timeout: 10_000,
      windowsHide: true
    })
    return
  }

  const result = await openPathWithShell(openTarget)
  if (!result.ok) throw new Error(result.message ?? 'Could not open path.')
}

export async function openEditorPath(payload: OpenEditorPathOptions): Promise<EditorOpenResult> {
  try {
    const editors = await getAvailableEditors()
    const fallbackId = defaultEditorId(editors)
    const requestedId = payload.editorId?.trim()
    const editor =
      editors.find((item) => item.id === requestedId) ??
      editors.find((item) => item.id === fallbackId) ??
      editors.find((item) => item.id === DEFAULT_EDITOR_ID)
    if (!editor) throw new Error('No editor or system opener is available.')

    const targetPath = payload.openPolicy
      ? await resolveOpenTargetPath(payload.path, payload.workspaceRoot, { allowBasenameFallback: false })
      : await resolveOpenTargetPath(payload.path, payload.workspaceRoot)
    if (payload.openPolicy) {
      const info = await stat(targetPath)
      if (!info.isFile()) throw new Error('Path must point to a regular file.')
      const normalizedTarget = targetPath.toLowerCase()
      const allowedSuffixes = payload.openPolicy === 'presentation-artifact'
        ? PRESENTATION_FILE_SUFFIXES
        : GENERATED_DOCUMENT_FILE_SUFFIXES
      if (!allowedSuffixes.some((suffix) => normalizedTarget.endsWith(suffix))) {
        throw new Error('Resolved file type is not allowed for this action.')
      }
      if (editor.id === 'system' && normalizedTarget.endsWith('.kun-ppt.html')) {
        const expectedSha256 = payload.expectedSha256?.toLowerCase()
        if (!expectedSha256) throw new Error('Verified presentation digest is required.')
        if (info.size > MAX_KUN_PRESENTATION_HTML_BYTES) {
          throw new Error('Presentation HTML exceeds the verified open limit.')
        }
        const content = await readFile(targetPath)
        const actualSha256 = createHash('sha256').update(content).digest('hex')
        if (actualSha256 !== expectedSha256) {
          throw new Error('Presentation changed after it was generated. Save it again in Kun PPT before opening.')
        }
      }
    }
    await openWithResolvedEditor(editor, targetPath, payload.line, payload.column)
    return { ok: true, path: targetPath, editorId: editor.id }
  } catch (error) {
    return {
      ok: false,
      message: error instanceof Error ? error.message : String(error)
    }
  }
}
