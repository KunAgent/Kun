import { describe, expect, it } from 'vitest'

import {
  isVenueCoolId,
  paperBoardTag,
  paperSlugForArxiv,
  paperSlugForCool,
  paperSlugForLocalFile,
  parseArxivId,
  parseCoolPapersUrl,
  sanitizePaperAssetFileName,
  stripArxivVersion
} from './paper-ids'

describe('stripArxivVersion', () => {
  it('strips the version suffix and arXiv prefix', () => {
    expect(stripArxivVersion('2608.13558v3')).toBe('2608.13558')
    expect(stripArxivVersion('arXiv:1706.03762v2')).toBe('1706.03762')
    expect(stripArxivVersion('arxiv:1706.03762')).toBe('1706.03762')
    expect(stripArxivVersion('  1706.03762  ')).toBe('1706.03762')
    // Old-style id without a version stays intact.
    expect(stripArxivVersion('hep-th/9901001')).toBe('hep-th/9901001')
    expect(stripArxivVersion('cs.CL/0101001')).toBe('cs.CL/0101001')
    // A leading `v` is never treated as a version marker.
    expect(stripArxivVersion('v2')).toBe('v2')
  })
})

describe('parseArxivId', () => {
  it('accepts bare ids in both styles', () => {
    expect(parseArxivId('1706.03762')).toBe('1706.03762')
    expect(parseArxivId('1706.03762v7')).toBe('1706.03762')
    expect(parseArxivId('cs.CL/0101001')).toBe('cs.CL/0101001')
    expect(parseArxivId('hep-th/9901001')).toBe('hep-th/9901001')
    expect(parseArxivId('arXiv:1706.03762v2')).toBe('1706.03762')
  })

  it('accepts arxiv.org URLs', () => {
    expect(parseArxivId('https://arxiv.org/abs/1706.03762v1')).toBe('1706.03762')
    expect(parseArxivId('https://arxiv.org/pdf/2508.05004.pdf?download=1')).toBe('2508.05004')
    expect(parseArxivId('https://arxiv.org/html/2608.13558v3')).toBe('2608.13558')
    expect(parseArxivId('https://arxiv.org/e-print/1706.03762')).toBe('1706.03762')
    expect(parseArxivId('https://export.arxiv.org/abs/1706.03762')).toBe('1706.03762')
    expect(parseArxivId('https://arxiv.org/abs/arXiv:2608.13558v1')).toBe('2608.13558')
  })

  it('rejects non-arxiv input', () => {
    expect(parseArxivId('')).toBeNull()
    expect(parseArxivId('   ')).toBeNull()
    expect(parseArxivId('not a paper')).toBeNull()
    expect(parseArxivId('https://papers.cool/arxiv/2608.13558')).toBeNull()
    expect(parseArxivId('https://arxiv.org/list/cs.AI/recent')).toBeNull()
    expect(parseArxivId('12345')).toBeNull()
  })
})

describe('isVenueCoolId', () => {
  it('accepts cool papers row ids', () => {
    expect(isVenueCoolId('38818@AAAI')).toBe(true)
    expect(isVenueCoolId('2024.acl-long.290@ACL')).toBe(true)
    expect(isVenueCoolId('1706.03762')).toBe(false)
    expect(isVenueCoolId('not an id')).toBe(false)
    expect(isVenueCoolId('')).toBe(false)
  })
})

describe('parseCoolPapersUrl', () => {
  it('parses page and kimi urls', () => {
    expect(parseCoolPapersUrl('https://papers.cool/venue/38818@AAAI')).toEqual({
      branch: 'venue',
      id: '38818@AAAI'
    })
    expect(parseCoolPapersUrl('https://papers.cool/venue/kimi?paper=38818%40AAAI')).toEqual({
      branch: 'venue',
      id: '38818@AAAI'
    })
    expect(parseCoolPapersUrl('https://papers.cool/arxiv/2608.13558')).toEqual({
      branch: 'arxiv',
      id: '2608.13558'
    })
    expect(parseCoolPapersUrl('https://www.papers.cool/arxiv/1706.03762v2')).toEqual({
      branch: 'arxiv',
      id: '1706.03762v2'
    })
  })

  it('rejects other hosts and non-paper pages', () => {
    expect(parseCoolPapersUrl('https://arxiv.org/abs/2608.13558')).toBeNull()
    expect(parseCoolPapersUrl('https://papers.cool/arxiv/search?query=x')).toBeNull()
    expect(parseCoolPapersUrl('https://papers.cool/')).toBeNull()
    expect(parseCoolPapersUrl('https://papers.cool/venue/')).toBeNull()
  })
})

describe('paper slugs', () => {
  it('keeps the arxiv id verbatim', () => {
    expect(paperSlugForArxiv('1706.03762')).toBe('1706.03762')
  })

  it('replaces @ in venue ids', () => {
    expect(paperSlugForCool({ branch: 'venue', id: '38818@AAAI' })).toBe('38818-AAAI')
    expect(paperSlugForCool({ branch: 'arxiv', id: '1706.03762' })).toBe('1706.03762')
  })

  it('derives a slug from local pdf file names', () => {
    expect(paperSlugForLocalFile('Attention Is All You Need.pdf')).toBe(
      'Attention-Is-All-You-Need'
    )
    expect(paperSlugForLocalFile('my paper: draft?.pdf')).toBe('my-paper-draft')
    expect(paperSlugForLocalFile('论文标题.pdf')).toBe('论文标题')
    expect(paperSlugForLocalFile('.pdf')).toBe('paper')
  })

  it('builds an ascii board tag', () => {
    expect(paperBoardTag('1706.03762')).toBe('17060376')
    expect(paperBoardTag('论文标题')).toBe('unit')
  })

  it('sanitizes asset file names', () => {
    expect(sanitizePaperAssetFileName('解读-架构图')).toBe('解读-架构图')
    expect(sanitizePaperAssetFileName('a/b:c*d?')).toBe('abcd')
    expect(sanitizePaperAssetFileName('   ')).toBe('figure')
  })
})
