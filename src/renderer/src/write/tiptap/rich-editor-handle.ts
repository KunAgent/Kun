import type { Editor } from '@tiptap/core'
import type { MutableRefObject } from 'react'
import type { WriteRichEditorHandle } from './WriteRichEditor'
import { computeWriteDocumentStatsFromText } from '../../components/write/write-workspace-view-utils'
import { buildWriteRichMarkdownProjection, posForProjectedOffset } from './markdown-projection'
import { createWriteRecentEdit, type WriteRecentEdit } from '../recent-edits'
import { replaceRangeWithMarkdown } from './markdown-insert'
import { setRichBlockType, toggleRichInlineFormat } from './rich-format-commands'
import { insertPickedImage } from './blocks/slash-menu'
import type { WriteReviewSession } from './review/review-session'
import type { WorkDocContext } from '../markdown/document-codec'
import { beginRichSelectionReview, richReviewAnchorRect } from './review/selection-review'
import { setRichSelectionHold, restoreRichSelection } from './selection-hold'

const INLINE_EDIT_RECENT_CONTEXT_CHARS = 180

type Deps = {
  editorRef: MutableRefObject<Editor | null>
  readOnlyRef: MutableRefObject<boolean>
  filePathRef: MutableRefObject<string>
  onDocumentEditRef: MutableRefObject<((edits: WriteRecentEdit[]) => void) | undefined>
  reviewSessionRef: MutableRefObject<WriteReviewSession | null>
  workCtxRef: MutableRefObject<WorkDocContext>
  lastEmittedValueRef: MutableRefObject<string | null>
  pickerOptions: Parameters<typeof insertPickedImage>[1]
  setFindBar: (state: { open: boolean; withReplace: boolean }) => void
}

export function buildRichEditorHandle({ editorRef, readOnlyRef, filePathRef, onDocumentEditRef,
  reviewSessionRef, workCtxRef, lastEmittedValueRef, pickerOptions, setFindBar }: Deps): WriteRichEditorHandle {
  return {
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
        toggleInlineFormat: (kind) => toggleRichInlineFormat(editorRef.current, readOnlyRef.current, kind),
        setBlockType: (type) => setRichBlockType(editorRef.current, readOnlyRef.current, type),
        getEditor: () => editorRef.current,
        openFind: () => setFindBar({ open: true, withReplace: false }),
        insertImage: () => {
          const instance = editorRef.current
          if (instance && !instance.isDestroyed && !readOnlyRef.current) void insertPickedImage(instance, pickerOptions)
        },
        beginDiffReview: ({ original, nextDoc, origin }) => {
          const session = reviewSessionRef.current
          if (!session || readOnlyRef.current) return false
          return session.begin({ original, nextDoc, origin })
        },
        isDiffReviewActive: () => reviewSessionRef.current?.isActive() ?? false,
        acceptAllDiff: () => reviewSessionRef.current?.resolveAll('accept'),
        rejectAllDiff: () => reviewSessionRef.current?.resolveAll('reject'),
        beginSelectionReview: (params) => beginRichSelectionReview({ editor: editorRef.current,
          readOnly: readOnlyRef.current, session: reviewSessionRef.current, ctx: workCtxRef.current,
          baseline: lastEmittedValueRef.current ?? '', ...params }),
        getReviewAnchorRect: () => richReviewAnchorRect(editorRef.current),
        subscribeReviewLayout: (listener) => {
          const editor = editorRef.current
          editor?.on('transaction', listener)
          return () => { editor?.off('transaction', listener) }
        },
        setSelectionHold: (range) => setRichSelectionHold(editorRef.current, range),
        restoreSelection: (range) => restoreRichSelection(editorRef.current, range),
        getElement: () => editorRef.current?.view.dom ?? null,
        undoLast: () => editorRef.current?.commands.undo() ?? false
      }
}
