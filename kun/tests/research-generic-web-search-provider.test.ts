import { describe, expect, it } from 'vitest'
import {
  BraveWebSearchProvider,
  BingRssWebSearchProvider,
  CascadingWebSearchProvider,
  GenericWebSearchProvider,
  parseBraveHtmlSearchResults,
  parseBingRssSearchResults,
  parseDuckDuckGoHtmlSearchResults,
  parseYahooHtmlSearchResults,
  SearxngWebSearchProvider,
  TavilyWebSearchProvider
} from '../src/research/index.js'
import type { WebProvider } from '../src/ports/web-provider.js'

describe('GenericWebSearchProvider', () => {
  it('parses DuckDuckGo HTML result links and snippets', () => {
    const html = [
      '<html><body>',
      '<div class="result">',
      '<a class="result__a" href="//duckduckgo.com/l/?uddg=https%3A%2F%2Fexample.com%2Fpricing%3Fa%3D1%26b%3D2">Cursor &amp; Pricing</a>',
      '<a class="result__snippet">Official pricing page &amp; plan details.</a>',
      '</div>',
      '<div class="result">',
      '<a class="result__a" href="https://example.org/blog">Ignored duplicate title</a>',
      '<div class="result__snippet">Independent analysis.</div>',
      '</div>',
      '</body></html>'
    ].join('')

    const results = parseDuckDuckGoHtmlSearchResults(html)

    expect(results).toEqual([
      {
        url: 'https://example.com/pricing?a=1&b=2',
        title: 'Cursor & Pricing',
        snippet: 'Official pricing page & plan details.'
      },
      {
        url: 'https://example.org/blog',
        title: 'Ignored duplicate title',
        snippet: 'Independent analysis.'
      }
    ])
  })

  it('searches through the default HTML provider contract', async () => {
    let fetchCount = 0
    const provider = new GenericWebSearchProvider({
      nowIso: () => '2026-07-08T00:00:00.000Z',
      minIntervalMs: 0,
      fetchImpl: async () => {
        fetchCount += 1
        return new Response([
          '<a class="result__a" href="//duckduckgo.com/l/?uddg=https%3A%2F%2Fexample.com%2Fofficial">Official Source</a>',
          '<div class="result__snippet">Primary source snippet.</div>'
        ].join(''), { status: 200 })
      }
    })

    const results = await provider.search({
      query: 'Cursor pricing official',
      limit: 5,
      timeoutMs: 1_000,
      signal: new AbortController().signal
    })

    expect(results).toHaveLength(1)
    expect(results[0]).toMatchObject({
      url: 'https://example.com/official',
      title: 'Official Source',
      snippet: 'Primary source snippet.',
      provider: 'duckduckgo-html-search',
      rank: 1,
      retrievedAt: '2026-07-08T00:00:00.000Z'
    })
    expect(results[0]?.sourceId).toMatch(/^web_search_/)
    await provider.search({
      query: 'Cursor pricing official',
      limit: 1,
      timeoutMs: 1_000,
      signal: new AbortController().signal
    })
    expect(fetchCount).toBe(1)
  })

  it('retries one throttled empty HTML response before giving up', async () => {
    let fetchCount = 0
    const provider = new GenericWebSearchProvider({
      minIntervalMs: 0,
      emptyRetryMs: 1,
      fetchImpl: async () => {
        fetchCount += 1
        if (fetchCount === 1) return new Response('<html><body></body></html>', { status: 200 })
        return new Response([
          '<a class="result__a" href="https://example.com/recovered">Recovered Source</a>',
          '<div class="result__snippet">Recovered after an empty response.</div>'
        ].join(''), { status: 200 })
      }
    })

    const results = await provider.search({
      query: 'recovered query',
      limit: 5,
      timeoutMs: 1_000,
      signal: new AbortController().signal
    })

    expect(fetchCount).toBe(2)
    expect(results[0]?.url).toBe('https://example.com/recovered')
  })
})

