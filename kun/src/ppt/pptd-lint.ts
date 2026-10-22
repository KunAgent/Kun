import { asNumber, asRecord, asString, resolveBounds, stripRichText, type PptdDeck } from './pptd-deck.js'
import { mergePptdTextStyle } from './pptd-preview-text.js'

/**
 * Fast static checks on an editable PPTD deck, run on every preview. They are
 * feedback for the agent, not gates: the export still runs its OOXML geometry
 * QA. Estimates are deliberately conservative so a warning is worth reading.
 */

export type PptdLintRule = 'off-slide' | 'small-text' | 'text-overflow' | 'stretched-image' | 'font-sprawl'

export type PptdLintIssue = {
  /** 1-based page number; 0 for deck-wide issues. */
  page: number
  elementId?: string
  rule: PptdLintRule
  message: string
}

const MIN_TEXT_SIZE = 12
const MIN_TABLE_TEXT_SIZE = 10
const MAX_FONT_FAMILIES = 3
const MAX_ISSUES = 40

function isWide(char: string): boolean {
  const code = char.codePointAt(0) ?? 0
  return (code >= 0x2e80 && code <= 0x9fff) || (code >= 0xac00 && code <= 0xd7af) ||
    (code >= 0xf900 && code <= 0xfaff) || (code >= 0xff00 && code <= 0xffef) || (code >= 0x3000 && code <= 0x303f)
}

/** Rough rendered width of one line: full-width glyphs ≈ 1em, others ≈ 0.55em. */
function lineWidth(line: string, fontSize: number): number {
  let width = 0
  for (const char of line) width += isWide(char) ? fontSize : fontSize * 0.55
  return width
}

function estimatedTextHeight(text: string, fontSize: number, lineHeight: number, boxWidth: number, wrap: boolean): number {
  const usable = Math.max(boxWidth - 4, fontSize)
  let lines = 0
  for (const paragraph of text.split('\n')) {
    lines += wrap ? Math.max(1, Math.ceil(lineWidth(paragraph, fontSize) / usable)) : 1
  }
  return lines * fontSize * lineHeight * 1.2
}

function fontNames(value: unknown): string[] {
  if (typeof value === 'string') return [value.trim()].filter(Boolean)
  const record = asRecord(value)
  return [asString(record?.latin), asString(record?.ea)].filter((name): name is string => Boolean(name?.trim()))
}

export function lintPptdDeck(deck: PptdDeck): PptdLintIssue[] {
  const issues: PptdLintIssue[] = []
  const textStyles = asRecord(deck.theme.textStyles) ?? {}
  const families = new Set<string>()
  const { width: pageWidth, height: pageHeight } = deck.pageSize
  for (const style of Object.values(textStyles)) {
    for (const name of fontNames(asRecord(style)?.fontFamily)) families.add(name)
  }
  for (const page of deck.pages) {
    const pageNumber = page.index + 1
    for (const value of Array.isArray(page.record.elements) ? page.record.elements : []) {
      const element = asRecord(value)
      const rect = resolveBounds(element?.bounds)
      if (!element || !rect) continue
      const elementId = asString(element.elementId)
      const type = asString(element.elementType)
      const tolerance = 2
      if (rect.x < -tolerance || rect.y < -tolerance ||
        rect.x + rect.width > pageWidth + tolerance || rect.y + rect.height > pageHeight + tolerance) {
        issues.push({ page: pageNumber, elementId, rule: 'off-slide', message: `${type ?? 'element'} extends past the ${pageWidth}×${pageHeight} slide` })
      }
      if (type === 'text') {
        const content = asRecord(element.content) ?? {}
        const style = mergePptdTextStyle([content], textStyles)
        for (const name of fontNames(style.fontFamily)) families.add(name)
        const fontSize = style.fontSize ?? 18
        const text = stripRichText(content.text)
        if (!text) continue
        if (fontSize < MIN_TEXT_SIZE) {
          issues.push({ page: pageNumber, elementId, rule: 'small-text', message: `text is ${fontSize}pt; keep slide text at ${MIN_TEXT_SIZE}pt or larger` })
        }
        const lineHeight = style.lineHeightPx !== undefined ? style.lineHeightPx / (fontSize * 1.2) : style.lineHeight ?? 1
        const needed = estimatedTextHeight(text, fontSize, lineHeight, rect.width, content.wrap !== false)
        if (needed > rect.height * 1.15 + 4) {
          issues.push({
            page: pageNumber,
            elementId,
            rule: 'text-overflow',
            message: `text likely overflows: needs about ${Math.round(needed)}px but the box is ${Math.round(rect.height)}px tall; shorten it, enlarge the box, or split the page`
          })
        }
      }
      if (type === 'table') {
        for (const row of Array.isArray(element.rows) ? element.rows : []) {
          for (const cell of Array.isArray(row) ? row : []) {
            const size = asNumber(asRecord(cell)?.fontSize)
            if (size !== undefined && size < MIN_TABLE_TEXT_SIZE) {
              issues.push({ page: pageNumber, elementId, rule: 'small-text', message: `table text is ${size}pt; keep it at ${MIN_TABLE_TEXT_SIZE}pt or larger` })
            }
          }
        }
      }
      if (type === 'image' && asString(asRecord(element.fit)?.mode) === 'fill') {
        issues.push({ page: pageNumber, elementId, rule: 'stretched-image', message: 'fit mode "fill" stretches the picture; use "cover" or "contain"' })
      }
    }
  }
  if (families.size > MAX_FONT_FAMILIES) {
    issues.unshift({ page: 0, rule: 'font-sprawl', message: `the deck uses ${families.size} font families (${[...families].join(', ')}); keep it to two or three` })
  }
  return issues.slice(0, MAX_ISSUES)
}
