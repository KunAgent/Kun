import { describe, expect, it } from 'vitest'
import type { PaperUnitMetaV2 } from './paper-meta-v2'
import {
  generatePaperBibtex,
  paperBibtexEntry,
  paperCiteKey,
  parseBibtexEntries
} from './paper-bibtex'

function meta(overrides: Partial<PaperUnitMetaV2>): PaperUnitMetaV2 {
  return {
    version: 2,
    slug: 's',
    title: 'Attention Is All You Need',
    authors: ['Ashish Vaswani', 'Noam Shazeer'],
    importedAt: '2024-01-01T00:00:00Z',
    preprocess: { textStatus: 'ok', figuresStatus: 'ok' },
    ...overrides
  } as PaperUnitMetaV2
}

describe('paperCiteKey', () => {
  it('derives authorYearWord', () => {
    expect(paperCiteKey(meta({ year: '2017' }), new Set())).toBe('vaswani2017attention')
  })

  it('keeps an explicit citeKey', () => {
    expect(paperCiteKey(meta({ citeKey: 'transformer' }), new Set())).toBe('transformer')
  })

  it('suffixes collisions', () => {
    const taken = new Set(['vaswani2017attention'])
    expect(paperCiteKey(meta({ year: '2017' }), taken)).toBe('vaswani2017attention-b')
  })

  it('re-derives when the declared key is taken', () => {
    const taken = new Set(['transformer'])
    expect(paperCiteKey(meta({ citeKey: 'transformer', year: '2017' }), taken))
      .toBe('vaswani2017attention')
  })
})

describe('paperBibtexEntry', () => {
  it('emits @article with doi and venue', () => {
    const entry = paperBibtexEntry(meta({ year: '2017', doi: '10.1/x', venue: 'NeurIPS' }), 'k')
    expect(entry).toContain('@article{k,')
    expect(entry).toContain('doi = {10.1/x}')
    expect(entry).toContain('author = {Ashish Vaswani and Noam Shazeer}')
  })

  it('emits @misc with eprint for arXiv-only papers', () => {
    const entry = paperBibtexEntry(meta({ arxivId: '1706.03762', year: '2017' }), 'k')
    expect(entry).toContain('@misc{k,')
    expect(entry).toContain('eprint = {1706.03762}')
    expect(entry).toContain('archivePrefix = {arXiv}')
  })

  it('prefers a stored bibtex record verbatim', () => {
    const stored = '@inproceedings{x2020, title={T}}'
    expect(paperBibtexEntry(meta({ bibtex: stored }), 'k')).toBe(stored)
  })
})

describe('generatePaperBibtex / parseBibtexEntries', () => {
  it('round-trips generated entries', () => {
    const bib = generatePaperBibtex([
      meta({ year: '2017', doi: '10.1/a' }),
      meta({ title: 'BERT', authors: ['Jacob Devlin'], year: '2019', arxivId: '1810.04805' })
    ])
    const entries = parseBibtexEntries(bib)
    expect(entries).toHaveLength(2)
    expect(entries[0].fields.title).toBe('Attention Is All You Need')
    expect(entries[0].fields.doi).toBe('10.1/a')
    expect(entries[1].fields.eprint).toBe('1810.04805')
    expect(entries[0].citeKey).not.toBe(entries[1].citeKey)
  })

  it('parses quoted and bare values and skips preamble', () => {
    const entries = parseBibtexEntries(
      '@preamble{"x"}\n@article{a, title = "Quoted {T}", year = 2020}\n@misc{b,title={T2}}'
    )
    expect(entries.map((e) => e.citeKey)).toEqual(['a', 'b'])
    expect(entries[0].fields.title).toBe('Quoted {T}')
    expect(entries[0].fields.year).toBe('2020')
  })
})
