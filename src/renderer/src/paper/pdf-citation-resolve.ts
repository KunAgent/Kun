import type { PaperReferenceItem } from '@shared/paper/paper-references-types'

/**
 * Citation / cross-reference detection for the PDF text layer (R2.5).
 * Pure parsing + resolution helpers — the link layer walks text-node content
 * through `findPaperCitations` and resolves hits against references.json /
 * figures/index.json without touching the DOM.
 */

export type PaperCitationKind =
  | 'reference' // [12], [3, 7], [14–18]
  | 'authorYear' // (Vaswani et al., 2017)
  | 'figure' // Figure 3 / Fig. 3
  | 'table' // Table 1
  | 'equation' // Eq. (2)

export type PaperCitationHit = {
  kind: PaperCitationKind
  /** Matched source text, e.g. "[3, 7]" or "Figure 3". */
  raw: string
  /** Character offsets inside the scanned string. */
  start: number
  end: number
  /** Expanded bibliography numbers for `reference` hits. */
  numbers?: number[]
  /** Capitalized object number for figure/table/equation hits. */
  objectNumber?: number
  /** First-author surname + year for `authorYear` hits. */
  surname?: string
  year?: string
}

/** "3, 7, 14–18" → [3, 7, 14, 15, 16, 17, 18]. Ranges cap at 200 entries. */
export function expandCitationNumbers(spec: string): number[] {
  const out: number[] = []
  for (const part of spec.split(/[,;]/)) {
    const range = part.trim().match(/^(\d+)\s*[-–—]\s*(\d+)$/)
    if (range) {
      const from = Number(range[1])
      const to = Number(range[2])
      if (to >= from && to - from <= 200) {
        for (let n = from; n <= to; n += 1) out.push(n)
      }
      continue
    }
    const single = part.trim().match(/^\d+$/)
    if (single) out.push(Number(part.trim()))
  }
  return out
}

const BRACKETED_NUMBERS = /\[(?:\d+\s*(?:[-–—,;]\s*\d+\s*)*)\]/g
const FIGURE_REF = /\b(?:Figure|Fig\.?)\s*(\d+(?:\.\d+)?[a-z]?)/gi
const TABLE_REF_WORD = /\bTable\s*(\d+(?:\.\d+)?[a-z]?)/g
const EQUATION_REF = /\b(?:Eq\.?|Equation)\s*\(?(\d+(?:\.\d+)?)\)?/g
const AUTHOR_YEAR = /\(([A-Z][A-Za-zÀ-ÖØ-öø-ÿ'’-]+)(?:\s+et\s+al\.?)?(?:\s+and\s+[A-Z][A-Za-zÀ-ÖØ-öø-ÿ'’-]+)?,\s*(\d{4})[a-z]?\)/g
// Superscript-style bare citations: ¹²³ or small digit runs like ˆ12 handled
// at the DOM layer; the pure scanner only covers bracketed/named forms.

/**
 * Scan plain text for citation/cross-reference mentions. Returns hits in
 * reading order; overlapping bracket spans win over looser patterns.
 */
export function findPaperCitations(text: string): PaperCitationHit[] {
  const hits: PaperCitationHit[] = []
  for (const match of text.matchAll(BRACKETED_NUMBERS)) {
    const inner = match[0].slice(1, -1)
    const numbers = expandCitationNumbers(inner)
    if (!numbers.length) continue
    hits.push({
      kind: 'reference',
      raw: match[0],
      start: match.index ?? 0,
      end: (match.index ?? 0) + match[0].length,
      numbers
    })
  }
  for (const match of text.matchAll(FIGURE_REF)) {
    const raw = match[0]
    const objectNumber = Number.parseInt(match[1] ?? '', 10)
    if (!Number.isFinite(objectNumber)) continue
    hits.push({
      kind: 'figure',
      raw,
      start: match.index ?? 0,
      end: (match.index ?? 0) + raw.length,
      objectNumber
    })
  }
  for (const match of text.matchAll(TABLE_REF_WORD)) {
    const objectNumber = Number.parseInt(match[1] ?? '', 10)
    if (!Number.isFinite(objectNumber)) continue
    const start = match.index ?? 0
    hits.push({
      kind: 'table',
      raw: match[0],
      start,
      end: start + match[0].length,
      objectNumber
    })
  }
  for (const match of text.matchAll(EQUATION_REF)) {
    const objectNumber = Number.parseInt(match[1] ?? '', 10)
    if (!Number.isFinite(objectNumber)) continue
    hits.push({
      kind: 'equation',
      raw: match[0],
      start: match.index ?? 0,
      end: (match.index ?? 0) + match[0].length,
      objectNumber
    })
  }
  for (const match of text.matchAll(AUTHOR_YEAR)) {
    hits.push({
      kind: 'authorYear',
      raw: match[0],
      start: match.index ?? 0,
      end: (match.index ?? 0) + match[0].length,
      surname: match[1],
      year: match[2]
    })
  }
  return hits.sort((a, b) => a.start - b.start)
}

/** Numeric `[n]` hits resolve to the bibliography item with `item.n === n`. */
export function resolveReferenceNumber(
  items: readonly PaperReferenceItem[],
  n: number
): PaperReferenceItem | undefined {
  return items.find((item) => item.n === n)
}

const normalizeSurname = (value: string): string =>
  value.normalize('NFKD').replace(/[̀-ͯ'’-]/g, '').toLowerCase()

/**
 * Author-year fallback: match `(Surname et al., 2017)` against reference
 * authors' last token and year. Loose matching — bibliography author strings
 * arrive in varied shapes ("A. Vaswani", "Vaswani, Ashish").
 */
export function resolveAuthorYear(
  items: readonly PaperReferenceItem[],
  surname: string,
  year: string
): PaperReferenceItem | undefined {
  const needle = normalizeSurname(surname)
  return items.find((item) => {
    if (item.year !== year) return false
    return (item.authors ?? []).some((author) => {
      const tokens = author.trim().split(/[\s,]+/).map(normalizeSurname)
      return tokens.includes(needle)
    })
  })
}

/** "Figure 3"/"Fig. 3" hits match index labels like "Figure 3" or "Fig. 3". */
export function resolveFigureLabel<T extends { id: string; label: string }>(
  items: readonly T[],
  kind: 'figure' | 'table',
  objectNumber: number
): T | undefined {
  const labelNeedle = kind === 'figure'
    ? /^(?:figure|fig\.?)\s*0*(\d+)/i
    : /^table\s*0*(\d+)/i
  return items.find((item) => {
    const match = item.label.match(labelNeedle)
    return match ? Number(match[1]) === objectNumber : false
  })
}
