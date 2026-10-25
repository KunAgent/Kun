import JSZip from 'jszip'
import * as XLSX from 'xlsx'
import { describe, expect, it } from 'vitest'
import {
  changedRanges,
  changeIsEmpty,
  diffOfficeVersions,
  diffParagraphs,
  officeFormatForPath,
  resolvePartPath,
  wordParagraphs
} from './artifact-office-diff'

async function deck(slides: Array<{ part: string; xml: string; chart?: string }>): Promise<Uint8Array> {
  const zip = new JSZip()
  zip.file('ppt/presentation.xml', `<p:presentation xmlns:r="r"><p:sldIdLst>${slides
    .map((_, index) => `<p:sldId id="${256 + index}" r:id="rId${index + 1}"/>`).join('')}</p:sldIdLst></p:presentation>`)
  zip.file('ppt/_rels/presentation.xml.rels', `<Relationships>${slides
    .map((slide, index) => `<Relationship Id="rId${index + 1}" Type="x/slide" Target="${slide.part.replace('ppt/', '')}"/>`).join('')}</Relationships>`)
  for (const slide of slides) {
    zip.file(slide.part, slide.xml)
    const name = slide.part.split('/').pop()
    const rels = ['<Relationship Id="rIdL" Type="x/slideLayout" Target="../slideLayouts/slideLayout1.xml"/>']
    if (slide.chart) {
      rels.push(`<Relationship Id="rIdC" Type="x/chart" Target="../charts/${name}.chart.xml"/>`)
      zip.file(`ppt/charts/${name}.chart.xml`, slide.chart)
    }
    zip.file(`ppt/slides/_rels/${name}.rels`, `<Relationships>${rels.join('')}</Relationships>`)
  }
  return zip.generateAsync({ type: 'uint8array' })
}

async function document(paragraphs: string[]): Promise<Uint8Array> {
  const zip = new JSZip()
  zip.file('word/document.xml', `<w:document><w:body>${paragraphs
    .map((text) => `<w:p><w:pPr/><w:r><w:t xml:space="preserve">${text}</w:t></w:r></w:p>`).join('')}</w:body></w:document>`)
  return zip.generateAsync({ type: 'uint8array' })
}

function workbook(rows: unknown[][]): Uint8Array {
  const book = XLSX.utils.book_new()
  XLSX.utils.book_append_sheet(book, XLSX.utils.aoa_to_sheet(rows), 'Ablation')
  return new Uint8Array(XLSX.write(book, { type: 'array', bookType: 'xlsx' }) as ArrayBuffer)
}

describe('artifact office diff', () => {
  it('resolves relationship targets against their part folder', () => {
    expect(resolvePartPath('ppt/slides', '../charts/chart1.xml')).toBe('ppt/charts/chart1.xml')
    expect(resolvePartPath('ppt', '/ppt/slides/slide1.xml')).toBe('ppt/slides/slide1.xml')
  })

  it('reports changed and added slides by part, including charts the slide references', async () => {
    const before = await deck([
      { part: 'ppt/slides/slide1.xml', xml: '<a>one</a>' },
      { part: 'ppt/slides/slide2.xml', xml: '<a>two</a>', chart: '<c>3 bars</c>' },
      { part: 'ppt/slides/slide3.xml', xml: '<a>three</a>' }
    ])
    const after = await deck([
      { part: 'ppt/slides/slide1.xml', xml: '<a>one</a>' },
      { part: 'ppt/slides/slide2.xml', xml: '<a>two</a>', chart: '<c>3 wider bars</c>' },
      { part: 'ppt/slides/slide3.xml', xml: '<a>three</a>' },
      { part: 'ppt/slides/slide4.xml', xml: '<a>four</a>' }
    ])
    expect(await diffOfficeVersions('pptx', before, after)).toEqual({
      kind: 'presentation', changedSlides: [2], addedSlides: [4], removedSlides: 0, slideCount: 4
    })
  })

  it('reads Word paragraph text with tabs, breaks and entities', () => {
    expect(wordParagraphs('<w:p><w:r><w:t>A&amp;B</w:t><w:tab/><w:t xml:space="preserve"> c</w:t><w:br/></w:r></w:p><w:p/>'))
      .toEqual(['A&B\t c\n', ''])
  })

  it('pairs the changed middle of two paragraph lists and counts edited characters', () => {
    const result = diffParagraphs(['标题', '这段太啰嗦了需要压缩', '结尾'], ['标题', '这段已压缩', '新增一段', '结尾'])
    expect(result.changedCount).toBe(2)
    expect(result.paragraphs.map((paragraph) => paragraph.index)).toEqual([1, 2])
    expect(result.removedChars).toBe(6)
    expect(result.addedChars).toBe(5)
  })

  it('diffs DOCX packages paragraph by paragraph', async () => {
    const change = await diffOfficeVersions('docx', await document(['a', 'b']), await document(['a', 'B!']))
    expect(change).toMatchObject({ kind: 'word', changedCount: 1, paragraphs: [{ index: 1, before: 'b', after: 'B!' }] })
  })

  it('groups changed spreadsheet cells into ranges', async () => {
    expect(changedRanges(['C2', 'C3', 'D2', 'D3', 'F5'])).toEqual(['C2:D3', 'F5'])
    const before = workbook([['method', 'base', 'new'], ['GRPO', 1, 2], ['RLOO', 1, 3]])
    const after = workbook([['method', 'base', 'new', 'lift'], ['GRPO', 1, 2, 1], ['RLOO', 1, 3, 2]])
    expect(await diffOfficeVersions('xlsx', before, after)).toEqual({
      kind: 'spreadsheet', cellCount: 3, sheets: [{ name: 'Ablation', ranges: ['D1:D3'], cellCount: 3 }]
    })
  })

  it('falls back to unknown on unreadable input and classifies formats', async () => {
    expect(await diffOfficeVersions('pptx', new Uint8Array([1, 2]), new Uint8Array([3]))).toEqual({ kind: 'unknown' })
    expect(officeFormatForPath('a/B.PPTX')).toBe('pptx')
    expect(officeFormatForPath('a/b.ppt')).toBeNull()
    expect(changeIsEmpty({ kind: 'spreadsheet', sheets: [], cellCount: 0 })).toBe(true)
  })
})
