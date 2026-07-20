/**
 * [INPUT]: 依赖 WebProvider 端口、fetch 和用户配置的 SearXNG JSON endpoint
 * [OUTPUT]: 对外提供 SearxngWebSearchProvider，把自建 SearXNG 结果归一为 WebSearchResult
 * [POS]: research/runtime 的开源可配置搜索入口，配置 SEARXNG_BASE_URL 时优先于公共 HTML 搜索
 * [PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
 */
import type { WebProvider, WebSearchRequest, WebSearchResult } from '../../ports/web-provider.js'
import { sourceIdFor } from '../../ports/web-provider.js'

type SearxngWebSearchProviderOptions = {
  baseUrl: string
  fetchImpl?: typeof fetch
  nowIso?: () => string
}

type SearxngResult = {
  url?: unknown
  title?: unknown
  content?: unknown
}

export class SearxngWebSearchProvider implements WebProvider {
  readonly id = 'searxng-search'
  private readonly fetchImpl: typeof fetch
  private readonly nowIso: () => string

  constructor(private readonly options: SearxngWebSearchProviderOptions) {
    this.fetchImpl = options.fetchImpl ?? fetch
    this.nowIso = options.nowIso ?? (() => new Date().toISOString())
  }

  async search(request: WebSearchRequest): Promise<WebSearchResult[]> {
    const query = request.query.trim()
    if (!query) return []
    const controller = new AbortController()
    const timeout = setTimeout(() => controller.abort(), request.timeoutMs)
    const onAbort = () => controller.abort()
    request.signal.addEventListener('abort', onAbort, { once: true })
    try {
      const url = new URL('/search', ensureAbsoluteBaseUrl(this.options.baseUrl))
      url.searchParams.set('q', query)
      url.searchParams.set('format', 'json')
      url.searchParams.set('categories', 'general')
      url.searchParams.set('language', /[\u4e00-\u9fff]/u.test(query) ? 'zh-CN' : 'en-US')
      const response = await this.fetchImpl(url.toString(), {
        signal: controller.signal,
        headers: { accept: 'application/json' }
      })
      const text = await response.text()
      if (!response.ok) throw new Error(`SearXNG search HTTP ${response.status}: ${text.slice(0, 180)}`)
      return parseSearxngResults(text)
        .slice(0, request.limit)
        .map((result, index) => ({
          sourceId: sourceIdFor('search', `${query}:${result.url}:${index}`),
          url: result.url,
          ...(result.title ? { title: result.title } : {}),
          snippet: result.content || result.title || result.url,
          retrievedAt: this.nowIso(),
          provider: this.id,
          rank: index + 1
        }))
    } finally {
      clearTimeout(timeout)
      request.signal.removeEventListener('abort', onAbort)
    }
  }
}

function parseSearxngResults(text: string): Array<{ url: string; title?: string; content?: string }> {
  let payload: { results?: unknown }
  try {
    payload = JSON.parse(text) as { results?: unknown }
  } catch {
    throw new Error('SearXNG search returned invalid JSON')
  }
  if (!Array.isArray(payload.results)) return []
  return (payload.results as SearxngResult[]).flatMap((result) => {
    const url = stringValue(result.url)
    if (!/^https?:\/\//iu.test(url)) return []
    const title = stringValue(result.title)
    const content = stringValue(result.content)
    return [{ url, ...(title ? { title } : {}), ...(content ? { content } : {}) }]
  })
}

function ensureAbsoluteBaseUrl(value: string): string {
  const normalized = value.trim().replace(/\/+$/u, '')
  if (!/^https?:\/\//iu.test(normalized)) throw new Error('SEARXNG_BASE_URL must be an absolute HTTP(S) URL')
  return normalized
}

function stringValue(value: unknown): string {
  return typeof value === 'string' ? value.trim() : ''
}
