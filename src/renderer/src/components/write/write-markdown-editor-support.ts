import { Annotation, EditorSelection, EditorState, type Extension } from '@codemirror/state'
import { defaultKeymap, history, historyKeymap, indentWithTab } from '@codemirror/commands'
import { markdown, markdownLanguage } from '@codemirror/lang-markdown'
import { bracketMatching, indentOnInput } from '@codemirror/language'
import { languages } from '@codemirror/language-data'
import {
  drawSelection,
  EditorView,
  highlightActiveLine,
  keymap,
  lineNumbers,
  type ViewUpdate
} from '@codemirror/view'
import i18n from '../../i18n'
import {
  applyWriteBlockTypeToLines,
  detectWriteBlockTypeFromLine
} from '../../write/block-type'
import { createWriteRecentEdit, type WriteRecentEdit } from '../../write/recent-edits'
import { isSelectableRasterImageSrc, parseImageMarkdownLine } from '../../write/selected-image'
import { buildWriteTemplateShortcutExpansion } from '../../write/template-shortcuts'
import {
  buildWriteCanonicalTermPropagationChanges,
  buildWriteTermPropagationChanges,
  type WriteTermReplacementSeed
} from '../../write/term-propagation'
import type {
  WriteEditorSelectionState,
  WriteSelectedImage,
  WriteSelectionAnchorRect,
  WriteSelectionRange
} from './write-markdown-editor-types'
import type { WriteEditorDisplayPreferences } from '../../write/write-editor-display-preferences'

export const externalValueSyncAnnotation = Annotation.define<boolean>()
export const termPropagationAnnotation = Annotation.define<boolean>()
const RECENT_EDIT_CONTEXT_CHARS = 160

export function clampOffset(state: EditorState, offset = 0): number {
  const size = state.doc.length
  const value = Number(offset)
  if (!Number.isFinite(value)) return 0
  return Math.max(0, Math.min(size, Math.floor(value)))
}

function positionForOffset(state: EditorState, offset: number): { line: number; column: number } {
  const point = clampOffset(state, offset)
  const line = state.doc.lineAt(point)
  return {
    line: line.number,
    column: point - line.from + 1
  }
}

function unionRects(rects: Array<{ left: number; right: number; top: number; bottom: number }>): WriteSelectionAnchorRect | undefined {
  if (rects.length === 0) return undefined
  let left = Number.POSITIVE_INFINITY
  let right = Number.NEGATIVE_INFINITY
  let top = Number.POSITIVE_INFINITY
  let bottom = Number.NEGATIVE_INFINITY
  for (const rect of rects) {
    left = Math.min(left, rect.left)
    right = Math.max(right, rect.right)
    top = Math.min(top, rect.top)
    bottom = Math.max(bottom, rect.bottom)
  }
  if (!Number.isFinite(left) || !Number.isFinite(right) || !Number.isFinite(top) || !Number.isFinite(bottom)) {
    return undefined
  }
  return {
    left,
    right,
    top,
    bottom,
    width: right - left,
    height: bottom - top
  }
}

function selectionAnchorRect(
  view: EditorView,
  ranges: Array<Pick<WriteSelectionRange, 'from' | 'to'>>
): WriteSelectionAnchorRect | undefined {
  const rects: Array<{ left: number; right: number; top: number; bottom: number }> = []
  for (const range of ranges) {
    const start = view.coordsAtPos(range.from, 1)
    const end = view.coordsAtPos(range.to, -1) ?? view.coordsAtPos(Math.max(range.from, range.to - 1), 1)
    if (start) rects.push(start)
    if (end) rects.push(end)
  }
  return unionRects(rects)
}

export function selectionState(view: EditorView): WriteEditorSelectionState {
  const ranges = view.state.selection.ranges
    .map((range): WriteSelectionRange | null => {
      if (range.empty) return null
      const from = clampOffset(view.state, range.from)
      const to = clampOffset(view.state, range.to)
      const start = positionForOffset(view.state, from)
      const end = positionForOffset(view.state, Math.max(from, to - 1))
      const text = view.state.sliceDoc(from, to)
      return {
        from,
        to,
        startLine: start.line,
        startColumn: start.column,
        endLine: end.line,
        endColumn: end.column,
        text,
        charCount: Math.max(0, to - from)
      }
    })
    .filter((value): value is WriteSelectionRange => value !== null)

  const text = ranges.map((range) => range.text).join('\n\n')
  const mainFrom = clampOffset(view.state, view.state.selection.main.from)
  const mainLine = view.state.doc.lineAt(mainFrom)

  // A bare caret on an image markdown line counts as selecting that image
  // (clicking the live-preview image widget focuses its source line).
  let selectedImage: WriteSelectedImage | undefined
  if (ranges.length === 0 && view.state.selection.ranges.length === 1) {
    const parsed = parseImageMarkdownLine(mainLine.text)
    if (parsed && isSelectableRasterImageSrc(parsed.src)) {
      selectedImage = { ...parsed, line: { from: mainLine.from, to: mainLine.to } }
    }
  }

  return {
    text,
    ranges,
    charCount: ranges.reduce((total, range) => total + range.charCount, 0),
    anchorRect: selectedImage
      ? selectionAnchorRect(view, [{ from: mainLine.from, to: mainLine.to }])
      : selectionAnchorRect(view, ranges),
    blockType: detectWriteBlockTypeFromLine(mainLine.text),
    ...(selectedImage ? { selectedImage } : {})
  }
}

