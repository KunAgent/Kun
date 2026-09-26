import { describe, expect, it } from 'vitest'
import {
  normalizePaperTags,
  paperReadingStatusOf,
  paperUnitMetaSchema,
  upgradePaperMeta
} from './paper-meta-v2'
import type { PaperUnitMetaV1 } from './paper-types'

const v1: PaperUnitMetaV1 = {
  version: 1,
  slug: 'attention',
  title: 'Attention Is All You Need',
  authors: ['Vaswani', 'Shazeer'],
  year: '2017',
  venue: 'NeurIPS',
  arxivId: '1706.03762',
  pdfFile: 'paper.pdf',
  importedAt: '2024-01-01T00:00:00.000Z'
}

describe('paperUnitMetaSchema', () => {
  it('accepts v1 metadata', () => {
    const parsed = paperUnitMetaSchema.parse(v1)
    expect(parsed.version).toBe(1)
  })

  it('accepts v2 metadata with optional pdfFile absent', () => {
    const parsed = paperUnitMetaSchema.parse({
      ...v1,
      version: 2,
      pdfFile: undefined,
      tags: ['transformer'],
      status: 'reading',
      citeKey: 'vaswani2017attention'
    })
    expect(parsed.version).toBe(2)
    expect(parsed.pdfFile).toBeUndefined()
  })

  it('rejects v2 with an out-of-range rating', () => {
    expect(() =>
      paperUnitMetaSchema.parse({ ...v1, version: 2, rating: 9 })
    ).toThrow()
  })
})

describe('upgradePaperMeta', () => {
  it('upgrades v1 in memory without touching v2 fields', () => {
    const upgraded = upgradePaperMeta(v1)
    expect(upgraded.version).toBe(2)
    expect(upgraded.title).toBe(v1.title)
    expect(upgraded.pdfFile).toBe('paper.pdf')
    expect(upgraded.tags).toBeUndefined()
    expect(paperReadingStatusOf(upgraded)).toBe('unread')
  })

  it('returns v2 metas unchanged', () => {
    const v2 = upgradePaperMeta(v1)
    expect(upgradePaperMeta(v2)).toBe(v2)
  })
})

describe('normalizePaperTags', () => {
  it('trims, dedupes and bounds the list', () => {
    expect(normalizePaperTags([' a ', 'a', 'b', '', '  '])).toEqual(['a', 'b'])
    expect(normalizePaperTags(undefined)).toEqual([])
    expect(normalizePaperTags(Array.from({ length: 40 }, (_, i) => `t${i}`))).toHaveLength(32)
  })
})
