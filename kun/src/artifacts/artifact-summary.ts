/**
 * Content-addressed artifact summarization (P0 #5).
 *
 * Bash output already has truncation, but MCP results, browser output, large
 * JSON, and attachments do not share a mechanism. Large results should be
 * stored by content hash and the model should see only a bounded preview plus
 * a stable reference, fetching specific slices on demand. This module is the
 * pure core: a content-address id + a head/tail-bounded preview with an
 * explicit reference marker. The byte store itself is a thin layer on top.
 */

import { createHash } from 'node:crypto'

export function artifactId(content: string | Buffer): string {
  const hash = createHash('sha256').update(content).digest('hex')
  return `art_${hash.slice(0, 24)}`
}

export type ArtifactSummary = {
  artifactId: string
  byteSize: number
  lineCount: number
  /** The bounded preview handed to the model. */
  inline: string
  /** True when `inline` is a head/tail excerpt rather than the full content. */
  truncated: boolean
}

/**
 * Produce a model-facing summary of a (possibly huge) text result. When the
 * content fits within `maxInlineChars` it is returned verbatim. Otherwise a
 * head + tail excerpt is returned with a reference marker telling the model how
 * many bytes/lines were elided and how to fetch the full artifact by id.
 */
export function summarizeForModel(input: {
  content: string
  maxInlineChars: number
  /** Fraction of the budget devoted to the head excerpt (rest is tail). Default 0.7. */
  headRatio?: number
}): ArtifactSummary {
  const content = input.content
  const byteSize = Buffer.byteLength(content, 'utf8')
  const lineCount = content.length === 0 ? 0 : content.split('\n').length
  const id = artifactId(content)
  const maxInline = Math.max(0, input.maxInlineChars)

  if (content.length <= maxInline) {
    return { artifactId: id, byteSize, lineCount, inline: content, truncated: false }
  }

  const headRatio = clampRatio(input.headRatio ?? 0.7)
  // Reserve room for the marker so the final inline stays within budget.
  const markerPlaceholder = referenceMarker(id, 0, 0)
  const budget = Math.max(0, maxInline - markerPlaceholder.length)
  const headChars = Math.floor(budget * headRatio)
  const tailChars = Math.max(0, budget - headChars)
  const head = content.slice(0, headChars)
  const tail = tailChars > 0 ? content.slice(content.length - tailChars) : ''
  const omittedChars = content.length - head.length - tail.length
  const omittedLines = Math.max(0, lineCount - countLines(head) - countLines(tail))
  const marker = referenceMarker(id, omittedChars, omittedLines)
  const inline = tail ? `${head}\n${marker}\n${tail}` : `${head}\n${marker}`
  return { artifactId: id, byteSize, lineCount, inline, truncated: true }
}

function referenceMarker(id: string, omittedChars: number, omittedLines: number): string {
  return `[artifact ${id}: ${omittedChars} char(s) / ${omittedLines} line(s) elided — fetch the full artifact or a specific range by id]`
}

function countLines(text: string): number {
  return text.length === 0 ? 0 : text.split('\n').length
}

function clampRatio(value: number): number {
  if (!Number.isFinite(value)) return 0.7
  return Math.min(0.95, Math.max(0.05, value))
}
