/**
 * R2.2 translate masking: formulas, URLs, and citation markers are replaced
 * with `⟦n⟧` placeholders before a block goes to the model, then restored
 * from the placeholders in the reply. Keeping the tokens opaque prevents the
 * translator from "fixing" math or mangling [12]-style references.
 */

const MASK_PATTERNS: RegExp[] = [
  /\$\$[\s\S]+?\$\$/g, // display math $$…$$
  /\\\[[\s\S]+?\\\]/g, // \[…\]
  /\\\([\s\S]+?\\\)/g, // \(…\)
  /\$[^$\n]+?\$/g, // inline math $…$ (single line)
  /https?:\/\/[^\s)\]]+/g, // URLs
  /\b10\.\d{4,9}\/[^\s)\]]+/g, // DOI literals
  /\[(?:\d+\s*(?:[-–—,;]\s*\d+\s*)*)\]/g, // [12], [3, 7], [14–18]
  /\b(?:Eq\.?|Equation)\s*\(?\d+(?:\.\d+)?\)?/g // Eq. (2)
]

const PLACEHOLDER_RE = /⟦\s*(\d+)\s*⟧/g

export type MaskedBlockText = {
  /** Text with `⟦n⟧` placeholders, safe to send to the model. */
  masked: string
  /** Put the originals back into a model reply that kept the markers. */
  restore: (translated: string) => string
}

export function maskBlockText(text: string): MaskedBlockText {
  const originals: string[] = []
  let masked = ''
  let cursor = 0
  // Collect matches across all patterns, then emit left-to-right; overlaps
  // resolve in favour of whichever pattern won the earliest start.
  const matches: Array<{ start: number; end: number; raw: string }> = []
  for (const pattern of MASK_PATTERNS) {
    pattern.lastIndex = 0
    for (const match of text.matchAll(pattern)) {
      const start = match.index ?? 0
      matches.push({ start, end: start + match[0].length, raw: match[0] })
    }
  }
  matches.sort((a, b) => a.start - b.start || b.end - a.end)
  for (const match of matches) {
    if (match.start < cursor) continue
    masked += text.slice(cursor, match.start)
    masked += `⟦${originals.length}⟧`
    originals.push(match.raw)
    cursor = match.end
  }
  masked += text.slice(cursor)
  return {
    masked,
    restore: (translated: string) =>
      translated.replace(PLACEHOLDER_RE, (_, digits: string) =>
        originals[Number(digits)] ?? `⟦${digits}⟧`)
  }
}
