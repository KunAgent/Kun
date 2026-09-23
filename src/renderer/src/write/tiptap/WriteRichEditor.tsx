import {
  useEffect,
  useRef,
  useState,
  type MutableRefObject,
  type ReactElement,
  type ReactNode
} from 'react'
import { Editor, Extension, type AnyExtension } from '@tiptap/core'
import { TriangleAlert } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import 'katex/dist/katex.min.css'
import type {
  WriteEditorSelectionState
} from '../../components/write/WriteMarkdownEditor'
import { computeWriteDocumentStatsFromText } from '../../components/write/write-workspace-view-utils'
import { buildInlineCompletionPayload } from '../inline-completion'
import type { WriteBlockType } from '../block-type'
import type { WriteInlineFormatKind } from '../inline-format'
import { createWriteRecentEdit, type WriteRecentEdit } from '../recent-edits'
import {
  auditWriteMarkdownFidelity,
  buildWriteRichExtensions,
  getWriteMarkdownManager,
  parseWriteMarkdown,
  type WriteRichFidelity
} from './markdown-manager'
import {
  buildWriteRichMarkdownProjection,
  posForProjectedOffset
} from './markdown-projection'
import { selectionStateFromEditor } from './rich-selection-state'
import {
  createWorkDocContext,
  parseWorkDocument,
  serializeWorkDocument,
  type WorkDocContext
} from '../markdown/document-codec'
import { WritePropertiesPanel } from '../../components/write/WritePropertiesPanel'
import { recentEditsFromRichTransaction } from './recent-edits-pm'
import { replaceRangeWithMarkdown } from './markdown-insert'
import { applyExternalMarkdownToEditor } from './markdown-sync'
import { WriteLocalImage } from './local-image'
import { WritePasteImage } from './paste-image'
import { WriteRichInlineCompletion } from './extensions/inline-completion'
import {
  WriteRichTermPropagation,
  writeRichExternalSyncMeta
} from './extensions/term-propagation'
import { WriteRichTemplateShortcuts } from './extensions/template-shortcuts'
import { SddRequirementBadges } from './extensions/sdd-requirement-badges'
import { WriteDiffReview } from './review/review-plugin'
import { WriteReviewSession } from './review/review-session'
import { WriteWorkLinks } from './extensions/work-links'
import { useWriteWorkspaceStore } from '../write-workspace-store'
import { WriteDocumentReviewBar } from '../../components/write/WriteDocumentReviewBar'

/**
 * Imperative surface for flows that operate on the markdown projection
 * (inline edit, quoted selections). Ranges are projection offsets, the same
 * coordinate space used by the selection state this editor emits.
 */
export type WriteRichEditorHandle = {
  getProjectionText: () => string | null
  applyProjectedReplacement: (
    range: { from: number; to: number },
    original: string,
    replacement: string,
    instruction?: string
  ) => boolean
  /** Replace the image node whose src matches exactly with parsed markdown
   * (an empty string deletes the node). Backs async infographic completion,
   * where the placeholder position can shift under concurrent edits. */
  replaceImageBySrc: (src: string, replacementMarkdown: string) => boolean
  /** Insert parsed markdown right after the image node whose src matches
   * exactly (prototype placeholders go below their source mockup). */
  insertMarkdownAfterImage: (src: string, markdown: string) => boolean
  /** Toggle an inline mark on the current selection (selection toolbar). */
  toggleInlineFormat: (kind: WriteInlineFormatKind) => boolean
  /** Set the block type of the current selection (selection toolbar). */
  setBlockType: (type: WriteBlockType) => boolean
  /** Word/character counts computed from the live editor document — cheap
   *  compared to re-parsing the markdown source on every keystroke. */
  getDocumentStats: () => { characterCount: number; wordCount: number } | null
  /**
   * Enter the block-level diff review (V2 codec only): swaps the document
   * to `nextDoc` and shows per-chunk accept/reject decorations against
   * `original`. Returns false when the editor is read-only, not using the
   * V2 codec, or the texts are identical.
   */
  beginDiffReview: (params: { original: string; nextDoc: string }) => boolean
  isDiffReviewActive: () => boolean
  acceptAllDiff: () => void
  rejectAllDiff: () => void
}

