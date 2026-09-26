import { describe, expect, it } from 'vitest'
import {
  expandCitationNumbers,
  findPaperCitations,
  resolveAuthorYear,
  resolveFigureLabel,
  resolveReferenceNumber
} from './pdf-citation-resolve'

describe('expandCitationNumbers', () => {
  it('expands singles and ranges', () => {
    expect(expandCitationNumbers('3, 7')).toEqual([3, 7])
    expect(expandCitationNumbers('14–18')).toEqual([14, 15, 16, 17, 18])
    expect(expandCitationNumbers('3, 7, 14-16')).toEqual([3, 7, 14, 15, 16])
  })

  it('caps runaway ranges and skips empties', () => {
    expect(expandCitationNumbers('1–999').length).toBe(0)
    expect(expandCitationNumbers(' , ')).toEqual([])
  })
})

describe('findPaperCitations', () => {
  it('finds bracketed reference hits', () => {
    const hits = findPaperCitations('as shown by [12] and [3, 7].')
    expect(hits).toHaveLength(2)
    expect(hits[0].kind).toBe('reference')
    expect(hits[0].numbers).toEqual([12])
    expect(hits[1].numbers).toEqual([3, 7])
  })

  it('finds figure/table/equation hits', () => {
    const hits = findPaperCitations('see Figure 3, Fig. 4a, Table 1 and Eq. (2)')
    const kinds = hits.map((h) => h.kind)
    expect(kinds).toEqual(['figure', 'figure', 'table', 'equation'])
    expect(hits[0].objectNumber).toBe(3)
    expect(hits[3].objectNumber).toBe(2)
  })

  it('finds author-year hits', () => {
    const hits = findPaperCitations('attention (Vaswani et al., 2017) works')
    expect(hits).toHaveLength(1)
    expect(hits[0]).toMatchObject({ kind: 'authorYear', surname: 'Vaswani', year: '2017' })
  })

  it('returns hits in reading order', () => {
    const hits = findPaperCitations('Figure 2 cites [5] before (Doe, 2020).')
    expect(hits.map((h) => h.kind)).toEqual(['figure', 'reference', 'authorYear'])
  })
})

describe('resolution helpers', () => {
  const refs = [
    { n: 1, title: 'A', authors: ['Ashish Vaswani', 'Noam Shazeer'], year: '2017' },
    { n: 2, title: 'B', authors: ['John Doe'], year: '2020' }
  ]

  it('resolves numbers and author-year', () => {
    expect(resolveReferenceNumber(refs, 2)?.title).toBe('B')
    expect(resolveReferenceNumber(refs, 9)).toBeUndefined()
    expect(resolveAuthorYear(refs, 'Vaswani', '2017')?.n).toBe(1)
    expect(resolveAuthorYear(refs, 'Vaswani', '2018')).toBeUndefined()
  })

  it('resolves figure labels loosely', () => {
    const figures = [
      { id: 'f1', label: 'Figure 3', page: 4 },
      { id: 't1', label: 'Table 1', page: 6 }
    ]
    expect(resolveFigureLabel(figures, 'figure', 3)?.id).toBe('f1')
    expect(resolveFigureLabel(figures, 'figure', 4)).toBeUndefined()
    expect(resolveFigureLabel(figures, 'table', 1)?.id).toBe('t1')
  })
})
