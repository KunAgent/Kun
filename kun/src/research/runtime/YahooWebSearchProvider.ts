/**
 * [INPUT]: 依赖 WebProvider 端口、node:http2、可选测试 fetch、parse5 和 Yahoo Search HTML 结果页
 * [OUTPUT]: 对外提供 YahooWebSearchProvider 与 parseYahooHtmlSearchResults，默认以 HTTP/2 请求 Yahoo 避免 HTTP/1.1 空页
 * [POS]: research/runtime 的免费搜索末级容错，在 Brave/DuckDuckGo 受限时提供可抓取目标页候选
 * [PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
 */
import { parse } from 'parse5'
import { connect } from 'node:http2'
import type { WebProvider, WebSearchRequest, WebSearchResult } from '../../ports/web-provider.js'
import { sourceIdFor } from '../../ports/web-provider.js'

const DEFAULT_YAHOO_SEARCH_URL = 'https://search.yahoo.com/search'
const DEFAULT_USER_AGENT = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 Chrome/124 Safari/537.36'

type YahooWebSearchProviderOptions = {
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

type HtmlNode = {
  tagName?: string
  attrs?: Array<{ name: string; value: string }>
  childNodes?: HtmlNode[]
  value?: string
}

export class YahooWebSearchProvider implements WebProvider {
  readonly id = 'yahoo-html-search'
  private readonly fetchImpl?: typeof fetch
  private readonly nowIso: () => string
  private readonly searchUrl: string
  private readonly userAgent: string
  private readonly minIntervalMs: number
  private readonly cacheTtlMs: number
  private readonly cache = new Map<string, { expiresAt: number; results: SearchResultCandidate[] }>()
  private queue: Promise<void> = Promise.resolve()
  private lastRequestAt = 0

  constructor(options: YahooWebSearchProviderOptions = {}) {
    this.fetchImpl = options.fetchImpl
    this.nowIso = options.nowIso ?? (() => new Date().toISOString())
    this.searchUrl = options.searchUrl ?? DEFAULT_YAHOO_SEARCH_URL
    this.userAgent = options.userAgent ?? DEFAULT_USER_AGENT
    this.minIntervalMs = Math.max(0, options.minIntervalMs ?? 1_200)
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
    const onAbort = () => controller.abort()
    request.signal.addEventListener('abort', onAbort, { once: true })
    try {
      const url = new URL(this.searchUrl)
      url.searchParams.set('p', query)
      url.searchParams.set('nojs', '1')
      const headers = {
        accept: 'text/html,application/xhtml+xml',
        'accept-language': 'en-US,en;q=0.9',
        'user-agent': this.userAgent
      }
      const response = this.fetchImpl
        ? await fetchYahooWithInjectedFetch(this.fetchImpl, url, controller.signal, headers)
        : await fetchYahooOverHttp2(url, controller.signal, headers)
      const text = response.text
      if (response.status < 200 || response.status >= 300) {
        throw new Error(`Yahoo HTML search HTTP ${response.status}: ${text.slice(0, 180)}`)
      }
      return parseYahooHtmlSearchResults(text)
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

async function fetchYahooWithInjectedFetch(
  fetchImpl: typeof fetch,
  url: URL,
  signal: AbortSignal,
  headers: Record<string, string>
): Promise<{ status: number; text: string }> {
  const response = await fetchImpl(url.toString(), { method: 'GET', signal, headers })
  return { status: response.status, text: await response.text() }
}

function fetchYahooOverHttp2(
  url: URL,
  signal: AbortSignal,
  headers: Record<string, string>
): Promise<{ status: number; text: string }> {
  if (signal.aborted) return Promise.reject(new Error('Yahoo HTML search aborted'))
  return new Promise((resolve, reject) => {
    const session = connect(url.origin)
    let settled = false
    let status = 0
    let text = ''
    const finish = (error?: unknown) => {
      if (settled) return
      settled = true
      signal.removeEventListener('abort', onAbort)
      session.close()
      if (error) reject(error)
      else resolve({ status, text })
    }
    const onAbort = () => {
      session.destroy()
      finish(new Error('Yahoo HTML search aborted'))
    }
    signal.addEventListener('abort', onAbort, { once: true })
    session.once('error', finish)
    const request = session.request({
      ':method': 'GET',
      ':path': `${url.pathname}${url.search}`,
      ...headers
    })
    request.setEncoding('utf8')
    request.once('response', (responseHeaders) => {
      status = Number(responseHeaders[':status'] ?? 0)
    })
    request.on('data', (chunk: string) => { text += chunk })
    request.once('end', () => finish())
    request.once('error', finish)
    request.end()
  })
}

export function parseYahooHtmlSearchResults(html: string): SearchResultCandidate[] {
  const document = parse(html) as unknown as HtmlNode
  const results: SearchResultCandidate[] = []
  const seen = new Set<string>()
  for (const item of descendants(document).filter((node) => node.tagName === 'li')) {
    const anchor = descendants(item).find((node) =>
      node.tagName === 'a' && attribute(node, 'data-matarget') === 'algo' && Boolean(attribute(node, 'href'))
    )
    const url = normalizeYahooResultUrl(attribute(anchor, 'href'))
    const titleNode = descendants(anchor).find((node) => node.tagName === 'h3')
    const title = cleanText(textContent(titleNode))
    if (!url || !title || seen.has(url)) continue
    const snippetNode = descendants(item).find((node) => node.tagName === 'p')
    const snippet = cleanText(textContent(snippetNode))
    seen.add(url)
    results.push({ url, title, ...(snippet ? { snippet } : {}) })
  }
  return results
}

function normalizeYahooResultUrl(value: string): string {
  if (!value) return ''
  try {
    const parsed = new URL(value)
    if (parsed.hostname.endsWith('r.search.yahoo.com')) {
      const encoded = parsed.pathname.match(/\/RU=([^/]+)\/RK=/u)?.[1]
      if (!encoded) return ''
      const decoded = decodeURIComponent(encoded)
      const target = new URL(decoded)
      return /^https?:$/u.test(target.protocol) ? target.toString() : ''
    }
    return /^https?:$/u.test(parsed.protocol) ? parsed.toString() : ''
  } catch {
    return ''
  }
}

function descendants(node: HtmlNode | undefined): HtmlNode[] {
  if (!node) return []
  return [node, ...(node.childNodes ?? []).flatMap((child) => descendants(child))]
}

function attribute(node: HtmlNode | undefined, name: string): string {
  return node?.attrs?.find((attr) => attr.name === name)?.value ?? ''
}

function textContent(node: HtmlNode | undefined): string {
  if (!node) return ''
  return `${node.value ?? ''}${(node.childNodes ?? []).map((child) => textContent(child)).join('')}`
}

function cleanText(value: string): string {
  return value.replace(/\s+/g, ' ').trim()
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
