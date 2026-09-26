import { describe, expect, it, vi } from 'vitest'
import { PaperSearchCache, paperSourceCacheKey } from './paper-search-cache.js'
import { PaperRateLimiter } from './paper-search-rate-limit.js'
import { mergePaperSearchResults, runPaperSearch } from './paper-search.js'
import type { PaperSourceHit } from './paper-search-types.js'

describe('PaperSearchCache (P2.3)', () => {
  it('round-trips values defensively', () => {
    let now = 1_000
    const cache = new PaperSearchCache<{ n: number }[]>({ now: () => now })
    const value = [{ n: 1 }]
    cache.set('k', value)
    value[0].n = 99
    const read = cache.get('k')!
    expect(read[0].n).toBe(1)
    read[0].n = 7
    expect(cache.get('k')![0].n).toBe(1)
  })

  it('expires entries past the TTL and evicts oldest beyond capacity', () => {
    let now = 0
    const cache = new PaperSearchCache<number>({ maxEntries: 2, ttlMs: 100, now: () => now })
    cache.set('a', 1)
    cache.set('b', 2)
    cache.set('c', 3) // over capacity: evicts 'a' (oldest)
    expect(cache.get('a')).toBeUndefined()
    expect(cache.get('b')).toBe(2)
    expect(cache.get('c')).toBe(3)
    now = 200 // every entry past TTL now
    expect(cache.get('b')).toBeUndefined()
  })

  it('keys on source + normalized query + years', () => {
    const q = { query: '  Code   Agent ', limit: 10, yearFrom: 2020, yearTo: undefined }
    expect(paperSourceCacheKey('openalex', q)).toBe('openalex|code agent|10|2020|')
    expect(paperSourceCacheKey('openalex', { ...q, yearTo: 2024 })).not.toBe(
      paperSourceCacheKey('openalex', q)
    )
  })
})

describe('PaperRateLimiter (P2.3)', () => {
  it('paces sequential requests per source', async () => {
    let now = 0
    const sleeps: number[] = []
    const limiter = new PaperRateLimiter({
      now: () => now,
      sleep: async (ms) => {
        sleeps.push(ms)
        now += ms
      }
    })
    await limiter.acquire('semantic_scholar')
    await limiter.acquire('semantic_scholar')
    expect(sleeps).toEqual([1000])
    // Different sources pace independently.
    await limiter.acquire('openalex')
    expect(sleeps).toEqual([1000])
  })

  it('lowers the Semantic Scholar interval with an API key', async () => {
    let now = 0
    const limiter = new PaperRateLimiter({
      now: () => now,
      sleep: async (ms) => {
        now += ms
      }
    })
    await limiter.acquire('semantic_scholar', { credentials: { semanticScholarApiKey: 'k' } })
    expect(now).toBe(0)
    await limiter.acquire('semantic_scholar', { credentials: { semanticScholarApiKey: 'k' } })
    expect(now).toBe(100)
  })

  it('degrades a source after consecutive 429s and recovers later', async () => {
    let now = 0
    const limiter = new PaperRateLimiter({
      now: () => now,
      sleep: async () => undefined,
      degradeThreshold: 2,
      degradeMs: 60_000
    })
    limiter.recordOutcome('crossref', Object.assign(new Error('429'), { status: 429 }))
    expect(limiter.isDegraded('crossref')).toBe(false)
    limiter.recordOutcome('crossref', Object.assign(new Error('429'), { status: 429 }))
    expect(limiter.isDegraded('crossref')).toBe(true)
    now += 61_000
    expect(limiter.isDegraded('crossref')).toBe(false)
  })

  it('resets the streak on a non-429 outcome', () => {
    const limiter = new PaperRateLimiter({ degradeThreshold: 2 })
    limiter.recordOutcome('hal', Object.assign(new Error('429'), { status: 429 }))
    limiter.recordOutcome('hal', Object.assign(new Error('boom'), { status: 500 }))
    limiter.recordOutcome('hal', Object.assign(new Error('429'), { status: 429 }))
    expect(limiter.isDegraded('hal')).toBe(false)
  })
})

describe('runPaperSearch cache + degradation (P2.3/P2.4)', () => {
  it('serves repeated identical queries from the cache', async () => {
    const fetchImpl = vi.fn(async () =>
      new Response(JSON.stringify({ results: [{ display_name: 'Cached', publication_year: 2024 }] }))
    )
    const cache = new PaperSearchCache<PaperSourceHit[]>()
    const request = { query: 'cache test', sources: ['openalex' as const], limit: 5 }
    const first = await runPaperSearch(request, { fetch: fetchImpl, cache, sleep: async () => undefined })
    const second = await runPaperSearch(request, { fetch: fetchImpl, cache, sleep: async () => undefined })
    expect(first.sources[0].cached).toBeUndefined()
    expect(second.sources[0].cached).toBe(true)
    expect(second.hits.map((hit) => hit.title)).toEqual(['Cached'])
    expect(fetchImpl).toHaveBeenCalledTimes(1)
  })

  it('auto-skips a degraded source and reports it', async () => {
    const rateLimiter = new PaperRateLimiter({ degradeThreshold: 1, sleep: async () => undefined })
    const fetchImpl = async () => new Response('limited', { status: 429 })
    const request = { query: 'x', sources: ['crossref' as const] }
    const first = await runPaperSearch(request, {
      fetch: fetchImpl,
      rateLimiter,
      sleep: async () => undefined
    })
    expect(first.sources[0].error).toContain('429')
    // Second run: degraded — connector is never called, report is explicit.
    const second = await runPaperSearch(request, {
      fetch: fetchImpl,
      rateLimiter,
      sleep: async () => undefined
    })
    expect(second.sources[0]).toMatchObject({ degraded: true })
    expect(second.sources[0].error).toContain('auto-skipped')
  })
})

describe('fuzzy merge (P2.4)', () => {
  it('merges a preprint and its published version by title+year', () => {
    const merged = mergePaperSearchResults([
      {
        source: 'arxiv',
        hits: [{ title: 'Scaling Test-Time Compute for Code Agents', authors: ['A'], arxivId: '2501.00001', year: 2025 }]
      },
      {
        source: 'openalex',
        hits: [{ title: 'Scaling test time compute for code agents', authors: ['A', 'B'], year: 2025, doi: '10.1/v', citations: 4 }]
      }
    ])
    expect(merged).toHaveLength(1)
    expect(merged[0]).toMatchObject({
      arxivId: '2501.00001',
      doi: '10.1/v',
      citations: 4,
      sources: ['arxiv', 'openalex']
    })
  })

  it('does not fuzzy-merge near-identical titles more than a year apart', () => {
    // 10 content tokens vs 11: Jaccard 10/11 ≈ 0.91 reaches the fuzzy
    // threshold, but the ±1 year guard rejects the merge.
    const base = 'Graph neural networks for program analysis in large open source software repositories'
    const merged = mergePaperSearchResults([
      { source: 'arxiv', hits: [{ title: base, authors: [], year: 2019 }] },
      { source: 'openalex', hits: [{ title: `${base} today`, authors: [], year: 2023 }] }
    ])
    expect(merged).toHaveLength(2)
    const sameYear = mergePaperSearchResults([
      { source: 'arxiv', hits: [{ title: base, authors: [], year: 2023 }] },
      { source: 'openalex', hits: [{ title: `${base} today`, authors: [], year: 2023 }] }
    ])
    expect(sameYear).toHaveLength(1)
  })
})
