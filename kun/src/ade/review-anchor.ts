/**
 * Review-comment re-anchoring (docs/ade/11 §4.3). Pure function shared with
 * `src/shared/review-anchor.ts` — keep both copies byte-identical; behavior
 * is pinned by `kun/src/ade/__fixtures__/review-anchor.json`.
 */

export type ReviewAnchor = {
  /** Text of the commented line at anchor time. */
  lineText: string
  /** Up to 3 preceding context lines. */
  before: string[]
  /** Up to 3 following context lines. */
  after: string[]
}

export type ReanchorInput = {
  /** Current 1-based line the comment points at. */
  line: number
  side?: 'new' | 'old'
  anchor: ReviewAnchor
}

export type ReanchorResult = { line: number } | { outdated: true }

const WINDOW = 20

/** How many of the recorded context lines still match at `index` (0-based). */
function contextScore(anchor: ReviewAnchor, lines: string[], index: number): number {
  let score = 0
  for (let k = 0; k < anchor.before.length; k += 1) {
    if (lines[index - (k + 1)] === anchor.before[k]) score += 1
  }
  for (let k = 0; k < anchor.after.length; k += 1) {
    if (lines[index + (k + 1)] === anchor.after[k]) score += 1
  }
  return score
}

/** Every recorded context line still matches at `index` exactly. */
function contextExact(anchor: ReviewAnchor, lines: string[], index: number): boolean {
  for (let k = 0; k < anchor.before.length; k += 1) {
    if (lines[index - (k + 1)] !== anchor.before[k]) return false
  }
  for (let k = 0; k < anchor.after.length; k += 1) {
    if (lines[index + (k + 1)] !== anchor.after[k]) return false
  }
  return true
}

/**
 * Re-anchor a comment after the file changed:
 * 1. ±20 lines around the recorded line: identical `lineText`, scored by
 *    surviving context (ties break toward the recorded line).
 * 2. Otherwise the whole file: `lineText` plus all recorded context must
 *    match at exactly one position.
 * 3. Otherwise the comment is `outdated` — it stays sendable but no longer
 *    points at a concrete line.
 */
export function reanchorComment(input: ReanchorInput, lines: string[]): ReanchorResult {
  const target = input.line - 1
  let bestIndex = -1
  let bestScore = -1
  let bestDistance = Number.POSITIVE_INFINITY
  let ambiguous = false
  const lo = Math.max(0, target - WINDOW)
  const hi = Math.min(lines.length - 1, target + WINDOW)
  for (let i = lo; i <= hi; i += 1) {
    if (lines[i] !== input.anchor.lineText) continue
    const score = contextScore(input.anchor, lines, i)
    const distance = Math.abs(i - target)
    if (
      score > bestScore ||
      (score === bestScore && distance < bestDistance)
    ) {
      bestIndex = i
      bestScore = score
      bestDistance = distance
      ambiguous = false
    } else if (score === bestScore && distance === bestDistance) {
      // Several equally good candidates cannot be told apart — fall through
      // to the whole-file exact check instead of guessing.
      ambiguous = true
    }
  }
  if (bestIndex >= 0 && !ambiguous) return { line: bestIndex + 1 }
  const exact: number[] = []
  for (let i = 0; i < lines.length; i += 1) {
    if (lines[i] === input.anchor.lineText && contextExact(input.anchor, lines, i)) {
      exact.push(i)
    }
  }
  if (exact.length === 1) return { line: exact[0] + 1 }
  return { outdated: true }
}
