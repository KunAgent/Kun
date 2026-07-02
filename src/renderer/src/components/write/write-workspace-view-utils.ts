import { useEffect, useState, type ReactElement } from 'react'
import type { WriteExportFormat } from '@shared/write-export'
import type { WritePreviewMode, WriteSaveStatus } from '../../write/write-workspace-store'
import { parseWriteMarkdown } from '../../write/tiptap/markdown-manager'

export const WRITE_AUTOSAVE_MS = 900
export const WRITE_PREVIEW_DEBOUNCE_MS = 60

/**
 * Preview re-render debounce that scales with document size: small files keep
 * the near-instant 60ms feel while large documents stop re-parsing the whole
 * Markdown tree on every keystroke.
 */
export function writePreviewDebounceMs(contentLength: number): number {
  if (contentLength < 30_000) return WRITE_PREVIEW_DEBOUNCE_MS
  if (contentLength < 120_000) return 180
  if (contentLength < 300_000) return 320
  return 500
}
export const INLINE_AGENT_MIN_WIDTH = 264
export const INLINE_AGENT_MAX_WIDTH = 340
export const INLINE_AGENT_GAP = 8
export const WRITE_EXPORT_NOTICE_MS = 3_600
export const INLINE_EDIT_RECENT_CONTEXT_CHARS = 180
export const WRITE_EXPORT_FORMATS: WriteExportFormat[] = ['html', 'pdf', 'png', 'doc', 'docx']
export const WRITE_RICH_CLIPBOARD_ACTION = 'clipboard'

export type WriteNotice = {
  tone: 'success' | 'error'
  message: string
}

export type WriteDocumentStats = {
  characterCount: number
}

export type WriteModeMenuItem = {
  mode: WritePreviewMode
  label: string
  shortLabel: string
  icon: ReactElement
  active: boolean
}

export type WriteInlineAgentPosition = {
  left: number
  width: number
  /** Top of the selection rect in viewport coords; the menu measures itself and places above/below. */
  anchorTop: number
  /** Bottom of the selection rect in viewport coords. */
  anchorBottom: number
}

export function isMarkdownFile(filePath: string): boolean {
  return /\.(md|markdown|mdx)$/i.test(filePath)
}

export function formatSaveLabel(status: WriteSaveStatus, t: (key: string) => string): string {
  if (status === 'saving') return t('writeSaving')
  if (status === 'dirty') return t('writeUnsaved')
  if (status === 'error') return t('writeSaveError')
  return t('writeSaved')
}

function collectVisibleText(node: { type?: string; text?: string; content?: unknown[] } | undefined, acc: string[]): string[] {
  if (!node) return acc
  if (node.type === 'text' && typeof node.text === 'string') acc.push(node.text)
  if (Array.isArray(node.content)) {
    for (const child of node.content) {
      if (child && typeof child === 'object') {
        collectVisibleText(child as { type?: string; text?: string; content?: unknown[] }, acc)
      }
    }
  }
  return acc
}

function visibleTextFromMarkdown(markdown: string): string {
  try {
    return collectVisibleText(parseWriteMarkdown(markdown), []).join('')
  } catch {
    return markdown
  }
}

export function computeWriteDocumentStats(content: string, isMarkdown: boolean): WriteDocumentStats {
  const visibleText = isMarkdown ? visibleTextFromMarkdown(content) : content
  const characterCount = Array.from(visibleText.replace(/\s+/g, '')).length
  return { characterCount }
}

export function clamp(value: number, min: number, max: number): number {
  if (max < min) return min
  return Math.min(Math.max(value, min), max)
}

export function useDebouncedValue<T>(value: T, delayMs: number): T {
  const [debounced, setDebounced] = useState(value)

  useEffect(() => {
    const timeoutId = window.setTimeout(() => setDebounced(value), delayMs)
    return () => window.clearTimeout(timeoutId)
  }, [value, delayMs])

  return debounced
}

export function inlineAgentPosition(selection: {
  anchorRect?: { left: number; top: number; bottom: number; width: number } | null
}, options: { compact?: boolean } = {}): WriteInlineAgentPosition | null {
  const rect = selection.anchorRect
  if (!rect) return null
  const minWidth = options.compact ? 240 : INLINE_AGENT_MIN_WIDTH
  const maxWidth = options.compact ? 320 : INLINE_AGENT_MAX_WIDTH
  const targetRatio = options.compact ? 0.22 : 0.28
  const width = clamp(Math.round(window.innerWidth * targetRatio), minWidth, maxWidth)
  const left = clamp(rect.left + rect.width / 2 - width / 2, 16, window.innerWidth - width - 16)
  return {
    left,
    width,
    anchorTop: rect.top,
    anchorBottom: rect.bottom
  }
}

export function modeButtonClass(active: boolean): string {
  return `inline-flex h-8 items-center justify-center rounded-lg px-2.5 text-[13px] transition ${
    active
      ? 'bg-white text-ds-ink shadow-sm ring-1 ring-ds-border-muted dark:bg-white/10 dark:ring-white/10'
      : 'text-ds-faint hover:bg-white/70 hover:text-ds-ink dark:hover:bg-white/8'
  }`
}

export function toolbarIconButtonClass(active = false): string {
  return `inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-lg text-ds-faint transition ${
    active
      ? 'bg-accent/10 text-accent'
      : 'hover:bg-white/70 hover:text-ds-ink dark:hover:bg-white/8'
  }`
}

export function toolbarMenuButtonClass(active = false): string {
  return `inline-flex h-8 shrink-0 items-center gap-1 rounded-lg px-2.5 text-[12.5px] font-medium text-ds-faint transition ${
    active
      ? 'bg-accent/10 text-accent'
      : 'hover:bg-white/70 hover:text-ds-ink dark:hover:bg-white/8'
  }`
}

export function exportFormatLabel(format: WriteExportFormat, t: (key: string) => string): string {
  if (format === 'html') return t('writeExportHtml')
  if (format === 'pdf') return t('writeExportPdf')
  if (format === 'png') return t('writeExportPng')
  if (format === 'doc') return t('writeExportDoc')
  return t('writeExportDocx')
}
