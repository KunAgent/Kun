import { richSelectionHoldRange } from '../selection-hold'
import type { Editor } from '@tiptap/core'
import type { Transaction } from '@tiptap/pm/state'
import type { WriteSelectionReview } from '../../../components/write/write-document-editor-handle'
import type { WriteSelectionAnchorRect } from '../../../components/write/write-markdown-editor-types'
import { serializeWorkDocument, type WorkDocContext } from '../../markdown/document-codec'
import { buildWriteRichMarkdownProjection, posForProjectedOffset } from '../markdown-projection'
import { replaceRangeWithMarkdown } from '../markdown-insert'
import { countReviewHunks } from './inline-word-diff'
import { writeReviewPluginKey } from './review-plugin'
import type { WriteReviewSession } from './review-session'

/** Construct a proposal without dispatching a document edit or notifying autosave. */
export function beginRichSelectionReview({ editor, session, ctx, baseline, readOnly,
  range, original, replacement }: WriteSelectionReview & {
  editor: Editor | null; session: WriteReviewSession | null; ctx: WorkDocContext
  baseline: string; readOnly: boolean
}): { hunks: number } | null {
  if (!editor || editor.isDestroyed || readOnly || !session || session.isActive()) return null
  const doc = editor.state.doc, projection = buildWriteRichMarkdownProjection(doc)
  if (projection.text.slice(range.from, range.to) !== original) return null
  const from = posForProjectedOffset(doc, projection, range.from)
  const to = posForProjectedOffset(doc, projection, range.to)
  if (from === null || to === null || to <= from) return null
  // A stale or non-roundtrippable baseline cannot safely enter selection review.
  if (serializeWorkDocument(doc.toJSON(), ctx) !== baseline) return null
  let captured: Transaction | null = null
  if (!replaceRangeWithMarkdown(editor.state, (tr) => { captured = tr }, from, to, replacement)) return null
  if (!captured) return null
  const nextDoc = serializeWorkDocument((captured as Transaction).doc.toJSON(), ctx)
  if (!session.begin({ original: baseline, nextDoc, origin: 'selection' })) return null
  return { hunks: countReviewHunks(writeReviewPluginKey.getState(editor.state)?.chunks ?? [], editor.state) }
}

export function richReviewAnchorRect(editor: Editor | null): WriteSelectionAnchorRect | null {
  if (!editor || editor.isDestroyed) return null
  const chunks = writeReviewPluginKey.getState(editor.state)?.chunks ?? []
  if (!chunks.length) {
    const held = richSelectionHoldRange(editor)
    if (!held) return null
    try {
      const first = editor.view.coordsAtPos(held.from), last = editor.view.coordsAtPos(held.to)
      const left = Math.min(first.left, last.left), right = Math.max(first.right, last.right)
      return { left, right, top: first.top, bottom: last.bottom, width: right - left, height: last.bottom - first.top }
    } catch { return null }
  }
  try {
    const rects = chunks.flatMap((chunk) => {
      const dom = editor.view.nodeDOM(chunk.from)
      if (dom instanceof HTMLElement) return [dom.getBoundingClientRect()]
      return [editor.view.coordsAtPos(Math.min(chunk.from, editor.state.doc.content.size))]
    })
    const left = Math.min(...rects.map((r) => r.left)), right = Math.max(...rects.map((r) => r.right))
    const top = Math.min(...rects.map((r) => r.top)), bottom = Math.max(...rects.map((r) => r.bottom))
    return { left, right, top, bottom, width: right - left, height: bottom - top }
  } catch { return null }
}
