import { useEffect, useRef, type MutableRefObject, type ReactElement } from 'react'
import { Annotation, Compartment, EditorSelection, EditorState, type Extension } from '@codemirror/state'
import { defaultKeymap, history, historyKeymap, indentWithTab } from '@codemirror/commands'
import { markdown, markdownLanguage } from '@codemirror/lang-markdown'
import { bracketMatching, indentOnInput } from '@codemirror/language'
import { languages } from '@codemirror/language-data'
import { drawSelection, EditorView, highlightActiveLine, keymap, showPanel, type Panel, type ViewUpdate } from '@codemirror/view'
import { acceptChunk, getChunks, rejectChunk, unifiedMergeView } from '@codemirror/merge'
import i18n from '../../i18n'
import {
  applyWriteBlockTypeToLines,
  detectWriteBlockTypeFromLine,
  type WriteBlockType
} from '../../write/block-type'
import { buildInlineCompletionExtension, buildInlineCompletionPayload } from '../../write/inline-completion'
import { writeMarkdownLivePreviewExtensions } from '../../write/markdown-live-preview'
import { createWriteRecentEdit, type WriteRecentEdit } from '../../write/recent-edits'
import { isSelectableRasterImageSrc, parseImageMarkdownLine } from '../../write/selected-image'
import { buildWriteTemplateShortcutExpansion } from '../../write/template-shortcuts'
import {
  buildWriteCanonicalTermPropagationChanges,
  buildWriteTermPropagationChanges,
  type WriteTermReplacementSeed
} from '../../write/term-propagation'
import { writeSelectionStatesEqual } from '../../write/write-selection'

export type WriteSelectionAnchorRect = {
  left: number
  right: number
  top: number
  bottom: number
  width: number
  height: number
}

export type WriteSelectionPageRect = {
  page: number
  x: number
  y: number
  width: number
  height: number
}

export type WriteSelectionRange = {
  from: number
  to: number
  startLine: number
  startColumn: number
  endLine: number
  endColumn: number
  text: string
  charCount: number
  page?: number
}

export type WriteEditorSelectionState = {
  text: string
  ranges: WriteSelectionRange[]
  charCount: number
  anchorRect?: WriteSelectionAnchorRect
  rects?: WriteSelectionPageRect[]
  sourceKind?: 'text' | 'pdf'
  pageStart?: number
  pageEnd?: number
  /** Block type of the line at the selection start (selection toolbar). */
  blockType?: WriteBlockType
  /** Set when a single raster image is selected (TipTap node selection or a
   * caret on an image markdown line in source mode). */
  selectedImage?: WriteSelectedImage
}

export type WriteSelectedImage = {
  src: string
  alt: string
  /** Source-mode only: the document offsets of the image markdown line. */
  line?: { from: number; to: number }
}

/**
 * Imperative surface for the selection toolbar: replaces a document range
 * through the editor so undo history stays granular and the selection ends up
 * covering the replacement (allowing chained formatting).
 */
export type WriteMarkdownEditorHandle = {
  applyRangeReplacement: (
    range: { from: number; to: number },
    original: string,
    replacement: string
  ) => boolean
  /** Rewrite the block markers of the lines spanning the current selection. */
  setBlockType: (type: WriteBlockType) => boolean
  /**
   * Enters an inline red/green diff review: swaps the document to `nextDoc` and
   * shows a per-chunk accept/reject merge view against `original`. Returns false
   * when the editor is read-only/unavailable, a review is already running, or
   * the texts are identical.
   */
  beginDiffReview: (params: { original: string; nextDoc: string }) => boolean
  /** True while an inline diff review is in progress. */
  isDiffReviewActive: () => boolean
  /** Accepts every pending diff chunk and commits the result. */
  acceptAllDiff: () => void
  /** Rejects every pending diff chunk (reverting to the original) and commits. */
  rejectAllDiff: () => void
}

type Props = {
  value: string
  workspaceRoot?: string | null
  filePath?: string | null
  imageDirectory?: string | null
  appearance?: 'source' | 'live'
  livePreviewEnabled?: boolean
  readOnly?: boolean
  completionModel: string
  completionEnabled: boolean
  completionDebounceMs: number
  completionMinAcceptScore: number
  completionLongEnabled: boolean
  completionLongDebounceMs: number
  completionLongMinAcceptScore: number
  recentEdits?: WriteRecentEdit[]
  onChange: (value: string) => void
  onDocumentEdit?: (edits: WriteRecentEdit[]) => void
  onSelectionChange: (selection: WriteEditorSelectionState) => void
  onSaveShortcut: () => void
  onImagePasteSaved?: () => void
  onImagePasteError?: (message: string) => void
  /** Notified when an inline diff review starts (true) or commits/cancels (false). */
  onReviewStateChange?: (active: boolean) => void
  handleRef?: MutableRefObject<WriteMarkdownEditorHandle | null>
}

