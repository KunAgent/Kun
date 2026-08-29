import { useEffect, useRef, useState, type MutableRefObject, type ReactElement } from 'react'
import { ListOrdered, WrapText } from 'lucide-react'
import { Annotation, Compartment, EditorSelection, EditorState, type Extension } from '@codemirror/state'
import { defaultKeymap, history, historyKeymap, indentWithTab } from '@codemirror/commands'
import { markdown, markdownLanguage } from '@codemirror/lang-markdown'
import { bracketMatching, indentOnInput } from '@codemirror/language'
import { languages } from '@codemirror/language-data'
import { drawSelection, EditorView, highlightActiveLine, keymap, lineNumbers, showPanel, type Panel, type ViewUpdate } from '@codemirror/view'
import { acceptChunk, getChunks, rejectChunk, unifiedMergeView } from '@codemirror/merge'
import i18n from '../../i18n'
import {
  applyWriteBlockTypeToLines,
  detectWriteBlockTypeFromLine,
  type WriteBlockType
} from '../../write/block-type'
import { buildInlineCompletionExtension, buildInlineCompletionPayload } from '../../write/inline-completion'
import { writeMarkdownLivePreviewExtensions } from '../../write/markdown-live-preview'
import {
  buildWikilinkMenuExtension,
  setWikilinkTargets
} from '../../write/wikilink/wikilink-codemirror'
import { useWikilinkTargets } from '../../write/wikilink/use-wikilink-targets'
import { createWriteRecentEdit, type WriteRecentEdit } from '../../write/recent-edits'
import { isSelectableRasterImageSrc, parseImageMarkdownLine } from '../../write/selected-image'
import { buildWriteTemplateShortcutExpansion } from '../../write/template-shortcuts'
import {
  buildWriteCanonicalTermPropagationChanges,
  buildWriteTermPropagationChanges,
  type WriteTermReplacementSeed
} from '../../write/term-propagation'
import { writeSelectionStatesEqual } from '../../write/write-selection'
import { writeDocumentContextMatches } from '../../write/write-document-context'
import {
  readWriteEditorDisplayPreferences,
  writeWriteEditorDisplayPreferences,
  type WriteEditorDisplayPreferences
} from '../../write/write-editor-display-preferences'