type Props = {
  value: string
  workspaceRoot?: string | null
  filePath?: string | null
  documentEpoch?: number
  imageDirectory?: string | null
  readOnly?: boolean
  /** S1 gate: use the unified remark codec + source-preserving context. */
  documentEditorV2?: boolean
  /** Render SDD requirement headings with status pills (SDD draft editor). */
  requirementBadges?: boolean
  completionModel?: string
  completionEnabled?: boolean
  completionDebounceMs?: number
  completionMinAcceptScore?: number
  completionLongEnabled?: boolean
  completionLongDebounceMs?: number
  completionLongMinAcceptScore?: number
  recentEdits?: WriteRecentEdit[]
  onChange: (value: string) => void
  onDocumentEdit?: (edits: WriteRecentEdit[]) => void
  onSelectionChange: (selection: WriteEditorSelectionState) => void
  onSaveShortcut: () => void
  onImagePasteSaved?: () => void
  onImagePasteError?: (message: string) => void
  onReviewStateChange?: (active: boolean) => void
  onFidelityChange?: (fidelity: WriteRichFidelity) => void
  handleRef?: MutableRefObject<WriteRichEditorHandle | null>
  /** Rendered instead of the rich editor when the open document fails the
   * round-trip fidelity gate (typically the CodeMirror editor). */
  fallback?: ReactNode
}

type GateState = {
  fileKey: string
  eligible: boolean
  detail?: string
}

function fileKeyOf(filePath?: string | null): string {
  return (filePath ?? '').trim()
}

const INLINE_EDIT_RECENT_CONTEXT_CHARS = 180

