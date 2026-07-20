/**
 * [INPUT]: 依赖 WebProvider 端口、fetch、parse5 和 Brave Search HTML 结果页
 * [OUTPUT]: 对外提供 BraveWebSearchProvider 与 parseBraveHtmlSearchResults
 * [POS]: research/runtime 的默认无 Key 搜索入口，先于 DuckDuckGo 和付费模型搜索提供真实网页候选
 * [PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
 */
import { parse } from 'parse5'
import type { WebProvider, WebSearchRequest, WebSearchResult } from '../../ports/web-provider.js'
import { sourceIdFor } from '../../ports/web-provider.js'

const DEFAULT_BRAVE_SEARCH_URL = 'https://search.brave.com/search'
const DEFAULT_USER_AGENT = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 Chrome/124 Safari/537.36'

type BraveWebSearchProviderOptions = {
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

export class BraveWebSearchProvider implements WebProvider {
  readonly id = 'brave-html-search'
  private readonly fetchImpl: typeof fetch
  private readonly nowIso: () => string
  private readonly searchUrl: string
  private readonly userAgent: string
  private readonly minIntervalMs: number
  private readonly cacheTtlMs: number
  private readonly cache = new Map<string, { expiresAt: number; results: SearchResultCandidate[] }>()
  private queue: Promise<void> = Promise.resolve()
  private lastRequestAt = 0
  private cooldownUntil = 0

  constructor(options: BraveWebSearchProviderOptions = {}) {
    this.fetchImpl = options.fetchImpl ?? fetch
    this.nowIso = options.nowIso ?? (() => new Date().toISOString())
    this.searchUrl = options.searchUrl ?? DEFAULT_BRAVE_SEARCH_URL
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
      if (this.cooldownUntil > Date.now()) throw new Error('Brave HTML search is cooling down after HTTP 429')
      const waitMs = Math.max(0, this.lastRequestAt + this.minIntervalMs - Date.now())
      if (waitMs > 0) await waitForSearchSlot(waitMs, request.signal)
      this.lastRequestAt = Date.now()
      const results = await this.fetchSearchResults(query, request)
      this.cache.set(query, { expiresAt: Date.now() + this.cacheTtlMs, results })
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
      url.searchParams.set('source', 'web')
      const response = await this.fetchImpl(url.toString(), {
        method: 'GET',
        signal: controller.signal,
        headers: {
          accept: 'text/html,application/xhtml+xml',
          'accept-language': /[\u4e00-\u9fff]/u.test(query) ? 'zh-CN,zh;q=0.9,en;q=0.8' : 'en-US,en;q=0.9',
          'user-agent': this.userAgent
        }
      })
      const text = await response.text()
      if (!response.ok) {
        if (response.status === 429) this.cooldownUntil = Date.now() + 5 * 60_000
        throw new Error(`Brave HTML search HTTP ${response.status}: ${text.slice(0, 180)}`)
      }
      return parseBraveHtmlSearchResults(text)
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

export function parseBraveHtmlSearchResults(html: string): SearchResultCandidate[] {
  const document = parse(html) as unknown as HtmlNode
  const snippets = descendants(document).filter((node) =>
    node.tagName === 'div' && hasClass(node, 'snippet') && attribute(node, 'data-type') === 'web'
  )
  const results: SearchResultCandidate[] = []
  const seen = new Set<string>()
  for (const snippet of snippets) {
    const titleNode = descendants(snippet).find((node) => hasClass(node, 'search-snippet-title'))
    const anchor = descendants(snippet).find((node) =>
      node.tagName === 'a' && Boolean(attribute(node, 'href')) && descendants(node).includes(titleNode as HtmlNode)
    )
    const url = normalizeExternalUrl(attribute(anchor, 'href'))
    const title = cleanText(attribute(titleNode, 'title') || textContent(titleNode))
    if (!url || !title || seen.has(url)) continue
    const genericSnippet = descendants(snippet).find((node) => hasClass(node, 'generic-snippet'))
    const snippetText = cleanText(textContent(genericSnippet))
    seen.add(url)
    results.push({ url, title, ...(snippetText ? { snippet: snippetText } : {}) })
  }
  return results
}

function descendants(node: HtmlNode | undefined): HtmlNode[] {
  if (!node) return []
  const result: HtmlNode[] = []
  const stack = [...(node.childNodes ?? [])]
  while (stack.length > 0) {
    const current = stack.shift()
    if (!current) continue
    result.push(current)
    stack.unshift(...(current.childNodes ?? []))
  }
  return result
}

function attribute(node: HtmlNode | undefined, name: string): string {
  return node?.attrs?.find((attr) => attr.name === name)?.value?.trim() ?? ''
}

function hasClass(node: HtmlNode, className: string): boolean {
  return attribute(node, 'class').split(/\s+/u).includes(className)
}

function textContent(node: HtmlNode | undefined): string {
  if (!node) return ''
  return `${node.value ?? ''} ${(node.childNodes ?? []).map(textContent).join(' ')}`
}

function cleanText(value: string): string {
  return value.replace(/\s+/gu, ' ').trim()
}

function normalizeExternalUrl(value: string): string | undefined {
  try {
    const url = new URL(value)
    if (url.protocol !== 'http:' && url.protocol !== 'https:') return undefined
    if (url.hostname === 'search.brave.com' || url.hostname.endsWith('.search.brave.com')) return undefined
    url.hash = ''
    return url.toString()
  } catch {
    return undefined
  }
}
