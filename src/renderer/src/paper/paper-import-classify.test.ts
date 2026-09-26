import { describe, expect, it } from 'vitest'
import {
  classifyPaperImportLine,
  localPdfImportLine,
  parsePaperImportInput
} from './paper-import-classify'

describe('classifyPaperImportLine', () => {
  it('detects arXiv ids and urls', () => {
    expect(classifyPaperImportLine('1706.03762')).toMatchObject({ kind: 'arxiv', ref: '1706.03762' })
    expect(classifyPaperImportLine('arxiv:2301.00001v2')).toMatchObject({ kind: 'arxiv', ref: '2301.00001' })
    expect(classifyPaperImportLine('https://arxiv.org/abs/2301.00001')).toMatchObject({ kind: 'arxiv' })
    expect(classifyPaperImportLine('https://arxiv.org/pdf/2301.00001')).toMatchObject({ kind: 'arxiv' })
  })

  it('detects papers.cool links', () => {
    expect(classifyPaperImportLine('https://papers.cool/arxiv/2301.00001')).toMatchObject({ kind: 'cool' })
    expect(classifyPaperImportLine('https://papers.cool/venue/ICLR.2025')).toMatchObject({ kind: 'cool' })
  })

  it('detects DOIs bare and via doi.org', () => {
    expect(classifyPaperImportLine('10.1038/nature14539')).toMatchObject({ kind: 'doi', ref: '10.1038/nature14539' })
    expect(classifyPaperImportLine('https://doi.org/10.1038/nature14539')).toMatchObject({ kind: 'doi', ref: '10.1038/nature14539' })
    expect(classifyPaperImportLine('https://dx.doi.org/10.1/x')).toMatchObject({ kind: 'doi' })
  })

  it('detects generic URLs and bibtex blocks', () => {
    expect(classifyPaperImportLine('https://www.nature.com/articles/x')).toMatchObject({ kind: 'url' })
    expect(classifyPaperImportLine('@article{key, title={T}}')).toMatchObject({ kind: 'bibtex' })
  })

  it('falls back to title search', () => {
    expect(classifyPaperImportLine('Attention is all you need')).toMatchObject({ kind: 'title' })
    expect(classifyPaperImportLine('')).toMatchObject({ kind: 'empty' })
  })
})

describe('parsePaperImportInput', () => {
  it('splits multiline input and drops empties', () => {
    const lines = parsePaperImportInput('1706.03762\n\n10.1038/nature14539\nSome title\n')
    expect(lines.map((line) => line.kind)).toEqual(['arxiv', 'doi', 'title'])
  })

  it('treats a leading-@ blob as one bibtex line', () => {
    const lines = parsePaperImportInput('@article{a, title={X}}\n\n@book{b, title={Y}}')
    expect(lines).toHaveLength(1)
    expect(lines[0].kind).toBe('bibtex')
  })

  it('creates localPdf lines for picked files', () => {
    const line = localPdfImportLine('/tmp/papers/attention.pdf')
    expect(line.kind).toBe('localPdf')
    expect(line.ref).toBe('/tmp/papers/attention.pdf')
    expect(line.raw).toBe('attention.pdf')
  })
})
