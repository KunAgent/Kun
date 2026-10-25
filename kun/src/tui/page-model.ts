import type { TuiKeyEvent } from './keys.js'
import { stripSgr } from './ansi-text.js'
import type { ThreadProjection } from './state.js'
import type { TextField } from './text-field.js'

export type PageActionTone = 'normal' | 'danger' | 'warning'

export type PageAction = {
  key: string
  label: string
  tone?: PageActionTone
}

/**
 * Body content of an exclusive page. Text values may carry SGR styling from
 * `visual.*`; the terminal app maps those codes to theme colors, so formatter
 * output and native components share one palette.
 */
export type PageBlock =
  | { kind: 'line'; text: string; index?: number }
  | { kind: 'text'; text: string }
  | { kind: 'section'; label: string; right?: string }
  | { kind: 'row'; left: string; right?: string; selected: boolean; index?: number }
  | {
      kind: 'field'
      field: TextField
      label?: string
      masked?: boolean
      placeholder?: string
      focused?: boolean
    }
  | { kind: 'spacer' }
  | { kind: 'transcript'; transcript: PageTranscript }

export type PageView = {
  path: readonly string[]
  right?: string
  description?: string
  body: PageBlock[]
  footer: PageAction[]
  /** `popup` renders a bordered, centered panel (child session, Graph board). */
  frame?: 'page' | 'popup'
  popupTitle?: string
  /** Bottom status line inside the frame, e.g. a live-connection indicator. */
  status?: { left: string; right?: string }
}

export type PageMouseEvent =
  | { type: 'scroll'; delta: number }
  | { type: 'row'; index: number; activate: boolean }

export type PageSize = { width: number; height: number }

export interface TuiPage {
  readonly kind: string
  view(size: PageSize): PageView
  handleKey(key: TuiKeyEvent): void
  handlePaste?(text: string): void
  handleMouse?(event: PageMouseEvent): void
  dispose?(): void
}

/**
 * Scroll position for a transcript rendered inside a page. Content height is
 * only known after layout, so the app reports measurements and the model
 * keeps the follow-tail rule: new output stays visible until the user scrolls
 * up, and scrolling back to the end resumes following.
 */
export class PageScrollState {
  offset = 0
  follow = true
  total = 0
  viewport = 1

  measure(total: number, viewport: number): void {
    this.total = Math.max(0, total)
    this.viewport = Math.max(1, viewport)
    const max = this.maxOffset()
    this.offset = this.follow ? max : Math.min(this.offset, max)
  }

  maxOffset(): number {
    return Math.max(0, this.total - this.viewport)
  }

  scrollBy(delta: number): void {
    this.scrollTo(this.offset + delta)
  }

  scrollTo(target: number): void {
    const max = this.maxOffset()
    this.offset = Math.max(0, Math.min(target, max))
    this.follow = this.offset >= max
  }

  page(): number {
    return Math.max(1, this.viewport - 1)
  }

  label(): string {
    if (this.total <= this.viewport) return `${this.total} lines`
    return `${this.offset + 1}-${Math.min(this.total, this.offset + this.viewport)}/${this.total}`
  }
}

export type PageTranscript = {
  projection?: ThreadProjection
  showReasoning: boolean
  showToolDetails: boolean
  reasoningOverrides: ReadonlyMap<string, boolean>
  toggleReasoning: (itemId: string) => void
  scroll: PageScrollState
  /** Lines shown instead of the transcript (loading, errors, empty state). */
  placeholder?: string[]
}

export function rowBlock(left: string, right: string | undefined, selected: boolean, index?: number): PageBlock {
  return { kind: 'row', left, ...(right ? { right } : {}), selected, ...(index === undefined ? {} : { index }) }
}

export function sectionBlock(label: string, right?: string): PageBlock {
  return { kind: 'section', label, ...(right ? { right } : {}) }
}

export function lineBlocks(lines: readonly string[]): PageBlock[] {
  return lines.map((text) => (text === '' ? { kind: 'spacer' } : { kind: 'line', text }))
}

/** Plain-text rendering of a page, used by tests and accessibility checks. */
export function pageText(view: PageView): string {
  const lines: string[] = [view.path.join(' / ')]
  if (view.right) lines.push(view.right)
  if (view.popupTitle) lines.push(view.popupTitle)
  if (view.description) lines.push(view.description)
  for (const block of view.body) {
    switch (block.kind) {
      case 'line':
      case 'text': lines.push(block.text); break
      case 'section': lines.push(`── ${block.label}${block.right ? ` ${block.right}` : ''}`); break
      case 'row': lines.push(`${block.selected ? '│ ' : '  '}${block.left}${block.right ? `  ${block.right}` : ''}`); break
      case 'field': {
        const value = block.field.getValue()
        const shown = block.masked ? '•'.repeat(Math.min(48, Array.from(value).length)) : value
        lines.push(`${block.label ? `${block.label}: ` : ''}${shown || block.placeholder || ''}`)
        break
      }
      case 'spacer': lines.push(''); break
      case 'transcript': lines.push(...(block.transcript.placeholder ?? ['[transcript]'])); break
    }
  }
  if (view.status) lines.push(`${view.status.left}${view.status.right ? `  ${view.status.right}` : ''}`)
  lines.push(view.footer.map((action) => `${action.key} ${action.label}`).join('  ·  '))
  return stripSgr(lines.join('\n'))
}
