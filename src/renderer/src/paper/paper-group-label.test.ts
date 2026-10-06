import { describe, expect, it } from 'vitest'
import { paperEntriesInGroup, paperGroupLabel } from './paper-group-label'
import { entry } from '../components/paper/evidence/paper-evidence-test-support'
const t = (key: string): string => key === 'paperBatchGroupFallback' ? 'Paper group' : key

describe('paper group display labels', () => {
  it('keeps human-authored names and raw stable paths unchanged', () => {
    expect(paperGroupLabel('research/retrieval', [entry], t)).toEqual({ label: 'retrieval', identifier: null })
  })
  it('uses a uniquely verified identifier match, never the first member title', () => {
    const paper = { ...entry, group: '2609.01481', meta: { ...entry.meta, arxivId: '2609.01481v2', title: 'Verified paper title' } }
    expect(paperGroupLabel('2609.01481', [entry, paper], t)).toEqual({ label: paper.meta.title, identifier: '2609.01481' })
    expect(paperGroupLabel('2609.01481', [{ ...paper, group: 'elsewhere' }], t)).toEqual({ label: 'Paper group', identifier: '2609.01481' })
    expect(paperGroupLabel('2609.01481', [entry], t)).toEqual({ label: 'Paper group', identifier: '2609.01481' })
  })
  it('falls back honestly for empty, uncertain, ambiguous, or opaque identifier folders', () => {
    expect(paperGroupLabel('2025.acl-long.426-ACL', [], t).label).toBe('Paper group')
    expect(paperGroupLabel('12345', [], t).identifier).toBe('12345')
    const one = { ...entry, group: '2609.01481', meta: { ...entry.meta, arxivId: '2609.01481', needsReview: true } }
    expect(paperGroupLabel('2609.01481', [one], t).label).toBe('Paper group')
    const two = { ...one, meta: { ...one.meta, needsReview: false } }
    expect(paperGroupLabel('2609.01481', [two, { ...two, meta: { ...two.meta, title: 'Conflict' } }], t).label).toBe('Paper group')
  })
  it('selects the whole explicit group including descendants without neighboring prefixes', () => {
    const rows = ['a', 'a/b', 'ab', 'other'].map((group) => ({ ...entry, group, unitDir: `${group}/paper` }))
    expect(paperEntriesInGroup(rows, 'a').map((row) => row.group)).toEqual(['a', 'a/b'])
  })
})