const externalValueSyncAnnotation = Annotation.define<boolean>()
const termPropagationAnnotation = Annotation.define<boolean>()
const RECENT_EDIT_CONTEXT_CHARS = 160

function clampOffset(state: EditorState, offset = 0): number {
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

function selectionState(view: EditorView): WriteEditorSelectionState {
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

function recentEditsFromUpdate(update: ViewUpdate, filePath: string): WriteRecentEdit[] {
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

function termReplacementSeedFromUpdate(update: ViewUpdate): WriteTermReplacementSeed | null {
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

function buildEditorTheme(appearance: 'source' | 'live'): Extension {
  const sourceMode = appearance === 'source'
  return EditorView.theme({
    '&': {
      height: '100%',
      minWidth: '0',
      minHeight: '0',
      color: 'var(--ds-text)',
      backgroundColor: 'transparent',
      // Prose (live) appearance follows the configured editor font; the raw
      // source appearance keeps a monospace family but still honors the size.
      fontFamily: sourceMode
        ? 'ui-monospace, SFMono-Regular, Menlo, Consolas, "Liberation Mono", monospace'
        : "var(--write-editor-font-family, -apple-system, BlinkMacSystemFont, 'SF Pro Text', 'Segoe UI', 'PingFang SC', 'Hiragino Sans GB', 'Noto Sans SC', 'Microsoft YaHei', sans-serif)",
      fontSize: 'var(--write-editor-font-size, 16px)'
    },
    '.cm-scroller': {
      overflow: 'auto',
      lineHeight: 'var(--write-editor-line-height, 1.75)',
      backgroundColor: 'transparent'
    },
    '.cm-content': {
      minHeight: '100%',
      padding: sourceMode ? '26px 24px 56px' : 'clamp(40px, 7vh, 72px) 24px 120px',
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

function buildInteractionExtensions(readOnly: boolean, appearance: 'source' | 'live'): Extension[] {
  return [
    EditorState.readOnly.of(readOnly),
    EditorView.editable.of(!readOnly),
    EditorView.contentAttributes.of({
      spellcheck: readOnly ? 'false' : 'true',
      autocorrect: readOnly ? 'off' : 'on',
      autocapitalize: readOnly ? 'off' : 'sentences',
      'data-write-editor-mode': appearance
    })
  ]
}

function hasClipboardImage(event: ClipboardEvent): boolean {
  const items = event.clipboardData?.items
  if (!items) return false
  return Array.from(items).some((item) => item.kind === 'file' && item.type.startsWith('image/'))
}

function buildPastedImageMarkdown(
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

function expandWriteTemplateShortcut(view: EditorView): boolean {
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

export function WriteMarkdownEditor({
  value,
  workspaceRoot,
  filePath,
  imageDirectory,
  appearance = 'live',
  livePreviewEnabled = appearance === 'live',
  readOnly = false,
  completionModel,
  completionEnabled,
  completionDebounceMs,
  completionMinAcceptScore,
  completionLongEnabled,
  completionLongDebounceMs,
  completionLongMinAcceptScore,
  recentEdits = [],
  onChange,
  onDocumentEdit,
  onSelectionChange,
  onSaveShortcut,
  onImagePasteSaved,
  onImagePasteError,
  onReviewStateChange,
  handleRef
}: Props): ReactElement {
  const hostRef = useRef<HTMLDivElement | null>(null)
  const viewRef = useRef<EditorView | null>(null)
  const themeCompartmentRef = useRef<Compartment | null>(null)
  const livePreviewCompartmentRef = useRef<Compartment | null>(null)
  const editableCompartmentRef = useRef<Compartment | null>(null)
  const workspaceRootRef = useRef(workspaceRoot ?? '')
  const filePathRef = useRef(filePath ?? '')
  const imageDirectoryRef = useRef(imageDirectory ?? '')
  const livePreviewEnabledRef = useRef(livePreviewEnabled)
  const readOnlyRef = useRef(readOnly)
  const completionModelRef = useRef(completionModel)
  const completionEnabledRef = useRef(completionEnabled)
  const completionDebounceMsRef = useRef(completionDebounceMs)
  const completionMinAcceptScoreRef = useRef(completionMinAcceptScore)
  const completionLongEnabledRef = useRef(completionLongEnabled)
  const completionLongDebounceMsRef = useRef(completionLongDebounceMs)
  const completionLongMinAcceptScoreRef = useRef(completionLongMinAcceptScore)
  const recentEditsRef = useRef(recentEdits)
  const appearanceRef = useRef(appearance)
  const onChangeRef = useRef(onChange)
  const onDocumentEditRef = useRef(onDocumentEdit)
  const onSelectionChangeRef = useRef(onSelectionChange)
  const onSaveShortcutRef = useRef(onSaveShortcut)
  const onImagePasteSavedRef = useRef(onImagePasteSaved)
  const onImagePasteErrorRef = useRef(onImagePasteError)
  const onReviewStateChangeRef = useRef(onReviewStateChange)
  const mergeCompartmentRef = useRef<Compartment | null>(null)
  const reviewActiveRef = useRef(false)
  const valueRef = useRef(value)
  const lastSelectionRef = useRef<WriteEditorSelectionState | null>(null)
  const lastEmittedValueRef = useRef<string | null>(null)

  workspaceRootRef.current = workspaceRoot ?? ''
  filePathRef.current = filePath ?? ''
  imageDirectoryRef.current = imageDirectory ?? ''
  livePreviewEnabledRef.current = livePreviewEnabled
  readOnlyRef.current = readOnly
  completionModelRef.current = completionModel
  completionEnabledRef.current = completionEnabled
  completionDebounceMsRef.current = completionDebounceMs
  completionMinAcceptScoreRef.current = completionMinAcceptScore
  completionLongEnabledRef.current = completionLongEnabled
  completionLongDebounceMsRef.current = completionLongDebounceMs
  completionLongMinAcceptScoreRef.current = completionLongMinAcceptScore
  recentEditsRef.current = recentEdits
  appearanceRef.current = appearance
  onChangeRef.current = onChange
  onDocumentEditRef.current = onDocumentEdit
  onSelectionChangeRef.current = onSelectionChange
  onSaveShortcutRef.current = onSaveShortcut
  onImagePasteSavedRef.current = onImagePasteSaved
  onImagePasteErrorRef.current = onImagePasteError
  onReviewStateChangeRef.current = onReviewStateChange
  valueRef.current = value

  useEffect(() => {
    if (!hostRef.current) return

    const inlineCompletionCompartment = new Compartment()
    const themeCompartment = new Compartment()
    const livePreviewCompartment = new Compartment()
    const editableCompartment = new Compartment()
    const mergeCompartment = new Compartment()
    themeCompartmentRef.current = themeCompartment
    livePreviewCompartmentRef.current = livePreviewCompartment
    editableCompartmentRef.current = editableCompartment
    mergeCompartmentRef.current = mergeCompartment

    // --- Inline red/green diff review -----------------------------------------
    // AI rewrites enter a unified merge view (per-line accept/reject) instead of
    // overwriting the document. While a review is active, onChange is suppressed
    // so nothing is persisted until the user resolves every chunk.
    const finishDiffReview = (): void => {
      const instance = viewRef.current
      if (!instance || !reviewActiveRef.current) return
      const finalDoc = instance.state.doc.toString()
      reviewActiveRef.current = false
      instance.dispatch({
        effects: [
          mergeCompartment.reconfigure([]),
          // Restore the live-preview decorations that were suspended for review.
          livePreviewCompartment.reconfigure(
            appearanceRef.current === 'live' && livePreviewEnabledRef.current
              ? writeMarkdownLivePreviewExtensions(filePathRef.current, workspaceRootRef.current)
              : []
          )
        ]
      })
      lastEmittedValueRef.current = finalDoc
      onChangeRef.current(finalDoc)
      onReviewStateChangeRef.current?.(false)
    }
    const resolveAllDiffChunks = (mode: 'accept' | 'reject'): void => {
      const instance = viewRef.current
      if (!instance || !reviewActiveRef.current) return
      for (let guard = 0; guard < 10_000; guard += 1) {
        const data = getChunks(instance.state)
        if (!data || data.chunks.length === 0) break
        const pos = data.chunks[0].fromB
        if (mode === 'accept') acceptChunk(instance, pos)
        else rejectChunk(instance, pos)
      }
      finishDiffReview()
    }
    const buildDiffReviewPanel = (): Panel => {
      const dom = document.createElement('div')
      dom.className = 'cm-write-diff-panel'
      const label = document.createElement('span')
      label.className = 'cm-write-diff-panel-label'
      label.textContent = i18n.t('writeDiffReviewing', { ns: 'common' })
      const reject = document.createElement('button')
      reject.type = 'button'
      reject.className = 'cm-write-diff-reject-all'
      reject.textContent = i18n.t('writeDiffRejectAll', { ns: 'common' })
      reject.addEventListener('mousedown', (event) => event.preventDefault())
      reject.addEventListener('click', () => resolveAllDiffChunks('reject'))
      const accept = document.createElement('button')
      accept.type = 'button'
      accept.className = 'cm-write-diff-accept-all'
      accept.textContent = i18n.t('writeDiffAcceptAll', { ns: 'common' })
      accept.addEventListener('mousedown', (event) => event.preventDefault())
      accept.addEventListener('click', () => resolveAllDiffChunks('accept'))
      dom.append(label, reject, accept)
      return { dom, top: true }
    }
    // Restartable: when a review is already active (e.g. the agent edits the
    // file again mid-turn), this re-points the merge view at the new target
    // against the same baseline instead of bailing.
    const beginDiffReview = (original: string, nextDoc: string): boolean => {
      const instance = viewRef.current
      if (!instance || readOnlyRef.current) return false
      if (nextDoc === original) return false
      reviewActiveRef.current = true
      instance.dispatch({
        changes: { from: 0, to: instance.state.doc.length, insert: nextDoc },
        annotations: externalValueSyncAnnotation.of(true),
        effects: [
          // Suspend live-preview decorations so the raw red/green diff (and the
          // merge view's deleted-line widgets) render cleanly during review.
          livePreviewCompartment.reconfigure([]),
          mergeCompartment.reconfigure([
            unifiedMergeView({ original, gutter: false, collapseUnchanged: { margin: 3, minSize: 4 } }),
            showPanel.of(buildDiffReviewPanel)
          ])
        ]
      })
      lastEmittedValueRef.current = nextDoc
      onReviewStateChangeRef.current?.(true)
      return true
    }
    const inlineCompletionExtension = buildInlineCompletionExtension({
      getDebounceMs: () => completionDebounceMsRef.current,
      getMinAcceptScore: () => completionMinAcceptScoreRef.current,
      getLongDebounceMs: () => completionLongDebounceMsRef.current,
      getLongMinAcceptScore: () => completionLongMinAcceptScoreRef.current,
      isLongEnabled: () => completionLongEnabledRef.current,
      isEnabled: () => completionEnabledRef.current && !readOnlyRef.current,
      getFilePath: () => filePathRef.current,
      language: 'markdown',
      getModel: () => completionModelRef.current,
      requestCompletion: async (context, mode) => {
        if (typeof window.kunGui?.requestWriteInlineCompletion !== 'function') return null
        const result = await window.kunGui.requestWriteInlineCompletion(
          buildInlineCompletionPayload(context, {
            model: completionModelRef.current,
            workspaceRoot: workspaceRootRef.current,
            mode,
            recentEdits: recentEditsRef.current
          })
        )
        if (!result.ok) return null
        if (result.action?.kind === 'edit') {
          return {
            text: result.action.replacement,
            action: result.action,
            mode
          }
        }
        const completionText = result.action ? result.action.text : result.completion
        if (!completionText) return null
        return {
          text: completionText,
          action: result.action,
          mode
        }
      }
    })

    const state = EditorState.create({
      doc: valueRef.current,
      extensions: [
        themeCompartment.of(buildEditorTheme(appearanceRef.current)),
        livePreviewCompartment.of(
          appearanceRef.current === 'live' && livePreviewEnabledRef.current
            ? writeMarkdownLivePreviewExtensions(filePathRef.current, workspaceRootRef.current)
            : []
        ),
        editableCompartment.of(buildInteractionExtensions(readOnlyRef.current, appearanceRef.current)),
        mergeCompartment.of([]),
        markdown({ base: markdownLanguage, codeLanguages: languages }),
        history(),
        drawSelection(),
        highlightActiveLine(),
        indentOnInput(),
        bracketMatching(),
        EditorView.lineWrapping,
        keymap.of([
          ...defaultKeymap,
          ...historyKeymap,
          {
            key: 'Tab',
            run: (view) => {
              if (readOnlyRef.current) return false
              return expandWriteTemplateShortcut(view)
            }
          },
          indentWithTab,
          {
            key: 'Mod-s',
            run: () => {
              onSaveShortcutRef.current()
              return true
            }
          }
        ]),
        EditorView.domEventHandlers({
          paste(event, view) {
            if (readOnlyRef.current) return false
            if (!hasClipboardImage(event)) return false
            const nextWorkspaceRoot = workspaceRootRef.current.trim()
            const nextFilePath = filePathRef.current.trim()
            if (!nextWorkspaceRoot || !nextFilePath) {
              onImagePasteErrorRef.current?.('Open a workspace file before pasting an image.')
              event.preventDefault()
              return true
            }
            if (typeof window.kunGui?.saveWorkspaceClipboardImage !== 'function') return false

            event.preventDefault()
            void window.kunGui
              .saveWorkspaceClipboardImage({
                workspaceRoot: nextWorkspaceRoot,
                currentFilePath: nextFilePath,
                ...(imageDirectoryRef.current.trim()
                  ? { imageDirectory: imageDirectoryRef.current.trim() }
                  : {})
              })
              .then((result) => {
                if (!result.ok) {
                  onImagePasteErrorRef.current?.(result.message)
                  return
                }
                const selection = view.state.selection.main
                const insertion = buildPastedImageMarkdown(
                  view.state,
                  selection.from,
                  selection.to,
                  result.markdownPath
                )
                view.focus()
                view.dispatch({
                  changes: {
                    from: selection.from,
                    to: selection.to,
                    insert: insertion.text
                  },
                  selection: EditorSelection.cursor(insertion.cursor),
                  scrollIntoView: true
                })
                onImagePasteSavedRef.current?.()
              })
              .catch((error) => {
                onImagePasteErrorRef.current?.(
                  error instanceof Error ? error.message : String(error)
                )
              })
            return true
          }
        }),
        inlineCompletionCompartment.of(inlineCompletionExtension),
        EditorView.updateListener.of((update) => {
          const externalValueSync = update.transactions.some((transaction) =>
            transaction.annotation(externalValueSyncAnnotation)
          )
          const termPropagationSync = update.transactions.some((transaction) =>
            transaction.annotation(termPropagationAnnotation)
          )
          // A diff review resolves once every chunk is accepted/rejected. Commit
          // it after the dispatch settles to avoid reentrant transactions.
          if (reviewActiveRef.current && !externalValueSync) {
            const chunkData = getChunks(update.state)
            if (!chunkData || chunkData.chunks.length === 0) {
              queueMicrotask(() => finishDiffReview())
            }
          }
          // Materialise the document string at most once per update; on large
          // documents doc.toString() walks the whole rope and used to run for
          // both the onChange emit and the term propagation scan.
          let docString: string | null = null
          const docText = (): string => {
            if (docString === null) docString = update.state.doc.toString()
            return docString
          }
          if (update.docChanged && !externalValueSync && !reviewActiveRef.current) {
            const recentEdits = recentEditsFromUpdate(update, filePathRef.current)
            if (recentEdits.length > 0) onDocumentEditRef.current?.(recentEdits)
            lastEmittedValueRef.current = docText()
            onChangeRef.current(lastEmittedValueRef.current)
          }
          if (update.docChanged || update.selectionSet) {
            const nextSelection = selectionState(update.view)
            if (
              !lastSelectionRef.current ||
              !writeSelectionStatesEqual(lastSelectionRef.current, nextSelection)
            ) {
              lastSelectionRef.current = nextSelection
              onSelectionChangeRef.current(nextSelection)
            }
          }
          if (update.docChanged && !externalValueSync && !termPropagationSync && !reviewActiveRef.current) {
            const seed = termReplacementSeedFromUpdate(update)
            if (seed) {
              const content = docText()
              const rawPropagationChanges = [
                ...buildWriteTermPropagationChanges(content, seed),
                ...buildWriteCanonicalTermPropagationChanges(content, seed)
              ]
              const seenPropagationChanges = new Set<string>()
              const propagationChanges = rawPropagationChanges.filter((change) => {
                const key = `${change.from}:${change.to}`
                if (seenPropagationChanges.has(key)) return false
                seenPropagationChanges.add(key)
                return true
              })
              if (propagationChanges.length > 0) {
                update.view.dispatch({
                  changes: propagationChanges,
                  annotations: termPropagationAnnotation.of(true)
                })
              }
            }
          }
        })
      ]
    })

    const view = new EditorView({
      state,
      parent: hostRef.current
    })
    viewRef.current = view
    lastEmittedValueRef.current = valueRef.current
    const initialSelection = selectionState(view)
    lastSelectionRef.current = initialSelection
    onSelectionChangeRef.current(initialSelection)

    if (handleRef) {
      handleRef.current = {
        applyRangeReplacement: (range, original, replacement) => {
          const instance = viewRef.current
          if (!instance || readOnlyRef.current) return false
          const from = clampOffset(instance.state, range.from)
          const to = clampOffset(instance.state, range.to)
          if (to < from || instance.state.sliceDoc(from, to) !== original) return false
          instance.focus()
          instance.dispatch({
            changes: { from, to, insert: replacement },
            selection: EditorSelection.range(from, from + replacement.length),
            scrollIntoView: true
          })
          return true
        },
        setBlockType: (type) => {
          const instance = viewRef.current
          if (!instance || readOnlyRef.current) return false
          const { from, to } = instance.state.selection.main
          const startLine = instance.state.doc.lineAt(from)
          const endLine = instance.state.doc.lineAt(to)
          const lines: string[] = []
          for (let lineNumber = startLine.number; lineNumber <= endLine.number; lineNumber += 1) {
            lines.push(instance.state.doc.line(lineNumber).text)
          }
          const next = applyWriteBlockTypeToLines(lines, type).join('\n')
          if (instance.state.sliceDoc(startLine.from, endLine.to) === next) return false
          instance.focus()
          instance.dispatch({
            changes: { from: startLine.from, to: endLine.to, insert: next },
            selection: EditorSelection.range(startLine.from, startLine.from + next.length),
            scrollIntoView: true
          })
          return true
        },
        beginDiffReview: ({ original, nextDoc }) => beginDiffReview(original, nextDoc),
        isDiffReviewActive: () => reviewActiveRef.current,
        acceptAllDiff: () => resolveAllDiffChunks('accept'),
        rejectAllDiff: () => resolveAllDiffChunks('reject')
      }
    }

    return () => {
      if (handleRef) handleRef.current = null
      reviewActiveRef.current = false
      view.destroy()
      viewRef.current = null
      themeCompartmentRef.current = null
      livePreviewCompartmentRef.current = null
      editableCompartmentRef.current = null
      mergeCompartmentRef.current = null
    }
    // Mount-once editor; handleRef is a stable ref container from the parent.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  useEffect(() => {
    const view = viewRef.current
    const themeCompartment = themeCompartmentRef.current
    const livePreviewCompartment = livePreviewCompartmentRef.current
    const editableCompartment = editableCompartmentRef.current
    if (!view || !themeCompartment || !livePreviewCompartment || !editableCompartment) return
    view.dispatch({
      effects: [
        themeCompartment.reconfigure(buildEditorTheme(appearance)),
        livePreviewCompartment.reconfigure(
          appearance === 'live' && livePreviewEnabled
            ? writeMarkdownLivePreviewExtensions(filePath, workspaceRoot)
            : []
        ),
        editableCompartment.reconfigure(buildInteractionExtensions(readOnly, appearance))
      ]
    })
  }, [appearance, filePath, livePreviewEnabled, readOnly, workspaceRoot])

  useEffect(() => {
    const view = viewRef.current
    if (!view) return
    // While an inline diff review owns the document, never let the controlled
    // value sync clobber the in-progress merge view.
    if (reviewActiveRef.current) return
    // The value usually round-trips from our own onChange emit; comparing the
    // reference first avoids re-serialising the whole document per keystroke.
    if (value === lastEmittedValueRef.current) return
    const current = view.state.doc.toString()
    if (current === value) {
      lastEmittedValueRef.current = value
      return
    }
    const nextLength = value.length
    const { anchor, head } = view.state.selection.main
    lastEmittedValueRef.current = value
    view.dispatch({
      changes: { from: 0, to: current.length, insert: value },
      annotations: externalValueSyncAnnotation.of(true),
      selection: EditorSelection.single(
        Math.min(anchor, nextLength),
        Math.min(head, nextLength)
      )
    })
  }, [value])

  return <div ref={hostRef} className="write-codemirror-host flex h-full min-h-0 w-full min-w-0" />
}
