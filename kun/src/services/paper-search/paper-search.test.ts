import { describe, expect, it } from 'vitest'
import {
  formatPaperSearchForModel,
  mergePaperSearchResults,
  normalizePaperSearchSources,
  runPaperSearch
} from './paper-search.js'
import { arxivSearchQuery, openAlexAbstract, parseArxivAtom } from './paper-search-api-sources.js'
import { parseCoolSearchPage } from './paper-search-cool-sources.js'
import { normalizeArxivId, normalizeDoi } from './paper-search-text.js'

const ATOM = `<feed><entry>
  <id>http://arxiv.org/abs/2406.01422v2</id>
  <published>2024-06-03T15:20:06Z</published>
  <title>Alibaba LingmaAgent:
    Improving Issue Resolution</title>
  <summary>We present &amp; evaluate.</summary>
  <author><name>Yingwei Ma</name></author>
  <author><name>Qingping Yang</name></author>
  <arxiv:doi>10.1145/3696630.3728549</arxiv:doi>
  <link href="https://arxiv.org/pdf/2406.01422v2" rel="related" type="application/pdf" title="pdf"/>
</entry></feed>`

const COOL_VENUE = `<div class="papers">
  <div id="TXcifVbFpG@OpenReview" class="panel paper" keywords="x">
    <h2 class="title">
      <a href="https://openreview.net/forum?id=TXcifVbFpG" target="_blank"><span>#1</span></a>
      <a id="title-TXcifVbFpG@OpenReview" class="title-link notranslate" href="/venue/TXcifVbFpG@OpenReview">RepoAudit</a>
      <a id="pdf-TXcifVbFpG@OpenReview" class="title-pdf notranslate" onclick="togglePdf('x', this)" data="https://openreview.net/pdf?id=TXcifVbFpG">[PDF]</a>
    </h2>
    <p class="metainfo authors notranslate"><a class="author notranslate" href="#">Jinyao Guo</a></p>
    <p id="summary-TXcifVbFpG@OpenReview" class="summary notranslate">Code auditing.</p>
    <p class="metainfo subjects"><a class="subject-1" href="/venue/ICML.2025?group=Poster">ICML.2025 - Poster</a></p>
  </div>
</div>`

describe('paper search parsing', () => {
  it('parses arXiv Atom entries', () => {
    expect(parseArxivAtom(ATOM)).toEqual([{
      title: 'Alibaba LingmaAgent: Improving Issue Resolution',
      authors: ['Yingwei Ma', 'Qingping Yang'],
      abstract: 'We present & evaluate.',
      year: 2024,
      venue: undefined,
      doi: '10.1145/3696630.3728549',
      arxivId: '2406.01422',
      url: 'https://arxiv.org/abs/2406.01422',
      pdfUrl: 'https://arxiv.org/pdf/2406.01422v2'
    }])
  })

  it('builds an AND query, keeps phrases first and drops boolean operators', () => {
    expect(arxivSearchQuery('code agent AND "issue resolution"')).toBe('all:"issue resolution" AND all:code AND all:agent')
  })

  it('rebuilds OpenAlex abstracts from the inverted index', () => {
    expect(openAlexAbstract({ agents: [1], Code: [0], work: [2] })).toBe('Code agents work')
    expect(openAlexAbstract(null)).toBeUndefined()
  })

  it('parses papers.cool venue search cards', () => {
    expect(parseCoolSearchPage('venue', COOL_VENUE)).toEqual([{
      title: 'RepoAudit',
      authors: ['Jinyao Guo'],
      abstract: 'Code auditing.',
      year: 2025,
      venue: 'ICML.2025 - Poster',
      coolId: 'TXcifVbFpG@OpenReview',
      url: 'https://openreview.net/forum?id=TXcifVbFpG',
      pdfUrl: 'https://openreview.net/pdf?id=TXcifVbFpG'
    }])
  })

  it('normalizes ids', () => {
    expect(normalizeDoi('https://doi.org/10.1145/ABC.12.')).toBe('10.1145/abc.12')
    expect(normalizeArxivId('https://arxiv.org/pdf/2401.12345v3')).toBe('2401.12345')
    expect(normalizeArxivId('hep-th/9901001v1')).toBe('hep-th/9901001')
  })
})

describe('mergePaperSearchResults', () => {
  it('collapses duplicates across ids and titles and rewards consensus', () => {
    const merged = mergePaperSearchResults([
      {
        source: 'arxiv',
        hits: [
          { title: 'Solo Paper', authors: ['A'] },
          { title: 'Shared Paper', authors: ['B'], arxivId: '2401.00001', abstract: 'short' }
        ]
      },
      {
        source: 'openalex',
        hits: [{ title: 'Shared paper!', authors: [], doi: '10.1/x', abstract: 'a longer abstract', citations: 7 }]
      },
      {
        source: 'semantic_scholar',
        hits: [{ title: 'Other title', authors: [], doi: '10.1/x', citations: 9 }]
      }
    ])
    expect(merged.map((hit) => hit.title)).toEqual(['Shared Paper', 'Solo Paper'])
    expect(merged[0]).toMatchObject({
      key: 'doi:10.1/x',
      arxivId: '2401.00001',
      abstract: 'a longer abstract',
      citations: 9,
      sources: ['arxiv', 'openalex', 'semantic_scholar']
    })
  })
})

describe('runPaperSearch', () => {
  it('reports per-source failures without failing the search', async () => {
    const fetchImpl = async (url: string): Promise<Response> => {
      if (url.includes('openalex')) {
        return new Response(JSON.stringify({ results: [{ display_name: 'OA Paper', publication_year: 2023 }] }))
      }
      return new Response('nope', { status: 503 })
    }
    const result = await runPaperSearch(
      { query: ' agents ', sources: ['openalex', 'crossref'], limit: 99 },
      { fetch: fetchImpl }
    )
    expect(result.query).toBe('agents')
    expect(result.hits.map((hit) => hit.title)).toEqual(['OA Paper'])
    expect(result.sources.map((report) => [report.source, report.count, report.error])).toEqual([
      ['openalex', 1, undefined],
      ['crossref', 0, 'HTTP 503']
    ])
    expect(formatPaperSearchForModel(result)).toContain('Crossref failed (HTTP 503)')
  })

  it('retries a rate-limited source once', async () => {
    let calls = 0
    const fetchImpl = async (): Promise<Response> => {
      calls += 1
      return calls === 1
        ? new Response('', { status: 429 })
        : new Response(JSON.stringify({ data: [{ title: 'S2 Paper', authors: [] }] }))
    }
    const result = await runPaperSearch(
      { query: 'x', sources: ['semantic_scholar'] },
      { fetch: fetchImpl, sleep: async () => undefined }
    )
    expect(calls).toBe(2)
    expect(result.hits[0]?.title).toBe('S2 Paper')
  })

  it('falls back to the default sources', () => {
    expect(normalizePaperSearchSources(['bogus'])).toEqual(['arxiv', 'openalex', 'semantic_scholar', 'venues'])
  })
})
