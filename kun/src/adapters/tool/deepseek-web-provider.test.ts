import { describe, expect, it, vi } from 'vitest'
import { KunCapabilitiesConfig } from '../../contracts/capabilities.js'
import type { WebProvider } from '../../ports/web-provider.js'
import type { KunServeRuntimeOptions } from '../../server/runtime-factory-types.js'
import { DeepSeekWebProvider, resolveDeepSeekToolsEndpointUrl } from './deepseek-web-provider.js'
import { buildWebToolProviders } from './web-tool-provider.js'

describe('DeepSeekWebProvider', () => {
  it.each(['v1/chat/completions', 'chat/completions', 'beta/chat/completions', 'anthropic'])('resolves official tools independently of model path %s', (path) => {
    for (const tool of ['search', 'fetch'] as const) {
      expect(resolveDeepSeekToolsEndpointUrl(`https://api.deepseek.com/${path}`, tool))
        .toBe(`https://api.deepseek.com/v1/tools/${tool}`)
    }
  })

  it('preserves custom relay prefixes and URL queries', () => {
    expect(resolveDeepSeekToolsEndpointUrl('https://relay.test/deepseek/v1?deployment=x', 'search'))
      .toBe('https://relay.test/deepseek/v1/tools/search?deployment=x')
  })
  it('normalizes root, /v1, and /beta base URLs for /v1/tools endpoints', () => {
    expect(resolveDeepSeekToolsEndpointUrl('https://api.deepseek.com', 'search')).toBe(
      'https://api.deepseek.com/v1/tools/search'
    )
    expect(resolveDeepSeekToolsEndpointUrl('https://api.deepseek.com/', 'fetch')).toBe(
      'https://api.deepseek.com/v1/tools/fetch'
    )
    expect(resolveDeepSeekToolsEndpointUrl('https://api.deepseek.com/v1/', 'search')).toBe(
      'https://api.deepseek.com/v1/tools/search'
    )
    expect(resolveDeepSeekToolsEndpointUrl('https://api.deepseek.com/beta', 'fetch')).toBe(
      'https://api.deepseek.com/v1/tools/fetch'
    )
  })

  it('calls /v1/tools/search and maps search results', async () => {
    const calls: Array<{ url: string; init: RequestInit }> = []
    const fetchImpl = (async (url: RequestInfo | URL, init?: RequestInit) => {
      calls.push({ url: String(url), init: init ?? {} })
      return Response.json({
        results: [
          {
            title: 'DeepSeek Docs',
            url: 'https://api-docs.deepseek.com/zh-cn/quick_start/pricing',
            snippet: 'DeepSeek pricing and tools'
          },
          {
            title: 'Fallback Summary',
            url: 'https://example.test/page',
            summary: 'Summary field text'
          }
        ]
      })
    }) as typeof fetch

    const provider = new DeepSeekWebProvider({
      resolveAuth: async () => ({
        baseUrl: 'https://api.deepseek.com/v1',
        apiKey: 'sk-ds'
      }),
      nowIso: () => '2026-11-14T12:00:00.000Z',
      fetchImpl
    })

    const results = await provider.search({
      query: 'deepseek pricing',
      limit: 5,
      timeoutMs: 5_000,
      signal: new AbortController().signal
    })

    expect(calls).toHaveLength(1)
    expect(calls[0].url).toBe('https://api.deepseek.com/v1/tools/search')
    expect((calls[0].init.headers as Record<string, string>).authorization).toBe('Bearer sk-ds')
    expect(JSON.parse(String(calls[0].init.body))).toEqual({
      query: 'deepseek pricing',
      count: 5,
      need_content: false
    })
    expect(results).toHaveLength(2)
    expect(results[0]).toMatchObject({
      title: 'DeepSeek Docs',
      url: 'https://api-docs.deepseek.com/zh-cn/quick_start/pricing',
      snippet: 'DeepSeek pricing and tools',
      provider: 'deepseek',
      rank: 1,
      retrievedAt: '2026-11-14T12:00:00.000Z'
    })
    expect(results[1]).toMatchObject({
      snippet: 'Summary field text',
      rank: 2
    })
  })

  it('calls /v1/tools/fetch, truncates to maxBytes, and falls back to FetchWebProvider on failure', async () => {
    const fallbackFetch: WebProvider = {
      id: 'fetch',
      fetch: vi.fn(async (req) => ({
        sourceId: 'fallback-src',
        url: req.url,
        finalUrl: req.url,
        contentType: 'text/plain',
        text: 'fallback content',
        retrievedAt: '2026-11-14T12:00:00.000Z',
        byteCount: 16,
        truncated: false
      }))
    }
    const fetchImpl = vi.fn(async () => Response.json({
      final_url: 'https://example.test/final',
      title: 'Page Title',
      markdown: '0123456789ABCDEF'
    })) as unknown as typeof fetch

    const provider = new DeepSeekWebProvider({
      resolveAuth: async () => ({
        baseUrl: 'https://api.deepseek.com',
        apiKey: 'sk-ds'
      }),
      fallbackFetch,
      nowIso: () => '2026-11-14T12:00:00.000Z',
      fetchImpl
    })

    const fetched = await provider.fetch({
      url: 'https://example.test/start',
      maxBytes: 10,
      timeoutMs: 5_000,
      signal: new AbortController().signal
    })
    expect(fetched).toMatchObject({
      url: 'https://example.test/start',
      finalUrl: 'https://example.test/final',
      title: 'Page Title',
      contentType: 'text/markdown',
      text: '0123456789',
      byteCount: 10,
      truncated: true
    })

    const failingFetchImpl = vi.fn(async () => new Response('upstream error', { status: 502 })) as unknown as typeof fetch
    const failingProvider = new DeepSeekWebProvider({
      resolveAuth: async () => ({
        baseUrl: 'https://api.deepseek.com',
        apiKey: 'sk-ds'
      }),
      fallbackFetch,
      fetchImpl: failingFetchImpl
    })
    const fallbackResult = await failingProvider.fetch({
      url: 'https://example.test/start',
      maxBytes: 1024,
      timeoutMs: 5_000,
      signal: new AbortController().signal
    })
    expect(fallbackResult.text).toBe('fallback content')
    expect(fallbackFetch.fetch).toHaveBeenCalledTimes(1)
  })

  it('wires DeepSeekWebProvider into buildWebToolProviders when DeepSeek provider is configured', () => {
    const config = KunCapabilitiesConfig.parse({
      web: { enabled: true, fetchEnabled: true, searchEnabled: true }
    }).web
    const runtimeOptions = {
      activeProviderId: 'deepseek',
      providers: {
        deepseek: {
          kind: 'http',
          baseUrl: 'https://api.deepseek.com',
          apiKey: '',
          credentialSourceId: 'provider-deepseek'
        }
      }
    } as unknown as KunServeRuntimeOptions

    const built = buildWebToolProviders(config, {
      runtimeOptions: () => runtimeOptions,
      resolveCredential: async () => ({ apiKey: 'sk-vault' })
    })
    expect(built.provider).toBe('deepseek')
    expect(built.fetchAvailable).toBe(true)
    expect(built.searchAvailable).toBe(true)
    expect(built.providers[0].tools.map((tool) => tool.name)).toEqual(['web_fetch', 'web_search'])

    const fallbackOnly = buildWebToolProviders(config, {
      runtimeOptions: () => ({
        activeProviderId: 'openai',
        providers: {
          openai: {
            kind: 'http',
            baseUrl: 'https://api.openai.com/v1',
            apiKey: 'sk-oai'
          }
        }
      } as unknown as KunServeRuntimeOptions)
    })
    expect(fallbackOnly.provider).toBe('fetch')
    expect(fallbackOnly.fetchAvailable).toBe(true)
    expect(fallbackOnly.searchAvailable).toBe(false)
    expect(fallbackOnly.providers[0].tools.map((tool) => tool.name)).toEqual(['web_fetch'])
  })
})
