/**
 * R2.1 page text-block extraction — no layout model, just pdf.js text items
 * clustered into paragraph blocks for the translate overlay:
 *
 *   ① items → PDF-space bboxes
 *   ② cluster into lines (baseline y diff < 0.5 × font height)
 *   ③ join items in a line by x (gap > 0.25 × font height ⇒ space; a line
 *     ending in '-' merged into a lowercase-starting next line loses the '-')
 *   ④ merge lines into paragraphs (x-start diff < 1.5 char widths, line gap
 *     < 1.8 × font height, font size within ±15%)
 *   ⑤ two-column split when nothing crosses the page midline
 *   ⑥ drop headers/footers (top/bottom 6% zones, < 60 chars) and pure-number
 *     lines; blocks after a References heading become kind 'reference'
 */

export type PdfTextItemLike = {
  str: string
  /** pdf.js transform: [a, b, c, d, x, y] in user space (origin bottom-left). */
  transform: number[]
  width?: number
  height?: number
  fontName?: string
}

export type PdfTextBlockKind = 'text' | 'heading' | 'caption' | 'reference'

export type PdfTextBlock = {
  id: string
  page: number
  /** Normalized [x, y, w, h] with y measured from the page TOP (CSS order). */
  bbox: [number, number, number, number]
  text: string
  fontSize: number
  kind: PdfTextBlockKind
}

type NormItem = {
  x: number
  top: number
  height: number
  baselineDown: number
  width: number
  fontSize: number
  str: string
}

type Line = {
  items: NormItem[]
  xStart: number
  baselineDown: number
  fontSize: number
  top: number
  bottom: number
}

const CAPTION_RE = /^(Figure|Fig\.|Table)\s*\d+/
const REFERENCES_HEADING_RE = /^(references|bibliography|参考文献)[\s.:]*$/i
const PURE_NUMBER_RE = /^\d+$/

const median = (values: number[]): number => {
  if (!values.length) return 0
  const sorted = [...values].sort((a, b) => a - b)
  const mid = Math.floor(sorted.length / 2)
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2
}

function normalizeItem(item: PdfTextItemLike, pageHeight: number): NormItem | null {
  const str = item.str
  if (!str || !str.trim()) return null
  const x = item.transform[4] ?? 0
  const y = item.transform[5] ?? 0
  const fontSize = Math.hypot(item.transform[2] ?? 0, item.transform[3] ?? 0) || item.height || 0
  if (fontSize <= 0) return null
  const width = item.width ?? str.length * fontSize * 0.5
  const height = item.height && item.height > 0 ? Math.min(item.height, fontSize * 1.5) : fontSize
  // Baseline sits ~0.2×font below the glyph box bottom in user space (y-up).
  const top = pageHeight - (y + fontSize * 0.8)
  const baselineDown = pageHeight - y
  return { x, top, height, baselineDown, width, fontSize, str }
}

function clusterLines(items: NormItem[]): Line[] {
  const sorted = [...items].sort((a, b) => a.baselineDown - b.baselineDown)
  const lines: Line[] = []
  for (const item of sorted) {
    const line = lines.find((l) => Math.abs(l.baselineDown - item.baselineDown) < l.fontSize * 0.5)
    if (line) {
      line.items.push(item)
      line.baselineDown = (line.baselineDown + item.baselineDown) / 2
      line.fontSize = Math.max(line.fontSize, item.fontSize)
      line.top = Math.min(line.top, item.top)
      line.bottom = Math.max(line.bottom, item.top + item.height)
      line.xStart = Math.min(line.xStart, item.x)
    } else {
      lines.push({
        items: [item],
        xStart: item.x,
        baselineDown: item.baselineDown,
        fontSize: item.fontSize,
        top: item.top,
        bottom: item.top + item.height
      })
    }
  }
  for (const line of lines) line.items.sort((a, b) => a.x - b.x)
  return lines.sort((a, b) => a.baselineDown - b.baselineDown)
}

function lineText(line: Line): string {
  let text = ''
  let prevRight: number | null = null
  for (const item of line.items) {
    const gap = prevRight === null ? 0 : item.x - prevRight
    if (prevRight !== null && gap > item.fontSize * 0.25 && !text.endsWith(' ')) {
      text += ' '
    }
    text += item.str
    prevRight = Math.max(prevRight ?? 0, item.x + item.width)
  }
  return text.trim()
}

/** Merge two paragraph-adjacent lines' text with hyphenation handling. */
function mergeLineTexts(prev: string, next: string): string {
  if (prev.endsWith('-') && /^[a-z]/.test(next)) return prev.slice(0, -1) + next
  return `${prev} ${next}`
}

