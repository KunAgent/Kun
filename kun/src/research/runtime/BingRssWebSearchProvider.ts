/**
 * [INPUT]: 依赖 WebProvider 端口、fetch 和 Bing Search RSS 结果
 * [OUTPUT]: 对外提供带串行限速与缓存的 BingRssWebSearchProvider，以及 RSS item 解析器
 * [POS]: research/runtime 的默认无 Key 免费搜索入口，在受限 HTML 搜索与付费模型兜底之前发现真实网页候选
 * [PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
 */
import type { WebProvider, WebSearchRequest, WebSearchResult } from '../../ports/web-provider.js'
import { sourceIdFor } from '../../ports/web-provider.js'

const DEFAULT_BING_SEARCH_URL = 'https://www.bing.com/search'
const DEFAULT_USER_AGENT = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 Chrome/124 Safari/537.36'

type BingRssWebSearchProviderOptions = {
  fetchImpl?: typeof fetch
  nowIso?: () => string
  searchUrl?: string
  userAgent?: string
  minIntervalMs?: number
  cacheTtlMs?: number
}

type SearchResultCandidate = {
  url: string
  title: string
  snippet?: string
}

export class BingRssWebSearchProvider implements WebProvider {
  readonly id = 'bing-rss-search'
  private readonly fetchImpl: typeof fetch
  private readonly nowIso: () => string
  private readonly searchUrl: string
  private readonly userAgent: string
  private readonly minIntervalMs: number
  private readonly cacheTtlMs: number
  private readonly cache = new Map<string, { expiresAt: number; results: SearchResultCandidate[] }>()
  private queue: Promise<void> = Promise.resolve()
  private lastRequestAt = 0

  constructor(options: BingRssWebSearchProviderOptions = {}) {
    this.fetchImpl = options.fetchImpl ?? fetch
    this.nowIso = options.nowIso ?? (() => new Date().toISOString())
    this.searchUrl = options.searchUrl ?? DEFAULT_BING_SEARCH_URL
    this.userAgent = options.userAgent ?? DEFAULT_USER_AGENT
    this.minIntervalMs = Math.max(0, options.minIntervalMs ?? 1_000)
    this.cacheTtlMs = Math.max(1_000, options.cacheTtlMs ?? 10 * 60_000)
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
      const results = await this.fetchSearchResults(query, request)
      if (results.length > 0) this.cache.set(query, { expiresAt: Date.now() + this.cacheTtlMs, results })
      return results
    } finally {
      release()
    }
  }

  private async fetchSearchResults(query: string, request: WebSearchRequest): Promise<SearchResultCandidate[]> {
    const controller = new AbortController()
    const timeout = setTimeout(() => controller.abort(), request.timeoutMs)
    const onAbort = () => controller.abort(request.signal.reason)
    request.signal.addEventListener('abort', onAbort, { once: true })
    if (request.signal.aborted) onAbort()
    try {
      const url = new URL(this.searchUrl)
      url.searchParams.set('format', 'rss')
      url.searchParams.set('q', query)
      const chineseQuery = /[\u3400-\u9fff]/u.test(query)
      url.searchParams.set('setlang', chineseQuery ? 'zh-CN' : 'en-US')
      url.searchParams.set('cc', chineseQuery ? 'CN' : 'US')
      url.searchParams.set('mkt', chineseQuery ? 'zh-CN' : 'en-US')
      const response = await this.fetchImpl(url.toString(), {
        method: 'GET',
        signal: controller.signal,
        headers: {
          accept: 'application/rss+xml,application/xml,text/xml',
          'accept-language': chineseQuery ? 'zh-CN,zh;q=0.9,en;q=0.8' : 'en-US,en;q=0.9',
          'user-agent': this.userAgent
        }
      })
      const text = await response.text()
      if (!response.ok) throw new Error(`Bing RSS search HTTP ${response.status}: ${text.slice(0, 180)}`)
      return parseBingRssSearchResults(text)
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
      title: result.title,
      snippet: result.snippet || result.title,
      retrievedAt: this.nowIso(),
      provider: this.id,
      rank: index + 1
    }))
  }
}

export function parseBingRssSearchResults(xml: string): SearchResultCandidate[] {
  const results: SearchResultCandidate[] = []
  const seen = new Set<string>()
  for (const itemMatch of xml.matchAll(/<item\b[^>]*>([\s\S]*?)<\/item>/giu)) {
    const item = itemMatch[1] ?? ''
    const title = xmlTagText(item, 'title')
    const url = normalizeExternalUrl(xmlTagText(item, 'link'))
    const snippet = xmlTagText(item, 'description')
    if (!title || !url || seen.has(url)) continue
    seen.add(url)
    results.push({ url, title, ...(snippet ? { snippet } : {}) })
  }
  return results
}

function xmlTagText(value: string, tagName: string): string {
  const match = value.match(new RegExp(`<${tagName}\\b[^>]*>([\\s\\S]*?)<\\/${tagName}>`, 'iu'))
  return decodeXmlEntities((match?.[1] ?? '').replace(/^<!\[CDATA\[|\]\]>$/gu, ''))
    .replace(/<[^>]+>/gu, ' ')
    .replace(/\s+/gu, ' ')
    .trim()
}

function decodeXmlEntities(value: string): string {
  return value.replace(/&(#x[0-9a-f]+|#\d+|amp|lt|gt|quot|apos);/giu, (match, entity: string) => {
    const normalized = entity.toLowerCase()
    if (normalized.startsWith('#x')) return codePoint(Number.parseInt(normalized.slice(2), 16), match)
    if (normalized.startsWith('#')) return codePoint(Number.parseInt(normalized.slice(1), 10), match)
    return { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'" }[normalized] ?? match
  })
}

function codePoint(value: number, fallback: string): string {
  return Number.isInteger(value) && value >= 0 && value <= 0x10ffff ? String.fromCodePoint(value) : fallback
}

function normalizeExternalUrl(value: string): string | undefined {
  try {
    const url = new URL(value)
    if (url.protocol !== 'http:' && url.protocol !== 'https:') return undefined
    if (url.hostname === 'bing.com' || url.hostname.endsWith('.bing.com')) return undefined
    url.hash = ''
    return url.toString()
  } catch {
    return undefined
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