describe('BingRssWebSearchProvider', () => {
  const rss = [
    '<?xml version="1.0" encoding="utf-8"?>',
    '<rss><channel>',
    '<item><title>Official &amp; audited results</title><link>https://example.com/results.pdf</link><description>Audited &lt;b&gt;results&lt;/b&gt; for 2025.</description></item>',
    '<item><title>Investor relations</title><link>https://example.com/investors</link><description>Reports and announcements.</description></item>',
    '</channel></rss>'
  ].join('')

  it('parses RSS items and XML entities', () => {
    expect(parseBingRssSearchResults(rss)).toEqual([{
      url: 'https://example.com/results.pdf',
      title: 'Official & audited results',
      snippet: 'Audited results for 2025.'
    }, {
      url: 'https://example.com/investors',
      title: 'Investor relations',
      snippet: 'Reports and announcements.'
    }])
  })

  it('searches the localized Bing RSS endpoint without an API key', async () => {
    let fetchCount = 0
    const provider = new BingRssWebSearchProvider({
      nowIso: () => '2026-07-16T00:00:00.000Z',
      minIntervalMs: 0,
      fetchImpl: async (input) => {
        fetchCount += 1
        const url = new URL(String(input))
        expect(url.searchParams.get('format')).toBe('rss')
        expect(url.searchParams.get('mkt')).toBe('en-US')
        return new Response(rss, { status: 200, headers: { 'content-type': 'application/rss+xml' } })
      }
    })

    const results = await provider.search({
      query: 'official annual results', limit: 5, timeoutMs: 1_000,
      signal: new AbortController().signal
    })
    expect(results[0]).toMatchObject({
      url: 'https://example.com/results.pdf', provider: 'bing-rss-search', rank: 1,
      retrievedAt: '2026-07-16T00:00:00.000Z'
    })
    await provider.search({
      query: 'official annual results', limit: 1, timeoutMs: 1_000,
      signal: new AbortController().signal
    })
    expect(fetchCount).toBe(1)
  })
})

describe('BraveWebSearchProvider', () => {
  const html = [
    '<html><body>',
    '<div class="snippet result" data-type="web">',
    '<a href="https://www.ittf.com/2024/paris-results">',
    '<div class="title search-snippet-title" title="Paris 2024 table tennis results">Paris 2024 table tennis results</div>',
    '</a>',
    '<div class="generic-snippet"><div class="content">China won the Olympic team title.</div></div>',
    '</div>',
    '<div class="snippet result" data-type="web">',
    '<a href="https://olympics.com/table-tennis"><div class="search-snippet-title">Olympic table tennis</div></a>',
    '<div class="generic-snippet">Official results and medal records.</div>',
    '</div>',
    '</body></html>'
  ].join('')

  it('parses structured Brave web result cards', () => {
    expect(parseBraveHtmlSearchResults(html)).toEqual([{
      url: 'https://www.ittf.com/2024/paris-results',
      title: 'Paris 2024 table tennis results',
      snippet: 'China won the Olympic team title.'
    }, {
      url: 'https://olympics.com/table-tennis',
      title: 'Olympic table tennis',
      snippet: 'Official results and medal records.'
    }])
  })

  it('searches Brave without an API key', async () => {
    let fetchCount = 0
    const provider = new BraveWebSearchProvider({
      nowIso: () => '2026-07-11T00:00:00.000Z',
      minIntervalMs: 0,
      fetchImpl: async (input) => {
        fetchCount += 1
        expect(String(input)).toContain('search.brave.com/search')
        expect(String(input)).toContain('source=web')
        return new Response(html, { status: 200, headers: { 'content-type': 'text/html' } })
      }
    })

    const results = await provider.search({
      query: 'China table tennis Paris 2024',
      limit: 5,
      timeoutMs: 1_000,
      signal: new AbortController().signal
    })

    expect(results).toHaveLength(2)
    expect(results[0]).toMatchObject({ provider: 'brave-html-search', rank: 1 })

    const cached = await provider.search({
      query: 'China table tennis Paris 2024',
      limit: 1,
      timeoutMs: 1_000,
      signal: new AbortController().signal
    })
    expect(cached).toHaveLength(1)
    expect(fetchCount).toBe(1)
  })
})

describe('YahooWebSearchProvider', () => {
  it('parses algorithm result cards and unwraps Yahoo redirect URLs', () => {
    const html = [
      '<ul>',
      '<li>',
      '<a data-matarget="algo" href="https://r.search.yahoo.com/x/RU=https%3A%2F%2Fwww.frontiersin.org%2Farticle%2Ffull/RK=2/RS=x">',
      '<h3><span>Frontiers tactical study</span></h3>',
      '</a>',
      '<p>Peer-reviewed table tennis analysis.</p>',
      '</li>',
      '</ul>'
    ].join('')

    expect(parseYahooHtmlSearchResults(html)).toEqual([{
      url: 'https://www.frontiersin.org/article/full',
      title: 'Frontiers tactical study',
      snippet: 'Peer-reviewed table tennis analysis.'
    }])
  })
})

