import { describe, expect, it } from 'vitest'
import { extractPdfTextBlocks, type PdfTextItemLike } from './pdf-text-blocks'
import fixture from './__fixtures__/two-column-page.json'

/**
 * Fixture: synthetic two-column 612×792pt page — header, left paragraph with
 * a hyphenated wrap, a second left paragraph, a right column, a References
 * section at the bottom of the right column, and a page-number footer.
 */
const PT = fixture.pageWidth
const PH = fixture.pageHeight
const FONT = 9

const items = fixture.items as PdfTextItemLike[]

const item = (str: string, x: number, baselineFromBottom: number, fontSize = FONT): PdfTextItemLike => ({
  str,
  transform: [fontSize, 0, 0, fontSize, x, baselineFromBottom],
  width: str.length * fontSize * 0.5,
  height: fontSize,
  fontName: 'test'
})

describe('extractPdfTextBlocks', () => {
  const blocks = extractPdfTextBlocks(items, 1, PT, PH)

  it('drops header/footer noise', () => {
    const texts = blocks.map((b) => b.text)
    expect(texts.some((t) => t.includes('Journal of Tests'))).toBe(false)
    expect(texts.some((t) => t === '42')).toBe(false)
  })

  it('clusters columns in left-then-right reading order', () => {
    const bodies = blocks.filter((b) => b.kind === 'text').map((b) => b.text)
    expect(bodies[0]).toContain('First column')
    expect(bodies[1]).toContain('Second paragraph')
    expect(bodies[2]).toContain('Right column')
  })

  it('merges hyphenated line wraps', () => {
    const first = blocks.find((b) => b.text.startsWith('First column'))
    expect(first?.text).toBe('First column line one ends with hyphenated and continues here.')
  })

  it('marks blocks after the References heading', () => {
    const refBlock = blocks.find((b) => b.text.includes('Some citation'))
    const heading = blocks.find((b) => b.text === 'References')
    expect(heading?.kind).toBe('reference')
    expect(refBlock?.kind).toBe('reference')
  })

  it('detects caption blocks', () => {
    const withCaption = extractPdfTextBlocks(
      [...items, item('Figure 3: a caption line', 340, PH - 300)],
      1, PT, PH
    )
    expect(withCaption.find((b) => b.text.startsWith('Figure 3'))?.kind).toBe('caption')
  })

  it('normalizes bbox to page fractions with y from top', () => {
    const first = blocks.find((b) => b.text.startsWith('First column'))
    expect(first?.bbox[0]).toBeCloseTo(40 / PT, 2)
    expect(first?.bbox[1]).toBeCloseTo((100 - FONT * 0.8) / PH, 1)
  })
})
