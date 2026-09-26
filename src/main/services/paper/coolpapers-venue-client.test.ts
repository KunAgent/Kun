import { describe, expect, it } from 'vitest'
import { parseCoolVenueCatalog, parseCoolVenuePage } from './coolpapers-venue-client'

const PAPER = (id: string, title: string, subject: string): string => `
        <div id="${id}@OpenReview" class="panel paper" keywords="a,b">
            <h2 class="title">
                <a href="https://openreview.net/forum?id=${id}" target="_blank" title="1/3758"><span class="index notranslate">#1</span></a>
                <a id="title-${id}@OpenReview" class="title-link notranslate" href="/venue/${id}@OpenReview" target="_blank">${title}</a>
                <a id="pdf-${id}@OpenReview" class="title-pdf notranslate" onclick="togglePdf('x', this)" data="https://openreview.net/pdf?id=${id}">[PDF<sup id="pdf-stars-${id}@OpenReview">471</sup>]</a>
            </h2>
            <p id="authors-${id}@OpenReview" class="metainfo authors notranslate"><strong>Authors</strong>:
                <a class="author notranslate" href="https://www.google.com/search?q=A" target="_blank">Christopher Fifty</a>,
                <a class="author notranslate" href="https://www.google.com/search?q=B" target="_blank">Timothy O&#039;Donnell</a>
            </p>
            <p id="summary-${id}@OpenReview" class="summary notranslate">Vector   quantization is
              non-differentiable.</p>
            <p id="subjects-${id}@OpenReview" class="metainfo subjects"><strong>Subject</strong>:
                <a class="subject-1" href="/venue/ICLR.2025?group=Oral" target="_blank">${subject}</a>
            </p>
        </div>`

describe('parseCoolVenuePage', () => {
  it('parses paper panels into full cards and ignores subject links', () => {
    const html = `<h1>ICLR.2025</h1><p class="info">Total: 3758</p><div class="papers">${PAPER(
      'GMwRl2e9Y1',
      'Restructuring Vector Quantization',
      'ICLR.2025 - Oral'
    )}${PAPER('xoXn62FzD0', 'Syntactic and Semantic Control', 'ICLR.2025 - Poster')}</div>`
    const page = parseCoolVenuePage(html)
    expect(page.total).toBe(3758)
    expect(page.items).toHaveLength(2)
    expect(page.items[0]).toEqual({
      coolId: 'GMwRl2e9Y1@OpenReview',
      title: 'Restructuring Vector Quantization',
      authors: ['Christopher Fifty', "Timothy O'Donnell"],
      abstract: 'Vector quantization is non-differentiable.',
      pdfUrl: 'https://openreview.net/pdf?id=GMwRl2e9Y1',
      stars: 471,
      group: 'Oral',
      sourceUrl: 'https://openreview.net/forum?id=GMwRl2e9Y1'
    })
    expect(page.items[1].group).toBe('Poster')
  })

  it('returns an empty page for markup without panels', () => {
    expect(parseCoolVenuePage('<html></html>')).toEqual({ total: 0, items: [] })
  })
})

describe('parseCoolVenueCatalog', () => {
  it('groups tracks under their edition and skips year-less ids', () => {
    const html = `
      <a href="/venue/ICLR.2026" target="_blank"><strong>ICLR.2026</strong></a>
      <a href="/venue/ICLR.2026?group=Oral">ICLR.2026 - Oral</a>
      <a href="/venue/ICLR.2026?group=Poster">ICLR.2026 - Poster</a>
      <a href="/venue/AAAI.2017?group=What&#039;s Hot Abstracts">x</a>
      <a href="/venue/search?query=x">search</a>
      <a href="/venue/USENIX-Sec.2025">USENIX-Sec.2025</a>`
    expect(parseCoolVenueCatalog(html)).toEqual([
      { id: 'ICLR.2026', series: 'ICLR', year: '2026', groups: ['Oral', 'Poster'] },
      { id: 'AAAI.2017', series: 'AAAI', year: '2017', groups: ["What's Hot Abstracts"] },
      { id: 'USENIX-Sec.2025', series: 'USENIX-Sec', year: '2025', groups: [] }
    ])
  })
})