describe('SearxngWebSearchProvider', () => {
  it('maps a self-hosted SearXNG JSON response', async () => {
    const provider = new SearxngWebSearchProvider({
      baseUrl: 'http://127.0.0.1:8080/',
      nowIso: () => '2026-07-11T00:00:00.000Z',
      fetchImpl: async (input) => {
        const url = new URL(String(input))
        expect(url.pathname).toBe('/search')
        expect(url.searchParams.get('format')).toBe('json')
        return new Response(JSON.stringify({
          results: [{
            url: 'https://www.ittf.com/rankings/',
            title: 'ITTF rankings',
            content: 'Official world rankings.'
          }]
        }), { status: 200, headers: { 'content-type': 'application/json' } })
      }
    })

    const results = await provider.search({
      query: '乒乓球世界排名',
      limit: 3,
      timeoutMs: 1_000,
      signal: new AbortController().signal
    })

    expect(results[0]).toMatchObject({
      url: 'https://www.ittf.com/rankings/',
      provider: 'searxng-search',
      snippet: 'Official world rankings.'
    })
  })
})

describe('production research search providers', () => {
  it('maps Tavily basic search results without requesting generated answers or raw content', async () => {
    let requestBody: Record<string, unknown> | undefined
    const provider = new TavilyWebSearchProvider({
      apiKey: 'tvly-test',
      nowIso: () => '2026-07-10T00:00:00.000Z',
      fetchImpl: async (_input, init) => {
        requestBody = JSON.parse(String(init?.body)) as Record<string, unknown>
        return new Response(JSON.stringify({
          results: [{
            title: 'AI Risk Management Framework | NIST',
            url: 'https://www.nist.gov/itl/ai-risk-management-framework',
            content: 'Official NIST framework page.'
          }]
        }), { status: 200, headers: { 'content-type': 'application/json' } })
      }
    })

    const results = await provider.search({
      query: 'NIST AI RMF official',
      limit: 3,
      timeoutMs: 1_000,
      signal: new AbortController().signal
    })

    expect(requestBody).toMatchObject({
      query: 'NIST AI RMF official',
      search_depth: 'basic',
      include_answer: false,
      include_raw_content: false,
      max_results: 3
    })
    expect(results[0]).toMatchObject({
      url: 'https://www.nist.gov/itl/ai-risk-management-framework',
      provider: 'tavily-search',
      rank: 1
    })
  })

  it('falls through to the next search provider after an error', async () => {
    const failing: WebProvider = {
      id: 'failing-search',
      search: async () => {
        throw new Error('primary unavailable')
      }
    }
    const fallback: WebProvider = {
      id: 'fallback-search',
      search: async () => [{
        sourceId: 'source_1',
        url: 'https://example.com/fallback',
        snippet: 'fallback result',
        retrievedAt: '2026-07-10T00:00:00.000Z',
        provider: 'fallback-search',
        rank: 1
      }]
    }
    const provider = new CascadingWebSearchProvider([failing, fallback])

    const results = await provider.search({
      query: 'fallback query',
      limit: 3,
      timeoutMs: 1_000,
      signal: new AbortController().signal
    })

    expect(results[0]?.provider).toBe('fallback-search')
  })

  it('does not let one stalled free provider consume the whole cascade timeout', async () => {
    const stalled: WebProvider = {
      id: 'stalled-search',
      search: async (request) => new Promise((_resolve, reject) => {
        request.signal.addEventListener('abort', () => reject(new Error('stalled provider aborted')), { once: true })
      })
    }
    const fallback: WebProvider = {
      id: 'healthy-search',
      search: async () => [{
        sourceId: 'source_healthy',
        url: 'https://example.com/healthy',
        snippet: 'healthy result',
        retrievedAt: '2026-07-16T00:00:00.000Z',
        provider: 'healthy-search',
        rank: 1
      }]
    }
    const provider = new CascadingWebSearchProvider([stalled, fallback])

    const results = await provider.search({
      query: 'healthy fallback query',
      limit: 3,
      timeoutMs: 90,
      signal: new AbortController().signal
    })

    expect(results[0]?.provider).toBe('healthy-search')
  })
})
