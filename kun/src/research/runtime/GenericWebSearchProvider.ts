/**
 * [INPUT]: 依赖 WebProvider 端口、fetch 和 DuckDuckGo HTML 搜索结果页
 * [OUTPUT]: 对外提供带串行限速、缓存和单次空响应重试的 GenericWebSearchProvider 与 parseDuckDuckGoHtmlSearchResults
 * [POS]: research/runtime 的默认免费真实网页搜索适配器；当模型 provider 没有原生 web_search 时给 DeepResearch 提供 search capability
 * [PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
 */
import type { WebProvider, WebSearchRequest, WebSearchResult } from '../../ports/web-provider.js'
import { sourceIdFor } from '../../ports/web-provider.js'

const DUCKDUCKGO_HTML_SEARCH_URL = 'https://duckduckgo.com/html/'
const DEFAULT_USER_AGENT = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 Chrome/124 Safari/537.36'

type GenericWebSearchProviderOptions = {
  fetchImpl?: typeof fetch
  nowIso?: () => string
  searchUrl?: string
  userAgent?: string
  minIntervalMs?: number
  cacheTtlMs?: number
  emptyRetryMs?: number
}

type SearchResultCandidate = {
  url: string
  title?: string
  snippet?: string
}

export class GenericWebSearchProvider implements WebProvider {
  readonly id = 'duckduckgo-html-search'
  private readonly fetchImpl: typeof fetch
  private readonly nowIso: () => string
  private readonly searchUrl: string
  private readonly userAgent: string
  private readonly minIntervalMs: number
  private readonly cacheTtlMs: number
  private readonly emptyRetryMs: number
  private readonly cache = new Map<string, { expiresAt: number; results: SearchResultCandidate[] }>()
  private queue: Promise<void> = Promise.resolve()
  private lastRequestAt = 0

  constructor(options: GenericWebSearchProviderOptions = {}) {
    this.fetchImpl = options.fetchImpl ?? fetch
    this.nowIso = options.nowIso ?? (() => new Date().toISOString())
    this.searchUrl = options.searchUrl ?? DUCKDUCKGO_HTML_SEARCH_URL
    this.userAgent = options.userAgent ?? DEFAULT_USER_AGENT
    this.minIntervalMs = Math.max(0, options.minIntervalMs ?? 1_200)
    this.cacheTtlMs = Math.max(1_000, options.cacheTtlMs ?? 10 * 60_000)
    this.emptyRetryMs = Math.max(0, options.emptyRetryMs ?? 1_500)
  }

  async search(request: WebSearchRequest): Promise<WebSearchResult[]> {
    const query = request.query.trim()
    if (!query) return []
    const cached = this.cachedResults(query)
    if (cached) return this.toSearchResults(query, cached, request.limit)
    const results = await this.enqueueSearch(query, request)
    return this.toSearchResults(query, results, request.limit)
  }

  private async enqueueSearch(query: string, request: WebSearchRequest): Promise<SearchResultCandidate[]> {
    let release: () => void = () => undefined
    const previous = this.queue
    this.queue = new Promise<void>((resolve) => { release = resolve })
    try {
      await waitForQueuedSearch(previous, request.signal)
      const cached = this.cachedResults(query)
      if (cached) return cached
      const waitMs = Math.max(0, this.lastRequestAt + this.minIntervalMs - Date.now())
      if (waitMs > 0) await waitForSearchSlot(waitMs, request.signal)
      this.lastRequestAt = Date.now()
      let results = await this.fetchSearchResults(query, request)
      if (results.length === 0 && this.emptyRetryMs > 0) {
        await waitForSearchSlot(this.emptyRetryMs, request.signal)
        this.lastRequestAt = Date.now()
        results = await this.fetchSearchResults(query, request)
      }
      if (results.length > 0) {
        this.cache.set(query, { expiresAt: Date.now() + this.cacheTtlMs, results })
      }
      return results
    } finally {
      release()
    }
  }

  private async fetchSearchResults(query: string, request: WebSearchRequest): Promise<SearchResultCandidate[]> {
    const controller = new AbortController()
    const timeout = setTimeout(() => controller.abort(), request.timeoutMs)
    const onAbort = () => controller.abort()
    request.signal.addEventListener('abort', onAbort, { once: true })
    try {
      const url = new URL(this.searchUrl)
      url.searchParams.set('q', query)
      url.searchParams.set('kl', 'us-en')
      const response = await this.fetchImpl(url.toString(), {
        method: 'GET',
        signal: controller.signal,
        headers: {
          accept: 'text/html,application/xhtml+xml',
          'user-agent': this.userAgent
        }
      })
      const text = await response.text()
      if (!response.ok) {
        throw new Error(`DuckDuckGo HTML search HTTP ${response.status}: ${text.slice(0, 180)}`)
      }
      return parseDuckDuckGoHtmlSearchResults(text)
    } finally {
      clearTimeout(timeout)
      request.signal.removeEventListener('abort', onAbort)
    }
  }

