import { describe, expect, it } from 'vitest'
import type { PaperLibraryEntry } from '@shared/paper/paper-library-types'
import type { PaperUnitMetaV2 } from '@shared/paper/paper-meta-v2'
import { emptyPaperLibraryFilter } from './paper-mode-store'
import { filterPaperEntries, sortPaperEntries } from './paper-library-filter'

function meta(partial: Partial<PaperUnitMetaV2> = {}): PaperUnitMetaV2 {
  return {
    version: 2,
    slug: 'unit',
    title: 'Untitled',
    authors: [],
    importedAt: '2024-01-01T00:00:00.000Z',
    ...partial
  }
}

function entry(partial: Partial<PaperLibraryEntry> & { meta: PaperUnitMetaV2 }): PaperLibraryEntry {
  return {
    unitDir: `papers/${partial.meta.slug}`,
    hasPdf: true,
    hasNotes: false,
    interpretationCount: 0,
    group: '',
    ...partial
  }
}

const NOW = Date.parse('2024-06-15T00:00:00.000Z')

const entries: PaperLibraryEntry[] = [
  entry({
    meta: meta({ slug: 'a', title: 'Attention Is All You Need', authors: ['Vaswani'], year: '2017', venue: 'NeurIPS', tags: ['transformer'], status: 'read' }),
    lastOpenedAt: '2024-06-10T00:00:00.000Z'
  }),
  entry({
    meta: meta({ slug: 'b', title: 'BERT Pre-training', authors: ['Devlin'], year: '2019', venue: 'NAACL', status: 'reading' }),
    group: 'nlp',
    lastOpenedAt: '2023-01-01T00:00:00.000Z'
  }),
  entry({
    meta: meta({ slug: 'c', title: 'Diffusion Models', authors: ['Ho'], year: '2020', tags: ['generative'] })
  })
]

describe('filterPaperEntries', () => {
  it('matches the query across title, authors and tags', () => {
    expect(filterPaperEntries(entries, { ...emptyPaperLibraryFilter(), query: 'attention' }, NOW)).toHaveLength(1)
    expect(filterPaperEntries(entries, { ...emptyPaperLibraryFilter(), query: 'devlin' }, NOW)).toHaveLength(1)
    expect(filterPaperEntries(entries, { ...emptyPaperLibraryFilter(), query: 'transformer' }, NOW)).toHaveLength(1)
    expect(filterPaperEntries(entries, { ...emptyPaperLibraryFilter(), query: 'zzz' }, NOW)).toHaveLength(0)
  })

  it('filters by status, tag, group, year and source', () => {
    expect(filterPaperEntries(entries, { ...emptyPaperLibraryFilter(), status: 'reading' }, NOW)).toHaveLength(1)
    expect(filterPaperEntries(entries, { ...emptyPaperLibraryFilter(), tag: 'generative' }, NOW)).toHaveLength(1)
    expect(filterPaperEntries(entries, { ...emptyPaperLibraryFilter(), group: 'nlp' }, NOW)).toHaveLength(1)
    expect(filterPaperEntries(entries, { ...emptyPaperLibraryFilter(), year: '2017' }, NOW)).toHaveLength(1)
    expect(
      filterPaperEntries(entries, { ...emptyPaperLibraryFilter(), source: 'arxiv' }, NOW)
    ).toHaveLength(0)
  })

  it('treats missing status as unread and bounds the recent window', () => {
    expect(filterPaperEntries(entries, { ...emptyPaperLibraryFilter(), status: 'unread' }, NOW)).toHaveLength(1)
    // Only the 2024-06-10 open is inside the 30-day window of NOW.
    expect(filterPaperEntries(entries, { ...emptyPaperLibraryFilter(), recent: true }, NOW)).toHaveLength(1)
  })
})

describe('sortPaperEntries', () => {
  it('sorts by title ascending with numeric collation', () => {
    const sorted = sortPaperEntries(entries, { key: 'title', dir: 'asc' })
    expect(sorted.map((e) => e.meta.slug)).toEqual(['a', 'b', 'c'])
  })

  it('sorts by year descending', () => {
    const sorted = sortPaperEntries(entries, { key: 'year', dir: 'desc' })
    expect(sorted[0].meta.slug).toBe('c')
    expect(sorted[2].meta.slug).toBe('a')
  })

  it('orders status reading < unread < read ascending', () => {
    const sorted = sortPaperEntries(entries, { key: 'status', dir: 'asc' })
    expect(sorted.map((e) => e.meta.status ?? 'unread')).toEqual(['reading', 'unread', 'read'])
  })

  it('puts missing lastOpenedAt last for desc sort', () => {
    const sorted = sortPaperEntries(entries, { key: 'lastOpenedAt', dir: 'desc' })
    expect(sorted[0].meta.slug).toBe('a')
    expect(sorted[sorted.length - 1].meta.slug).toBe('c')
  })
})