export function WriteRichEditor({
  value,
  workspaceRoot,
  filePath,
  documentEpoch,
  imageDirectory,
  readOnly = false,
  documentEditorV2 = false,
  requirementBadges = false,
  completionModel = '',
  completionEnabled = false,
  completionDebounceMs = 0,
  completionMinAcceptScore = 0,
  completionLongEnabled = false,
  completionLongDebounceMs = 0,
  completionLongMinAcceptScore = 0,
  recentEdits = [],
  onChange,
  onDocumentEdit,
  onSelectionChange,
  onSaveShortcut,
  onImagePasteSaved,
  onImagePasteError,
  onReviewStateChange,
  onFidelityChange,
  handleRef,
  fallback
}: Props): ReactElement {
  const { t } = useTranslation('common')
  const hostRef = useRef<HTMLDivElement | null>(null)
  const editorRef = useRef<Editor | null>(null)
  const workspaceRootRef = useRef(workspaceRoot ?? '')
  const filePathRef = useRef(filePath ?? '')
  const documentEpochRef = useRef(documentEpoch ?? 0)
  const imageDirectoryRef = useRef(imageDirectory ?? '')
  const readOnlyRef = useRef(readOnly)
  const completionModelRef = useRef(completionModel)
  const completionEnabledRef = useRef(completionEnabled)
  const completionDebounceMsRef = useRef(completionDebounceMs)
  const completionMinAcceptScoreRef = useRef(completionMinAcceptScore)
  const completionLongEnabledRef = useRef(completionLongEnabled)
  const completionLongDebounceMsRef = useRef(completionLongDebounceMs)
  const completionLongMinAcceptScoreRef = useRef(completionLongMinAcceptScore)
  const recentEditsRef = useRef(recentEdits)
  const onChangeRef = useRef(onChange)
  const onDocumentEditRef = useRef(onDocumentEdit)
  const onSelectionChangeRef = useRef(onSelectionChange)
  const onSaveShortcutRef = useRef(onSaveShortcut)
  const onImagePasteSavedRef = useRef(onImagePasteSaved)
  const onImagePasteErrorRef = useRef(onImagePasteError)
  const onReviewStateChangeRef = useRef(onReviewStateChange)
  const onFidelityChangeRef = useRef(onFidelityChange)
  const lastEmittedValueRef = useRef<string | null>(null)
  const workCtxRef = useRef<WorkDocContext>(createWorkDocContext())
  const documentEditorV2Ref = useRef(documentEditorV2)
  const reviewSessionRef = useRef<WriteReviewSession | null>(null)
  const [reviewUi, setReviewUi] = useState<{ active: boolean; total: number; index: number }>({
    active: false,
    total: 0,
    index: 0
  })
  const [frontmatter, setFrontmatter] = useState('')
  const [gate, setGate] = useState<GateState | null>(null)

  workspaceRootRef.current = workspaceRoot ?? ''
  filePathRef.current = filePath ?? ''
  documentEpochRef.current = documentEpoch ?? 0
  imageDirectoryRef.current = imageDirectory ?? ''
  readOnlyRef.current = readOnly
  completionModelRef.current = completionModel
  completionEnabledRef.current = completionEnabled
  completionDebounceMsRef.current = completionDebounceMs
  completionMinAcceptScoreRef.current = completionMinAcceptScore
  completionLongEnabledRef.current = completionLongEnabled
  completionLongDebounceMsRef.current = completionLongDebounceMs
  completionLongMinAcceptScoreRef.current = completionLongMinAcceptScore
  recentEditsRef.current = recentEdits
  onChangeRef.current = onChange
  onDocumentEditRef.current = onDocumentEdit
  onSelectionChangeRef.current = onSelectionChange
  onSaveShortcutRef.current = onSaveShortcut
  onImagePasteSavedRef.current = onImagePasteSaved
  onImagePasteErrorRef.current = onImagePasteError
  onReviewStateChangeRef.current = onReviewStateChange
  onFidelityChangeRef.current = onFidelityChange
  documentEditorV2Ref.current = documentEditorV2

  const fileKey = fileKeyOf(filePath)
  const eligible = gate?.fileKey === fileKey ? gate.eligible : null

  // Audit every payload that arrives from outside the editor (file open,
  // disk sync). Our own serialized output is round-trip safe by construction
  // and is never re-audited.
  useEffect(() => {
    if (value === lastEmittedValueRef.current && gate?.fileKey === fileKey) return
    if (documentEditorV2) {
      // The unified codec preserves every construct, so nothing is gated.
      onFidelityChangeRef.current?.({ eligible: true, normalized: value })
      setGate({ fileKey, eligible: true })
      // During an active diff review the agent's next snapshot re-enters
      // through `beginDiffReview` (§6.3.4); applying it here would clobber
      // chunk positions.
      if (reviewSessionRef.current?.isActive()) return
      const editor = editorRef.current
      if (editor && !editor.isDestroyed) {
        if (applyExternalMarkdownToEditor(editor, value, (markdown) => {
          const parsed = parseWorkDocument(markdown)
          workCtxRef.current = parsed.ctx
          setFrontmatter(parsed.ctx.frontmatter)
          return parsed.doc
        })) {
          lastEmittedValueRef.current = value
        }
      } else {
        const parsed = parseWorkDocument(value)
        workCtxRef.current = parsed.ctx
        setFrontmatter(parsed.ctx.frontmatter)
      }
      return
    }
    const fidelity = auditWriteMarkdownFidelity(value)
    onFidelityChangeRef.current?.(fidelity)
    const detail = fidelity.eligible ? undefined : fidelity.detail
    setGate((current) => {
      if (current?.fileKey === fileKey && current.eligible === fidelity.eligible && current.detail === detail) {
        return current
      }
      return { fileKey, eligible: fidelity.eligible, detail }
    })
    if (!fidelity.eligible) {
      lastEmittedValueRef.current = null
      return
    }

    const editor = editorRef.current
    if (editor && !editor.isDestroyed) {
      if (applyExternalMarkdownToEditor(editor, value)) {
        lastEmittedValueRef.current = value
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value, fileKey, documentEditorV2])

  useEffect(() => {
    if (eligible !== true || !hostRef.current || editorRef.current) return

    const manager = getWriteMarkdownManager()
    const saveShortcut = Extension.create({
      name: 'writeSaveShortcut',
      addKeyboardShortcuts() {
        return {
          'Mod-s': () => {
            onSaveShortcutRef.current()
            return true
          }
        }
      }
    })

    const extensions: AnyExtension[] = buildWriteRichExtensions({
      image: WriteLocalImage.configure({
        getFilePath: () => filePathRef.current,
        getWorkspaceRoot: () => workspaceRootRef.current
      }),
      extra: [
        WritePasteImage.configure({
          getWorkspaceRoot: () => workspaceRootRef.current,
          getFilePath: () => filePathRef.current,
          getDocumentEpoch: () => documentEpochRef.current,
          getImageDirectory: () => imageDirectoryRef.current,
          isReadOnly: () => readOnlyRef.current,
          onSaved: () => onImagePasteSavedRef.current?.(),
          onError: (message) => onImagePasteErrorRef.current?.(message)
        }),
        WriteRichInlineCompletion.configure({
          getDebounceMs: () => completionDebounceMsRef.current,
          getMinAcceptScore: () => completionMinAcceptScoreRef.current,
          getLongDebounceMs: () => completionLongDebounceMsRef.current,
          getLongMinAcceptScore: () => completionLongMinAcceptScoreRef.current,
          isLongEnabled: () => completionLongEnabledRef.current,
          isEnabled: () =>
            completionEnabledRef.current &&
            !readOnlyRef.current &&
            !reviewSessionRef.current?.isActive(),
          getFilePath: () => filePathRef.current,
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
              return { text: result.action.replacement, action: result.action, mode }
            }
            const completionText = result.action ? result.action.text : result.completion
            if (!completionText) return null
            return { text: completionText, action: result.action, mode }
          }
        }),
        WriteRichTermPropagation,
        WriteWorkLinks.configure({
          navigation: {
            getFilePath: () => filePathRef.current,
            getWorkspaceRoot: () => workspaceRootRef.current,
            openFile: (path, heading) => {
              // Heading/line positioning after open is a follow-up; the
              // store action only accepts the path today.
              void heading
              void useWriteWorkspaceStore.getState().openFile(workspaceRootRef.current, path)
            }
          }
        }),
        WriteRichTemplateShortcuts.configure({
          isReadOnly: () => readOnlyRef.current
        }),
        WriteDiffReview,
        ...(requirementBadges ? [SddRequirementBadges] : []),
        saveShortcut
      ]
    })

    const initialContent = documentEditorV2Ref.current
      ? (() => {
          const parsed = parseWorkDocument(value)
          workCtxRef.current = parsed.ctx
          setFrontmatter(parsed.ctx.frontmatter)
          return parsed.doc
        })()
      : parseWriteMarkdown(value)

    const editor = new Editor({
      element: hostRef.current,
      extensions,
      content: initialContent,
      editable: !readOnlyRef.current,
      editorProps: {
        attributes: {
          class: 'write-rich-editor',
          spellcheck: readOnlyRef.current ? 'false' : 'true',
          'data-write-editor-mode': 'rich'
        }
      },
      onUpdate({ editor: instance, transaction }) {
        // External snapshots are applied through applyExternalMarkdownToEditor;
        // re-emitting them as user changes would mark the file dirty and
        // autosave a normalized rewrite of content the agent just wrote.
        if (transaction.getMeta(writeRichExternalSyncMeta)) {
          onSelectionChangeRef.current(selectionStateFromEditor(instance))
          return
        }
        try {
          const docJson = instance.state.doc.toJSON()
          const markdown = documentEditorV2Ref.current
            ? serializeWorkDocument(docJson, workCtxRef.current)
            : manager.serialize(docJson)
          lastEmittedValueRef.current = markdown
          onChangeRef.current(markdown)
        } catch (error) {
          onImagePasteErrorRef.current?.(
            error instanceof Error ? error.message : String(error)
          )
        }
        if (onDocumentEditRef.current && transaction.docChanged) {
          const edits = recentEditsFromRichTransaction(transaction, filePathRef.current)
          if (edits.length > 0) onDocumentEditRef.current(edits)
        }
        onSelectionChangeRef.current(selectionStateFromEditor(instance))
      },
      onSelectionUpdate({ editor: instance }) {
        onSelectionChangeRef.current(selectionStateFromEditor(instance))
      }
    })

    editorRef.current = editor
    lastEmittedValueRef.current = value
    onSelectionChangeRef.current(selectionStateFromEditor(editor))

    reviewSessionRef.current = new WriteReviewSession(
      editor,
      {
        onFinish: (markdown) => {
          lastEmittedValueRef.current = markdown
          onChangeRef.current(markdown)
        },
        onStateChange: (active) => {
          setReviewUi((current) => ({
            active,
            total: active ? current.total : 0,
            index: 0
          }))
          onReviewStateChangeRef.current?.(active)
        },
        onChunksChange: (count) => {
          setReviewUi((current) => ({
            active: current.active,
            total: count,
            index: Math.min(current.index, Math.max(0, count - 1))
          }))
        }
      },
      () => workCtxRef.current,
      (ctx) => {
        workCtxRef.current = ctx
      }
    )

    if (handleRef) {
      handleRef.current = {
        getProjectionText: () => {
          const instance = editorRef.current
          if (!instance || instance.isDestroyed) return null
          return buildWriteRichMarkdownProjection(instance.state.doc).text
        },
        applyProjectedReplacement: (range, original, replacement, instruction) => {
          const instance = editorRef.current
          if (!instance || instance.isDestroyed || readOnlyRef.current) return false
          const doc = instance.state.doc
          const projection = buildWriteRichMarkdownProjection(doc)
          const from = posForProjectedOffset(doc, projection, range.from)
          const to = posForProjectedOffset(doc, projection, range.to)
          if (from === null || to === null || to < from) return false
          const current = doc.textBetween(from, to, '\n', () => '')
          if (current.replace(/\n+/g, '\n') !== original.replace(/\n+/g, '\n')) return false
          const applied = replaceRangeWithMarkdown(
            instance.state,
            (tr) => instance.view.dispatch(tr),
            from,
            to,
            replacement
          )
          if (!applied) return false
          const record = createWriteRecentEdit({
            source: 'inline-edit',
            filePath: filePathRef.current,
            from: range.from,
            to: range.to,
            deletedText: original,
            insertedText: replacement,
            beforeContext: projection.text.slice(
              Math.max(0, range.from - INLINE_EDIT_RECENT_CONTEXT_CHARS),
              range.from
            ),
            afterContext: projection.text.slice(
              range.to,
              Math.min(projection.text.length, range.to + INLINE_EDIT_RECENT_CONTEXT_CHARS)
            ),
            instruction,
            scopeKind: 'selection'
          })
          if (record) onDocumentEditRef.current?.([record])
          return true
        },
        replaceImageBySrc: (src, replacementMarkdown) => {
          const instance = editorRef.current
          if (!instance || instance.isDestroyed) return false
          let target: { from: number; to: number } | null = null
          instance.state.doc.descendants((docNode, pos) => {
            if (target) return false
            if (docNode.type.name === 'image' && docNode.attrs.src === src) {
              target = { from: pos, to: pos + docNode.nodeSize }
              return false
            }
            return true
          })
          if (!target) return false
          const { from, to } = target
          return replaceRangeWithMarkdown(
            instance.state,
            (tr) => instance.view.dispatch(tr),
            from,
            to,
            replacementMarkdown
          )
        },
        insertMarkdownAfterImage: (src, markdown) => {
          const instance = editorRef.current
          if (!instance || instance.isDestroyed) return false
          let insertAt: number | null = null
          instance.state.doc.descendants((docNode, pos) => {
            if (insertAt !== null) return false
            if (docNode.type.name === 'image' && docNode.attrs.src === src) {
              insertAt = pos + docNode.nodeSize
              return false
            }
            return true
          })
          if (insertAt === null) return false
          return replaceRangeWithMarkdown(
            instance.state,
            (tr) => instance.view.dispatch(tr),
            insertAt,
            insertAt,
            markdown
          )
        },
        getDocumentStats: () => {
          const instance = editorRef.current
          if (!instance || instance.isDestroyed) return null
          const doc = instance.state.doc
          return computeWriteDocumentStatsFromText(
            doc.textBetween(0, doc.content.size, '\n', '\n')
          )
        },
        toggleInlineFormat: (kind) => {
          const instance = editorRef.current
          if (!instance || instance.isDestroyed || readOnlyRef.current) return false
          const chain = instance.chain().focus()
          if (kind === 'bold') return chain.toggleBold().run()
          if (kind === 'italic') return chain.toggleItalic().run()
          if (kind === 'strikethrough') return chain.toggleStrike().run()
          return chain.toggleCode().run()
        },
        setBlockType: (type) => {
          const instance = editorRef.current
          if (!instance || instance.isDestroyed || readOnlyRef.current) return false
          const chain = instance.chain().focus()
          switch (type) {
            case 'heading1':
              return chain.toggleHeading({ level: 1 }).run()
            case 'heading2':
              return chain.toggleHeading({ level: 2 }).run()
            case 'heading3':
              return chain.toggleHeading({ level: 3 }).run()
            case 'quote':
              return chain.toggleBlockquote().run()
            case 'bullet':
              return chain.toggleBulletList().run()
            case 'ordered':
              return chain.toggleOrderedList().run()
            case 'code':
              return chain.toggleCodeBlock().run()
            default:
              return chain.setParagraph().run()
          }
        },
        beginDiffReview: ({ original, nextDoc }) => {
          const session = reviewSessionRef.current
          if (!session || !documentEditorV2Ref.current || readOnlyRef.current) return false
          return session.begin({ original, nextDoc })
        },
        isDiffReviewActive: () => reviewSessionRef.current?.isActive() ?? false,
        acceptAllDiff: () => reviewSessionRef.current?.resolveAll('accept'),
        rejectAllDiff: () => reviewSessionRef.current?.resolveAll('reject')
      }
    }

    return () => {
      if (handleRef) handleRef.current = null
      reviewSessionRef.current = null
      editor.destroy()
      editorRef.current = null
    }
    // The editor is created once per eligible file; value/file changes flow
    // through the audit effect above.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [eligible, fileKey])

  useEffect(() => {
    const editor = editorRef.current
    if (!editor || editor.isDestroyed) return
    editor.setEditable(!readOnly)
  }, [readOnly])

  if (eligible === false) {
    return (
      <div className="flex h-full min-h-0 w-full min-w-0 flex-col">
        <div className="write-rich-fallback-notice flex shrink-0 items-center gap-2 border-b border-amber-200/80 bg-amber-50/90 px-4 py-2 text-[12.5px] text-amber-900 dark:border-amber-800/60 dark:bg-amber-950/35 dark:text-amber-100">
          <TriangleAlert className="h-3.5 w-3.5 shrink-0" strokeWidth={1.9} />
          <span>
            {t('writeRichFallbackNotice')}
            {gate?.detail
              ? ` (${gate.detail.split(',').map((code) =>
                  t(`writeRichFallbackReason.${code.trim()}`, { defaultValue: code.trim() })
                ).join(', ')})`
              : ''}
          </span>
        </div>
        <div className="min-h-0 min-w-0 flex-1">{fallback}</div>
      </div>
    )
  }

  const handleFrontmatterChange = (block: string): void => {
    workCtxRef.current.frontmatter = block
    setFrontmatter(block)
    const instance = editorRef.current
    if (instance && !instance.isDestroyed) {
      const markdown = serializeWorkDocument(instance.state.doc.toJSON(), workCtxRef.current)
      lastEmittedValueRef.current = markdown
      onChangeRef.current(markdown)
    }
  }

  if (!documentEditorV2) {
    return (
      <div
        ref={hostRef}
        className="write-rich-host flex h-full min-h-0 w-full min-w-0 flex-col overflow-y-auto"
      />
    )
  }
  return (
    <div className="flex h-full min-h-0 w-full min-w-0 flex-col">
      {reviewUi.active ? (
        <WriteDocumentReviewBar
          total={reviewUi.total}
          index={reviewUi.index}
          onPrev={() => {
            const index = Math.max(0, reviewUi.index - 1)
            setReviewUi((current) => ({ ...current, index }))
            reviewSessionRef.current?.scrollToChunk(index)
          }}
          onNext={() => {
            const index = Math.min(reviewUi.total - 1, reviewUi.index + 1)
            setReviewUi((current) => ({ ...current, index }))
            reviewSessionRef.current?.scrollToChunk(index)
          }}
          onAcceptAll={() => reviewSessionRef.current?.resolveAll('accept')}
          onRejectAll={() => reviewSessionRef.current?.resolveAll('reject')}
        />
      ) : null}
      <WritePropertiesPanel
        frontmatter={frontmatter}
        onFrontmatterChange={handleFrontmatterChange}
        readOnly={readOnly}
      />
      <div
        ref={hostRef}
        className="write-rich-host flex min-h-0 w-full min-w-0 flex-1 flex-col overflow-y-auto"
      />
    </div>
  )
}
