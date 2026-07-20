/**
 * [INPUT]: 依赖 Tavily Search HTTP API、WebProvider 端口和 fetch
 * [OUTPUT]: 对外提供 TavilyWebSearchProvider，把 Tavily 搜索结果归一为 WebSearchResult
 * [POS]: research/runtime 的首选低成本搜索适配器；配置 TAVILY_API_KEY 时由 composition root 优先启用
 * [PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
 */
import type { WebProvider, WebSearchRequest, WebSearchResult } from '../../ports/web-provider.js'
import { sourceIdFor } from '../../ports/web-provider.js'

const DEFAULT_TAVILY_SEARCH_URL = 'https://api.tavily.com/search'

type TavilyWebSearchProviderOptions = {
  apiKey: string
  fetchImpl?: typeof fetch
  nowIso?: () => string
  searchUrl?: string
}

type TavilySearchResult = {
  title?: unknown
  url?: unknown
  content?: unknown
}

export class TavilyWebSearchProvider implements WebProvider {
  readonly id = 'tavily-search'
  private readonly fetchImpl: typeof fetch
  private readonly nowIso: () => string
  private readonly searchUrl: string

  constructor(private readonly options: TavilyWebSearchProviderOptions) {
    this.fetchImpl = options.fetchImpl ?? fetch
    this.nowIso = options.nowIso ?? (() => new Date().toISOString())
    this.searchUrl = options.searchUrl ?? DEFAULT_TAVILY_SEARCH_URL
  }

  async search(request: WebSearchRequest): Promise<WebSearchResult[]> {
    const apiKey = this.options.apiKey.trim()
    if (!apiKey) throw new Error('Tavily API key is required for web search')
    const controller = new AbortController()
    const timeout = setTimeout(() => controller.abort(), request.timeoutMs)
    const onAbort = () => controller.abort()
    request.signal.addEventListener('abort', onAbort, { once: true })
    try {
      const response = await this.fetchImpl(this.searchUrl, {
        method: 'POST',
        signal: controller.signal,
        headers: {
          authorization: `Bearer ${apiKey}`,
          'content-type': 'application/json'
        },
        body: JSON.stringify({
          query: request.query,
          search_depth: 'basic',
          topic: 'general',
          include_answer: false,
          include_raw_content: false,
          max_results: request.limit
        })
      })
      const text = await response.text()
      if (!response.ok) {
        throw new Error(`Tavily search HTTP ${response.status}: ${text.slice(0, 240)}`)
      }
      const payload = parseTavilyResponse(text)
      return payload
        .filter((result) => /^https?:\/\//i.test(stringValue(result.url)))
        .slice(0, request.limit)
        .map((result, index) => {
          const url = stringValue(result.url)
          const title = stringValue(result.title)
          const content = stringValue(result.content)
          return {
            sourceId: sourceIdFor('search', `${request.query}:${url}:${index}`),
            url,
            ...(title ? { title } : {}),
            snippet: content || title || url,
            retrievedAt: this.nowIso(),
            provider: this.id,
            rank: index + 1
          }
        })
    } finally {
      clearTimeout(timeout)
      request.signal.removeEventListener('abort', onAbort)
    }
  }
}

function parseTavilyResponse(text: string): TavilySearchResult[] {
  try {
    const payload = JSON.parse(text) as { results?: unknown }
    return Array.isArray(payload.results) ? payload.results as TavilySearchResult[] : []
  } catch {
    throw new Error('Tavily search returned invalid JSON')
  }
}

function stringValue(value: unknown): string {
  return typeof value === 'string' ? value.trim() : ''
}
