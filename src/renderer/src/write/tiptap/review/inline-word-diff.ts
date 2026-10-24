import { diffWordsWithSpace } from 'diff'
import type { Node as PMNode } from '@tiptap/pm/model'
import type { EditorState } from '@tiptap/pm/state'
import type { ReviewChunkState } from './review-plugin'

export const REVIEW_WORD_MERGE_MAX_EQUAL_CHARS = 4
const MAX_INLINE_DIFF_CHARS = 5000

type Segment = { equal: string } | { del: string; ins: string }

/** Merge short unchanged islands so Chinese edits read as phrases, not scattered characters. */
export function reviewTextSegments(before: string, after: string): Segment[] {
  const segments: Segment[] = []
  for (const part of diffWordsWithSpace(before, after)) {
    if (!part.added && !part.removed) {
      segments.push({ equal: part.value })
    } else {
      let last = segments.at(-1)
      if (!last || 'equal' in last) {
        last = { del: '', ins: '' }
        segments.push(last)
      }
      if (part.added) last.ins += part.value
      else last.del += part.value
    }
  }
  for (let i = 1; i < segments.length - 1;) {
    const prev = segments[i - 1], gap = segments[i], next = segments[i + 1]
    if ('equal' in gap && !('equal' in prev) && !('equal' in next) &&
        Array.from(gap.equal).length <= REVIEW_WORD_MERGE_MAX_EQUAL_CHARS) {
      prev.del += gap.equal + next.del
      prev.ins += gap.equal + next.ins
      segments.splice(i, 2)
    } else i++
  }
  return segments
}

export type InlineWordDiff = {
  inserts: Array<{ from: number; to: number }>
  deletes: Array<{ pos: number; text: string }>
  hunks: number
}

export function computeInlineWordDiff(prev: PMNode, next: PMNode, nextStart: number): InlineWordDiff | null {
  if (!prev.isTextblock || !next.isTextblock) return null
  let textOnly = true
  for (const node of [prev, next]) node.forEach((child) => { if (!child.isText) textOnly = false })
  if (!textOnly || Math.max(prev.textContent.length, next.textContent.length) > MAX_INLINE_DIFF_CHARS) return null
  const result: InlineWordDiff = { inserts: [], deletes: [], hunks: 0 }
  let offset = nextStart + 1
  for (const part of reviewTextSegments(prev.textContent, next.textContent)) {
    if ('equal' in part) { offset += part.equal.length; continue }
    result.hunks++
    if (part.del) result.deletes.push({ pos: offset, text: part.del })
    if (part.ins) result.inserts.push({ from: offset, to: offset + part.ins.length })
    offset += part.ins.length
  }
  return result
}

export function countReviewHunks(chunks: ReviewChunkState[], state: EditorState): number {
  return chunks.reduce((count, chunk) => {
    const next = state.doc.nodeAt(chunk.from)
    const diff = chunk.kind === 'modified' && chunk.original.length === 1 && next
      ? computeInlineWordDiff(chunk.original[0], next, chunk.from) : null
    return count + (diff && diff.hunks > 0 ? diff.hunks : 1)
  }, 0)
}