export type {
  WriteEditorSelectionState,
  WriteMarkdownEditorHandle,
  WriteSelectedImage,
  WriteSelectionAnchorRect,
  WriteSelectionPageRect,
  WriteSelectionRange
} from './write-markdown-editor-types'
import type {
  WriteEditorSelectionState,
  WriteMarkdownEditorHandle
} from './write-markdown-editor-types'
type Props = {
  value: string
  workspaceRoot?: string | null
  filePath?: string | null
  documentEpoch?: number
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

import {
  buildEditorTheme,
  buildInteractionExtensions,
  buildPastedImageMarkdown,
  clampOffset,
  expandWriteTemplateShortcut,
  externalValueSyncAnnotation,
  hasClipboardImage,
  recentEditsFromUpdate,
  selectionState,
  termPropagationAnnotation,
  termReplacementSeedFromUpdate,
  writeEditorDisplayExtensions
} from './write-markdown-editor-support'
export function WriteMarkdownEditor({
  value,
  workspaceRoot,
  filePath,
  documentEpoch,
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
  const [displayPreferences, setDisplayPreferences] = useState(readWriteEditorDisplayPreferences)
  const hostRef = useRef<HTMLDivElement | null>(null)
  const viewRef = useRef<EditorView | null>(null)
  const themeCompartmentRef = useRef<Compartment | null>(null)
  const livePreviewCompartmentRef = useRef<Compartment | null>(null)
  const editableCompartmentRef = useRef<Compartment | null>(null)
  const displayCompartmentRef = useRef<Compartment | null>(null)
  const wikilink = useWikilinkTargets()
  const wikilinkRef = useRef(wikilink)
  wikilinkRef.current = wikilink
  const workspaceRootRef = useRef(workspaceRoot ?? '')
  const filePathRef = useRef(filePath ?? '')
  const documentEpochRef = useRef(documentEpoch ?? 0)
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
  documentEpochRef.current = documentEpoch ?? 0
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

  // The scan resolves after the menu has already opened, so the results are
  // pushed into the running editor state rather than passed at creation time.
  useEffect(() => {
    const view = viewRef.current
    if (!view) return
    view.dispatch({ effects: setWikilinkTargets.of(wikilink.targets) })
  }, [wikilink.targets])

  useEffect(() => {
    if (!hostRef.current) return

    const inlineCompletionCompartment = new Compartment()
    const themeCompartment = new Compartment()
    const livePreviewCompartment = new Compartment()
    const editableCompartment = new Compartment()
    const displayCompartment = new Compartment()
    const mergeCompartment = new Compartment()
    themeCompartmentRef.current = themeCompartment
    livePreviewCompartmentRef.current = livePreviewCompartment
    editableCompartmentRef.current = editableCompartment
    displayCompartmentRef.current = displayCompartment
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

    const wikilinkMenuExtension = buildWikilinkMenuExtension({
      workspaceRoot: () => workspaceRootRef.current,
      activePath: () => filePathRef.current,
      onRequestTargets: () => wikilinkRef.current.request(),
      emptyStateText: (hasTargets) => {
        const state = wikilinkRef.current
        if (state.error) return i18n.t('writeWikilinkError', { message: state.error })
        if (state.scanning || (!hasTargets && !state.truncated)) return i18n.t('writeWikilinkScanning')
        // A truncated walk must not read as an empty or exhaustively searched
        // vault: the file may exist in a folder the scan never reached.
        if (state.truncated) return i18n.t('writeWikilinkPartial')
        return i18n.t('writeWikilinkNoMatch')
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
        displayCompartment.of(writeEditorDisplayExtensions(displayPreferences)),
        mergeCompartment.of([]),
        markdown({ base: markdownLanguage, codeLanguages: languages }),
        wikilinkMenuExtension,
        history(),
        drawSelection(),
        highlightActiveLine(),
        indentOnInput(),
        bracketMatching(),
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
            const nextDocumentEpoch = documentEpochRef.current
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
                if (
                  viewRef.current !== view ||
                  !writeDocumentContextMatches(
                    {
                      workspaceRoot: workspaceRootRef.current,
                      activeFilePath: filePathRef.current,
                      documentEpoch: documentEpochRef.current
                    },
                    {
                      workspaceRoot: nextWorkspaceRoot,
                      filePath: nextFilePath,
                      documentEpoch: nextDocumentEpoch
                    }
                  )
                ) return
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
                if (
                  viewRef.current !== view ||
                  !writeDocumentContextMatches(
                    {
                      workspaceRoot: workspaceRootRef.current,
                      activeFilePath: filePathRef.current,
                      documentEpoch: documentEpochRef.current
                    },
                    {
                      workspaceRoot: nextWorkspaceRoot,
                      filePath: nextFilePath,
                      documentEpoch: nextDocumentEpoch
                    }
                  )
                ) return
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
      displayCompartmentRef.current = null
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
    const compartment = displayCompartmentRef.current
    if (!view || !compartment) return
    view.dispatch({
      effects: compartment.reconfigure(writeEditorDisplayExtensions(displayPreferences))
    })
  }, [displayPreferences])

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

  const updateDisplayPreferences = (
    patch: Partial<WriteEditorDisplayPreferences>
  ): void => {
    setDisplayPreferences((current) => {
      const next = { ...current, ...patch }
      writeWriteEditorDisplayPreferences(next)
      return next
    })
  }

  return (
    <div className="relative flex h-full min-h-0 w-full min-w-0">
      <div ref={hostRef} className="write-codemirror-host flex h-full min-h-0 w-full min-w-0" />
      <div className="absolute bottom-3 right-3 z-20 flex items-center gap-1 rounded-xl border border-ds-border-muted bg-ds-card/92 p-1 opacity-55 shadow-[0_10px_24px_rgba(20,47,95,0.1)] backdrop-blur-xl transition hover:opacity-100 focus-within:opacity-100">
        <button
          type="button"
          onClick={() => updateDisplayPreferences({ lineNumbers: !displayPreferences.lineNumbers })}
          className={`inline-flex h-7 w-7 items-center justify-center rounded-lg transition ${displayPreferences.lineNumbers ? 'bg-accent/12 text-accent' : 'text-ds-faint hover:bg-ds-hover hover:text-ds-ink'}`}
          title={i18n.t(displayPreferences.lineNumbers ? 'writeHideLineNumbers' : 'writeShowLineNumbers', { ns: 'common' })}
          aria-label={i18n.t(displayPreferences.lineNumbers ? 'writeHideLineNumbers' : 'writeShowLineNumbers', { ns: 'common' })}
          aria-pressed={displayPreferences.lineNumbers}
        >
          <ListOrdered className="h-3.5 w-3.5" strokeWidth={1.85} />
        </button>
        <button
          type="button"
          onClick={() => updateDisplayPreferences({ lineWrapping: !displayPreferences.lineWrapping })}
          className={`inline-flex h-7 w-7 items-center justify-center rounded-lg transition ${displayPreferences.lineWrapping ? 'bg-accent/12 text-accent' : 'text-ds-faint hover:bg-ds-hover hover:text-ds-ink'}`}
          title={i18n.t(displayPreferences.lineWrapping ? 'writeDisableLineWrapping' : 'writeEnableLineWrapping', { ns: 'common' })}
          aria-label={i18n.t(displayPreferences.lineWrapping ? 'writeDisableLineWrapping' : 'writeEnableLineWrapping', { ns: 'common' })}
          aria-pressed={displayPreferences.lineWrapping}
        >
          <WrapText className="h-3.5 w-3.5" strokeWidth={1.85} />
        </button>
      </div>
    </div>
  )
}
