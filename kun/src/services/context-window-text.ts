import {
  CONTEXT_WINDOWS_OUTPUT_MAX_TOKENS,
  CONTEXT_WINDOWS_TEXT_MAX_BYTES,
  type TextSegment
} from '../contracts/context-windows.js'

const SNIPPET_RADIUS_CHARS = 120
// Coarse token proxy for the output cap: the tool layer applies the exact
// min(existing tool token cap, 4096) token budget on top of these bytes.
const TOKEN_CAP_CHARS = CONTEXT_WINDOWS_OUTPUT_MAX_TOKENS * 4

function utf8Bytes(value: string): number {
  return Buffer.byteLength(value, 'utf8')
}

function clampToByteBudget(text: string, maxBytes: number): string {
  if (utf8Bytes(text) <= maxBytes) return text
  let end = text.length
  while (end > 0 && utf8Bytes(text.slice(0, end)) > maxBytes) end -= 1
  return text.slice(0, end)
}

export type BoundedTextRead = {
  segments: TextSegment[]
  truncated: boolean
  nextOffset: number | null
}

/** Read one bounded page of text by char offset, capped by bytes and tokens. */
export function segmentRead(text: string, offset: number): BoundedTextRead {
  const start = Math.min(Math.max(0, offset), text.length)
  const remaining = text.slice(start)
  const charBudget = Math.min(remaining.length, TOKEN_CAP_CHARS)
  const slice = clampToByteBudget(remaining.slice(0, charBudget), CONTEXT_WINDOWS_TEXT_MAX_BYTES)
  const consumed = start + slice.length
  const truncated = consumed < text.length
  return {
    segments: slice ? [{ text: slice, truncated: false }] : [],
    truncated,
    nextOffset: truncated ? consumed : null
  }
}

function snippetAround(text: string, matchIndex: number, needleLength: number): TextSegment {
  const from = Math.max(0, matchIndex - SNIPPET_RADIUS_CHARS)
  const to = Math.min(text.length, matchIndex + needleLength + SNIPPET_RADIUS_CHARS)
  return { text: text.slice(from, to), truncated: from > 0 || to < text.length }
}

/** First match of `needle` (case-insensitive) as a bounded snippet, or null. */
export function matchSnippet(text: string, needle: string): TextSegment | null {
  const index = text.toLowerCase().indexOf(needle)
  return index < 0 ? null : snippetAround(text, index, needle.length)
}

/** Up to `limit` bounded snippets, one per occurrence of `needle`. */
export function matchSnippets(text: string, needle: string, limit: number): TextSegment[] {
  const snippets: TextSegment[] = []
  let fromIndex = 0
  while (snippets.length < limit) {
    const index = text.toLowerCase().indexOf(needle, fromIndex)
    if (index < 0) break
    snippets.push(snippetAround(text, index, needle.length))
    fromIndex = index + needle.length
  }
  return snippets
}
