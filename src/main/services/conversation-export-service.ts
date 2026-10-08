import { app, BrowserWindow, dialog } from 'electron'
import { mkdir, writeFile } from 'node:fs/promises'
import { extname, join } from 'node:path'
import type {
  ConversationExportBatchPayload,
  ConversationExportBatchResult,
  ConversationExportFormat,
  ConversationExportPayload,
  ConversationExportResult
} from '../../shared/conversation-export'
import { renderMarkdownDocumentToPdf } from './write-export-service'

const FALLBACK_FILE_NAME = 'Kun-conversation'

export function sanitizeConversationExportFileName(value: string): string {
  return Array.from(value, (character) => {
    const code = character.charCodeAt(0)
    return code <= 31 || '<>:"/\\|?*'.includes(character) ? '-' : character
  })
    .join('')
    .trim()
    .replace(/\s+/g, ' ')
    .replace(/\.(?:md|pdf)$/i, '')
    .replace(/[. ]+$/g, '')
    .slice(0, 180)
}

export function ensureConversationExportExtension(
  filePath: string,
  format: ConversationExportFormat
): string {
  const expected = `.${format}`
  const current = extname(filePath)
  if (current.toLowerCase() === expected) return filePath
  return current ? `${filePath.slice(0, -current.length)}${expected}` : `${filePath}${expected}`
}

function exportDialogOptions(
  payload: ConversationExportPayload,
  downloadsPath: string
): Electron.SaveDialogOptions {
  const baseName =
    sanitizeConversationExportFileName(payload.defaultFileName) ||
    sanitizeConversationExportFileName(payload.title) ||
    FALLBACK_FILE_NAME
  const extension = payload.format
  return {
    title: 'Export conversation',
    defaultPath: join(downloadsPath, `${baseName}.${extension}`),
    filters: [{
      name: payload.format === 'pdf' ? 'PDF' : 'Markdown',
      extensions: [extension]
    }]
  }
}

export async function exportConversation(
  payload: ConversationExportPayload,
  options?: { parentWindow?: BrowserWindow | null; downloadsPath?: string }
): Promise<ConversationExportResult> {
  try {
    const downloadsPath = options?.downloadsPath ?? app.getPath('downloads')
    const dialogOptions = exportDialogOptions(payload, downloadsPath)
    const dialogResult = options?.parentWindow
      ? await dialog.showSaveDialog(options.parentWindow, dialogOptions)
      : await dialog.showSaveDialog(dialogOptions)

    if (dialogResult.canceled || !dialogResult.filePath) {
      return { ok: false, canceled: true }
    }

    const targetPath = ensureConversationExportExtension(dialogResult.filePath, payload.format)
    if (payload.format === 'md') {
      await writeFile(targetPath, payload.markdown, 'utf8')
    } else {
      const sourceFileName =
        sanitizeConversationExportFileName(payload.defaultFileName) || FALLBACK_FILE_NAME
      const pdf = await renderMarkdownDocumentToPdf({
        sourcePath: join(downloadsPath, `${sourceFileName}.md`),
        content: payload.markdown,
        title: payload.title
      })
      await writeFile(targetPath, pdf)
    }

    return {
      ok: true,
      path: targetPath,
      format: payload.format,
      exportedAt: new Date().toISOString()
    }
  } catch (error) {
    return {
      ok: false,
      canceled: false,
      message: error instanceof Error ? error.message : String(error)
    }
  }
}

async function createUniqueDirectory(parent: string, name: string): Promise<string> {
  for (let attempt = 1; attempt <= 99; attempt += 1) {
    const candidate = join(parent, attempt === 1 ? name : `${name} (${attempt})`)
    try {
      await mkdir(candidate)
      return candidate
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error
    }
  }
  throw new Error('Could not create a unique export folder')
}

function uniqueFileName(baseName: string, extension: string, used: Set<string>): string {
  for (let attempt = 1; ; attempt += 1) {
    const candidate = `${attempt === 1 ? baseName : `${baseName} (${attempt})`}.${extension}`
    const key = candidate.toLowerCase()
    if (!used.has(key)) {
      used.add(key)
      return candidate
    }
  }
}

/** Writes one file per conversation into a new dated folder inside a user-picked directory. */
export async function exportConversationBatch(
  payload: ConversationExportBatchPayload,
  options?: { parentWindow?: BrowserWindow | null; downloadsPath?: string }
): Promise<ConversationExportBatchResult> {
  try {
    const downloadsPath = options?.downloadsPath ?? app.getPath('downloads')
    const dialogOptions: Electron.OpenDialogOptions = {
      title: 'Export conversations',
      defaultPath: downloadsPath,
      properties: ['openDirectory', 'createDirectory']
    }
    const dialogResult = options?.parentWindow
      ? await dialog.showOpenDialog(options.parentWindow, dialogOptions)
      : await dialog.showOpenDialog(dialogOptions)
    const parent = dialogResult.filePaths[0]
    if (dialogResult.canceled || !parent) return { ok: false, canceled: true }

    const folderName = sanitizeConversationExportFileName(payload.folderName) || FALLBACK_FILE_NAME
    const directory = await createUniqueDirectory(parent, folderName)
    const used = new Set<string>()
    const failed: Array<{ title: string; message: string }> = []
    let written = 0

    for (const item of payload.items) {
      try {
        const baseName =
          sanitizeConversationExportFileName(item.defaultFileName) ||
          sanitizeConversationExportFileName(item.title) ||
          FALLBACK_FILE_NAME
        const fileName = uniqueFileName(baseName, payload.format, used)
        const targetPath = join(directory, fileName)
        if (payload.format === 'md') {
          await writeFile(targetPath, item.markdown, 'utf8')
        } else {
          const pdf = await renderMarkdownDocumentToPdf({
            sourcePath: join(directory, `${baseName}.md`),
            content: item.markdown,
            title: item.title
          })
          await writeFile(targetPath, pdf)
        }
        written += 1
      } catch (error) {
        failed.push({
          title: item.title,
          message: error instanceof Error ? error.message : String(error)
        })
      }
    }

    return {
      ok: true,
      directory,
      format: payload.format,
      exportedAt: new Date().toISOString(),
      written,
      failed
    }
  } catch (error) {
    return {
      ok: false,
      canceled: false,
      message: error instanceof Error ? error.message : String(error)
    }
  }
}