/**
 * Two-column detection runs on items before line clustering (otherwise same-y
 * lines from both columns would merge and the midline check could never see
 * the gap): when no item overlaps the midline band and items exist on both
 * sides, each side is clustered into its own column in reading order.
 */
function splitItemsByColumn(items: NormItem[], pageWidth: number, pageHeight: number): NormItem[][] {
  const mid = pageWidth / 2
  const band = 24 // user units around the midline
  // Margin-zone items (headers/footers) legitimately span the midline; the
  // column test only looks at body items — they get dropped later anyway.
  const margin = pageHeight * 0.06
  const body = items.filter((i) => i.top >= margin && i.top + i.height <= pageHeight - margin)
  const touchesBand = body.some((i) => i.x < mid + band && i.x + i.width > mid - band)
  if (touchesBand) return [items]
  const left = items.filter((i) => i.x + i.width / 2 < mid)
  const right = items.filter((i) => i.x + i.width / 2 >= mid)
  if (!left.length || !right.length || !body.length) return [items]
  return [left, right]
}

function mergeLinesIntoParagraphs(lines: Line[]): Line[][] {
  const paragraphs: Line[][] = []
  for (const line of lines) {
    const prev = paragraphs[paragraphs.length - 1]?.[paragraphs[paragraphs.length - 1].length - 1]
    // A References heading never absorbs the bibliography entries after it.
    if (
      prev
      && !REFERENCES_HEADING_RE.test(lineText(prev))
      && Math.abs(prev.xStart - line.xStart) < line.fontSize * 0.5 * 1.5
      && line.top - prev.bottom < line.fontSize * 1.8
      && Math.abs(prev.fontSize - line.fontSize) <= line.fontSize * 0.15
    ) {
      paragraphs[paragraphs.length - 1].push(line)
    } else {
      paragraphs.push([line])
    }
  }
  return paragraphs
}

function blockBbox(lines: Line[], pageWidth: number, pageHeight: number): [number, number, number, number] {
  const left = Math.min(...lines.map((l) => l.xStart))
  const right = Math.max(...lines.map((l) => Math.max(...l.items.map((i) => i.x + i.width))))
  const top = Math.min(...lines.map((l) => l.top))
  const bottom = Math.max(...lines.map((l) => l.bottom))
  const clamp = (v: number, max: number): number => Math.min(Math.max(v, 0), max)
  return [
    clamp(left / pageWidth, 1),
    clamp(top / pageHeight, 1),
    clamp((right - left) / pageWidth, 1),
    clamp((bottom - top) / pageHeight, 1)
  ]
}

export function extractPdfTextBlocks(
  items: readonly PdfTextItemLike[],
  page: number,
  pageWidth: number,
  pageHeight: number
): PdfTextBlock[] {
  const normalized = items
    .map((item) => normalizeItem(item, pageHeight))
    .filter((item): item is NormItem => item !== null)
  if (!normalized.length || pageWidth <= 0 || pageHeight <= 0) return []

  const blocks: PdfTextBlock[] = []
  const margin = pageHeight * 0.06
  const bodyFont = median(normalized.map((i) => i.fontSize))
  let inReferences = false

  for (const columnItems of splitItemsByColumn(normalized, pageWidth, pageHeight)) {
    const column = clusterLines(columnItems)
    for (const paragraph of mergeLinesIntoParagraphs(column)) {
      // Rebuild paragraph text so merging is hyphen-aware across line pairs.
      const merged = paragraph.reduce((acc, line) => mergeLineTexts(acc, lineText(line)), '').trim()
      if (!merged || (PURE_NUMBER_RE.test(merged) && paragraph.length === 1)) continue
      const bbox = blockBbox(paragraph, pageWidth, pageHeight)
      const topPx = bbox[1] * pageHeight
      const bottomPx = (bbox[1] + bbox[3]) * pageHeight
      const isMargin = (topPx < margin || pageHeight - bottomPx < margin) && merged.length < 60
      if (isMargin) continue

      const fontSize = median(paragraph.map((l) => l.fontSize))
      if (REFERENCES_HEADING_RE.test(lineText(paragraph[0])) || REFERENCES_HEADING_RE.test(merged)) {
        inReferences = true
      }
      const kind: PdfTextBlockKind = inReferences
        ? 'reference'
        : CAPTION_RE.test(merged)
          ? 'caption'
          : fontSize > bodyFont * 1.15 && paragraph.length === 1
            ? 'heading'
            : 'text'
      blocks.push({
        id: `p${page}b${blocks.length}`,
        page,
        bbox,
        text: merged,
        fontSize,
        kind
      })
    }
  }
  return blocks
}