  private cachedResults(query: string): SearchResultCandidate[] | undefined {
    const cached = this.cache.get(query)
    if (!cached) return undefined
    if (cached.expiresAt <= Date.now()) {
      this.cache.delete(query)
      return undefined
    }
    return cached.results
  }

  private toSearchResults(query: string, results: SearchResultCandidate[], limit: number): WebSearchResult[] {
    return results.slice(0, limit).map((result, index) => ({
          sourceId: sourceIdFor('search', `${query}:${result.url}:${index}`),
          url: result.url,
          ...(result.title ? { title: result.title } : {}),
          snippet: result.snippet || result.title || result.url,
          retrievedAt: this.nowIso(),
          provider: this.id,
          rank: index + 1
        }))
  }
}

function waitForQueuedSearch(previous: Promise<void>, signal: AbortSignal): Promise<void> {
  if (signal.aborted) return Promise.reject(new Error('Search request aborted'))
  return new Promise((resolve, reject) => {
    const onAbort = () => {
      signal.removeEventListener('abort', onAbort)
      reject(new Error('Search request aborted'))
    }
    signal.addEventListener('abort', onAbort, { once: true })
    void previous.then(() => {
      signal.removeEventListener('abort', onAbort)
      resolve()
    }, reject)
  })
}

function waitForSearchSlot(ms: number, signal: AbortSignal): Promise<void> {
  if (signal.aborted) return Promise.reject(new Error('Search request aborted'))
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(done, ms)
    const onAbort = () => {
      clearTimeout(timeout)
      signal.removeEventListener('abort', onAbort)
      reject(new Error('Search request aborted'))
    }
    function done() {
      signal.removeEventListener('abort', onAbort)
      resolve()
    }
    signal.addEventListener('abort', onAbort, { once: true })
  })
}

export function parseDuckDuckGoHtmlSearchResults(html: string): SearchResultCandidate[] {
  const results: SearchResultCandidate[] = []
  const seenUrls = new Set<string>()
  const linkPattern = /<a\b[^>]*class=["'][^"']*\bresult__a\b[^"']*["'][^>]*href=["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi
  for (const match of html.matchAll(linkPattern)) {
    const url = normalizeDuckDuckGoHref(match[1] ?? '')
    if (!url || seenUrls.has(url)) continue
    const title = stripHtml(match[2] ?? '')
    if (!title) continue
    seenUrls.add(url)
    results.push({
      url,
      title,
      snippet: snippetNear(html, match.index ?? 0)
    })
  }
  return results
}

function normalizeDuckDuckGoHref(rawHref: string): string | undefined {
  const href = decodeHtml(rawHref).trim()
  if (!href) return undefined
  const candidate = href.startsWith('//')
    ? `https:${href}`
    : href.startsWith('/')
      ? `https://duckduckgo.com${href}`
      : href
  try {
    const url = new URL(candidate)
    const redirect = url.searchParams.get('uddg')
    const resolved = redirect ? new URL(redirect) : url
    if (resolved.protocol !== 'http:' && resolved.protocol !== 'https:') return undefined
    if (/duckduckgo\.com$/i.test(resolved.hostname) && resolved.pathname.startsWith('/l/')) return undefined
    resolved.hash = ''
    return resolved.toString()
  } catch {
    return undefined
  }
}

function snippetNear(html: string, startIndex: number): string | undefined {
  const window = html.slice(startIndex, startIndex + 3_000)
  const match = window.match(/<(?:a|div)\b[^>]*class=["'][^"']*\bresult__snippet\b[^"']*["'][^>]*>([\s\S]*?)<\/(?:a|div)>/i)
  const snippet = match ? stripHtml(match[1] ?? '') : ''
  return snippet || undefined
}

function stripHtml(value: string): string {
  return decodeHtml(value.replace(/<[^>]+>/g, ' ')).replace(/\s+/g, ' ').trim()
}

function decodeHtml(value: string): string {
  return value
    .replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (match, entity: string) => {
      const normalized = entity.toLowerCase()
      if (normalized.startsWith('#x')) {
        return codePointToString(Number.parseInt(normalized.slice(2), 16), match)
      }
      if (normalized.startsWith('#')) {
        return codePointToString(Number.parseInt(normalized.slice(1), 10), match)
      }
      switch (normalized) {
        case 'amp':
          return '&'
        case 'lt':
          return '<'
        case 'gt':
          return '>'
        case 'quot':
          return '"'
        case 'apos':
          return "'"
        case 'nbsp':
          return ' '
        default:
          return match
      }
    })
}

function codePointToString(value: number, fallback: string): string {
  if (!Number.isInteger(value) || value < 0 || value > 0x10ffff) return fallback
  return String.fromCodePoint(value)
}
