import { describe, expect, it } from 'vitest'
import { paperCitationMarkdown } from './paper-citation-copy'

describe('paperCitationMarkdown', () => {
  it('formats a quote citation with a page deep link', () => {
    expect(
      paperCitationMarkdown({
        quote: 'Attention is all you need.',
        title: 'Attention Is All You Need',
        page: 4,
        unitDir: 'papers/1706.03762',
        pdfFile: '1706.03762.pdf'
      })
    ).toBe(
      '> Attention is all you need.\n' +
        '> —— 《Attention Is All You Need》 [p.4](papers/1706.03762/1706.03762.pdf#page=4)'
    )
  })

  it('appends the note line when a comment exists', () => {
    const out = paperCitationMarkdown({
      quote: 'x',
      title: 'T',
      page: 2,
      unitDir: 'papers/a1',
      pdfFile: 'a1.pdf',
      comment: ' key insight '
    })
    expect(out.split('\n').at(-1)).toBe('注：key insight')
  })

  it('collapses multi-line quotes into one blockquote line', () => {
    const out = paperCitationMarkdown({
      quote: 'first\n\n  second',
      title: 'T',
      page: 1,
      unitDir: 'papers/a',
      pdfFile: 'a.pdf'
    })
    expect(out.startsWith('> first second\n')).toBe(true)
  })

  it('falls back to <slug>.pdf and the slug as title', () => {
    const out = paperCitationMarkdown({
      quote: 'q',
      title: '  ',
      page: 7,
      unitDir: 'papers/2301.00001'
    })
    expect(out).toContain('[p.7](papers/2301.00001/2301.00001.pdf#page=7)')
    expect(out).toContain('《2301.00001》')
  })

  it('omits the quote line for empty quotes (region marks)', () => {
    const out = paperCitationMarkdown({
      quote: '',
      title: 'T',
      page: 3,
      unitDir: 'papers/x',
      pdfFile: 'x.pdf',
      comment: 'region'
    })
    expect(out.startsWith('> ——')).toBe(true)
  })
})
