import { useEffect, useState, type ReactElement } from 'react'
import type { WriteExportFormat } from '@shared/write-export'
import type { WritePreviewMode, WriteSaveStatus } from '../../write/write-workspace-store'
import { parseWriteMarkdown } from '../../write/tiptap/markdown-manager'

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
export const INLINE_AGENT_VIEWPORT_MARGIN = 16
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
  anchorLeft: number
  anchorRight: number
  /** Top of the selection rect in viewport coords; the menu measures itself and places above/below. */
  anchorTop: number
  /** Bottom of the selection rect in viewport coords. */
  anchorBottom: number
}

export type WriteInlineAgentPlacement = {
  left: number
  top: number
  maxHeight: number
  constrained: boolean
  origin: 'top-center' | 'bottom-center' | 'center-left' | 'center-right'
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
  anchorRect?: { left: number; right?: number; top: number; bottom: number; width: number } | null
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
    anchorLeft: rect.left,
    anchorRight: Number.isFinite(rect.right) ? Number(rect.right) : rect.left + rect.width,
    anchorTop: rect.top,
    anchorBottom: rect.bottom
  }
}

export function inlineAgentPlacement(
  action: WriteInlineAgentPosition,
  options: {
    menuHeight: number
    viewportWidth: number
    viewportHeight: number
    preferAbove?: boolean
  }
): WriteInlineAgentPlacement {
  const viewportWidth = Math.max(0, options.viewportWidth)
  const viewportHeight = Math.max(0, options.viewportHeight)
  const maxViewportHeight = Math.max(0, viewportHeight - INLINE_AGENT_VIEWPORT_MARGIN * 2)
  const naturalMenuHeight = Math.max(0, options.menuHeight)
  const menuHeight = Math.min(naturalMenuHeight, maxViewportHeight)
  const left = clamp(
    action.left,
    INLINE_AGENT_VIEWPORT_MARGIN,
    viewportWidth - action.width - INLINE_AGENT_VIEWPORT_MARGIN
  )
  const aboveSpace = Math.max(
    0,
    action.anchorTop - INLINE_AGENT_GAP - INLINE_AGENT_VIEWPORT_MARGIN
  )
  const belowSpace = Math.max(
    0,
    viewportHeight - INLINE_AGENT_VIEWPORT_MARGIN - action.anchorBottom - INLINE_AGENT_GAP
  )
  const aboveFits = menuHeight <= aboveSpace
  const belowFits = menuHeight <= belowSpace

  if (options.preferAbove && aboveFits || !belowFits && aboveFits) {
    return {
      left,
      top: action.anchorTop - INLINE_AGENT_GAP - menuHeight,
      maxHeight: menuHeight,
      constrained: naturalMenuHeight > menuHeight,
      origin: 'bottom-center'
    }
  }
  if (belowFits) {
    return {
      left,
      top: action.anchorBottom + INLINE_AGENT_GAP,
      maxHeight: menuHeight,
      constrained: naturalMenuHeight > menuHeight,
      origin: 'top-center'
    }
  }

  const rightSpace = Math.max(
    0,
    viewportWidth - INLINE_AGENT_VIEWPORT_MARGIN - action.anchorRight - INLINE_AGENT_GAP
  )
  const leftSpace = Math.max(
    0,
    action.anchorLeft - INLINE_AGENT_GAP - INLINE_AGENT_VIEWPORT_MARGIN
  )
  const rightFits = action.width <= rightSpace
  const leftFits = action.width <= leftSpace
  if (rightFits || leftFits) {
    const placeRight = rightFits && (!leftFits || rightSpace >= leftSpace)
    return {
      left: placeRight
        ? action.anchorRight + INLINE_AGENT_GAP
        : action.anchorLeft - INLINE_AGENT_GAP - action.width,
      top: clamp(
        (action.anchorTop + action.anchorBottom - menuHeight) / 2,
        INLINE_AGENT_VIEWPORT_MARGIN,
        viewportHeight - menuHeight - INLINE_AGENT_VIEWPORT_MARGIN
      ),
      maxHeight: menuHeight,
      constrained: naturalMenuHeight > menuHeight,
      origin: placeRight ? 'center-left' : 'center-right'
    }
  }

  const placeAbove = options.preferAbove ? aboveSpace > 0 : aboveSpace > belowSpace
  const maxHeight = placeAbove ? aboveSpace : belowSpace
  return {
    left,
    top: placeAbove
      ? action.anchorTop - INLINE_AGENT_GAP - maxHeight
      : action.anchorBottom + INLINE_AGENT_GAP,
    maxHeight,
    constrained: naturalMenuHeight > maxHeight,
    origin: placeAbove ? 'bottom-center' : 'top-center'
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