export function recentEditsFromUpdate(update: ViewUpdate, filePath: string): WriteRecentEdit[] {
  const path = filePath.trim()
  if (!path || !update.docChanged) return []
  const edits: WriteRecentEdit[] = []
  const timestamp = Date.now()

  update.changes.iterChanges((fromA, toA, fromB, toB, inserted) => {
    const edit = createWriteRecentEdit({
      source: 'user',
      timestamp,
      filePath: path,
      from: fromA,
      to: toA,
      deletedText: update.startState.sliceDoc(fromA, toA),
      insertedText: inserted.toString(),
      beforeContext: update.startState.sliceDoc(Math.max(0, fromA - RECENT_EDIT_CONTEXT_CHARS), fromA),
      afterContext: update.state.sliceDoc(toB, Math.min(update.state.doc.length, toB + RECENT_EDIT_CONTEXT_CHARS))
    })
    if (edit) edits.push(edit)
  })

  return edits
}

export function termReplacementSeedFromUpdate(update: ViewUpdate): WriteTermReplacementSeed | null {
  const changes: WriteTermReplacementSeed[] = []
  update.changes.iterChanges((fromA, toA, fromB, toB, inserted) => {
    changes.push({
      from: fromB,
      to: toB,
      deletedText: update.startState.sliceDoc(fromA, toA),
      insertedText: inserted.toString()
    })
  })
  if (changes.length !== 1) return null
  const [change] = changes
  if (!change.deletedText || !change.insertedText) return null
  return change
}

export function buildEditorTheme(): Extension {
  return EditorView.theme({
    '&': {
      height: '100%',
      minWidth: '0',
      minHeight: '0',
      color: 'var(--ds-text)',
      backgroundColor: 'transparent',
      fontFamily: 'ui-monospace, SFMono-Regular, Menlo, Consolas, "Liberation Mono", monospace',
      fontSize: 'var(--write-editor-font-size, 16px)'
    },
    '.cm-scroller': {
      overflow: 'auto',
      lineHeight: 'var(--write-editor-line-height, 1.75)',
      backgroundColor: 'transparent'
    },
    '.cm-content': {
      minHeight: '100%',
      padding: '26px 24px 56px',
      caretColor: 'var(--ds-text)'
    },
    '.cm-cursor, .cm-dropCursor': {
      borderLeftColor: 'var(--ds-text)'
    },
    '.cm-selectionBackground': {
      backgroundColor: 'var(--write-selection-bg, var(--ds-selection))'
    },
    '.cm-content::selection, .cm-content *::selection': {
      backgroundColor: 'var(--write-selection-bg, var(--ds-selection))',
      color: 'var(--write-selection-text, inherit)'
    },
    '.cm-gutters': {
      display: 'none'
    },
    '.cm-activeLine': {
      backgroundColor: 'rgba(0, 0, 0, 0.025)'
    },
    '[data-theme="dark"] & .cm-activeLine': {
      backgroundColor: 'rgba(255, 255, 255, 0.04)'
    }
  })
}

export function buildInteractionExtensions(readOnly: boolean): Extension[] {
  return [
    EditorState.readOnly.of(readOnly),
    EditorView.editable.of(!readOnly),
    EditorView.contentAttributes.of({
      spellcheck: readOnly ? 'false' : 'true',
      autocorrect: readOnly ? 'off' : 'on',
      autocapitalize: readOnly ? 'off' : 'sentences',
      'data-write-editor-mode': 'source'
    })
  ]
}

export function hasClipboardImage(event: ClipboardEvent): boolean {
  const items = event.clipboardData?.items
  if (!items) return false
  return Array.from(items).some((item) => item.kind === 'file' && item.type.startsWith('image/'))
}

export function buildPastedImageMarkdown(
  state: EditorState,
  from: number,
  to: number,
  markdownPath: string
): { text: string; cursor: number } {
  const before = from > 0 ? state.sliceDoc(from - 1, from) : ''
  const after = to < state.doc.length ? state.sliceDoc(to, to + 1) : ''
  const leadingBreak = from > 0 && before !== '\n' ? '\n' : ''
  const trailingBreak = after && after !== '\n' ? '\n' : ''
  const text = `${leadingBreak}![Pasted image](${markdownPath})${trailingBreak}\n`
  return {
    text,
    cursor: from + text.length
  }
}

export function expandWriteTemplateShortcut(view: EditorView): boolean {
  const selection = view.state.selection.main
  if (!selection.empty) return false
  const expansion = buildWriteTemplateShortcutExpansion({
    text: view.state.doc.toString(),
    cursor: selection.head
  })
  if (!expansion) return false

  const nextHead = expansion.from + expansion.insert.length
  view.dispatch({
    changes: {
      from: expansion.from,
      to: expansion.to,
      insert: expansion.insert
    },
    selection: EditorSelection.cursor(nextHead),
    scrollIntoView: true
  })
  return true
}

export function writeEditorDisplayExtensions(
  preferences: WriteEditorDisplayPreferences
): Extension[] {
  return [
    ...(preferences.lineNumbers ? [lineNumbers()] : []),
    ...(preferences.lineWrapping ? [EditorView.lineWrapping] : [])
  ]
}
