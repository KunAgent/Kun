import { BrowserWindow, dialog } from 'electron'
import { writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { homedir } from 'node:os'
import type {
  MemoryMarkdownExportSavePayload,
  MemoryMarkdownExportSaveResult
} from '../../shared/memory-import-export'
import { validateProjectKnowledgeExport } from '../../shared/project-memory-interoperability'
import { defaultMemoryExportFileName } from '../../shared/memory-import-export'

export async function exportMemoryMarkdown(
  payload: MemoryMarkdownExportSavePayload,
  options?: { parentWindow?: BrowserWindow | null }
): Promise<MemoryMarkdownExportSaveResult> {
  try {
    if (payload.projectKnowledge) validateProjectKnowledgeExport(payload.markdown, payload.projectKnowledge)
    const dialogResult = options?.parentWindow
      ? await dialog.showSaveDialog(options.parentWindow, saveDialogOptions(payload.defaultFileName))
      : await dialog.showSaveDialog(saveDialogOptions(payload.defaultFileName))

    if (dialogResult.canceled || !dialogResult.filePath) {
      return { ok: false, canceled: true }
    }

    const targetPath = ensureMarkdownExtension(dialogResult.filePath)
    await writeFile(targetPath, payload.markdown, 'utf8')
    return {
      ok: true,
      path: targetPath,
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

function saveDialogOptions(defaultFileName: string | undefined): Electron.SaveDialogOptions {
  return {
    title: 'Export memory',
    defaultPath: join(homedir(), sanitizeFileName(defaultFileName) || defaultMemoryExportFileName()),
    filters: [{ name: 'Markdown', extensions: ['md'] }]
  }
}

function ensureMarkdownExtension(filePath: string): string {
  return filePath.toLowerCase().endsWith('.md') ? filePath : `${filePath}.md`
}

function sanitizeFileName(value: string | undefined): string {
  return replaceControlCharacters(value ?? '')
    .trim()
    .replace(/[<>:"/\\|?*]+/g, '-')
    .replace(/\s+/g, ' ')
    .slice(0, 180)
}

function replaceControlCharacters(value: string): string {
  return Array.from(value, (char) => char.charCodeAt(0) <= 0x1f ? '-' : char).join('')
}
