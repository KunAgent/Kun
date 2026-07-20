/**
 * [INPUT]: 依赖多个 WebProvider 搜索适配器
 * [OUTPUT]: 对外提供 CascadingWebSearchProvider，按优先级和单 Provider 时间片收集过滤后结果，并按请求语义控制 fallbackOnly provider
 * [POS]: research/runtime 的搜索容错组合器，让 Tavily、免费搜索和付费模型兜底保持单一 WebProvider 契约，避免首个失效引擎耗尽整次查询时间
 * [PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
 */
import type { WebProvider, WebSearchRequest, WebSearchResult } from '../../ports/web-provider.js'

export class CascadingWebSearchProvider implements WebProvider {
  readonly id: string
  private readonly cache = new Map<string, { expiresAt: number; results: WebSearchResult[] }>()

  constructor(private readonly providers: WebProvider[]) {
    this.id = providers.map((provider) => provider.id).join('->') || 'unconfigured-web-search'
  }

  async search(request: WebSearchRequest): Promise<WebSearchResult[]> {
    return this.searchFiltered(request, () => true)
  }

  async searchFiltered(
    request: WebSearchRequest,
    accept: (result: WebSearchResult) => boolean
  ): Promise<WebSearchResult[]> {
    let lastError: unknown
    const collected: WebSearchResult[] = []
    const seen = new Set<string>()
    const acceptedLimit = Math.max(1, request.acceptedLimit ?? request.limit)
    const cacheKey = cascadeCacheKey(request)
    const cached = this.cachedResults(cacheKey)
    if (cached) {
      const accepted = cached.filter(accept).slice(0, acceptedLimit)
      if (accepted.length > 0) {
        request.onProviderAttempt?.({
          providerId: `${this.id}:cache`,
          rawResultCount: cached.length,
          acceptedResultCount: accepted.length
        })
        return accepted
      }
    }
    for (const provider of this.providers) {
      if (!provider.search) continue
      if (provider.fallbackOnly && request.allowFallbackOnly === false) continue
      if (provider.fallbackOnly && collected.length > 0 && request.allowFallbackOnly !== true) continue
      try {
        const results = await searchWithProviderTimeSlice(provider, request)
        let acceptedCount = 0
        for (const result of results) {
          if (!accept(result)) continue
          acceptedCount += 1
          const key = result.url.replace(/#.*$/, '').replace(/\/+$/, '')
          if (!key || seen.has(key)) continue
          seen.add(key)
          collected.push(result)
          if (collected.length >= acceptedLimit) {
            this.storeResults(cacheKey, collected)
            request.onProviderAttempt?.({
              providerId: provider.id,
              rawResultCount: results.length,
              acceptedResultCount: acceptedCount
            })
            return collected
          }
        }
        request.onProviderAttempt?.({
          providerId: provider.id,
          rawResultCount: results.length,
          acceptedResultCount: acceptedCount
        })
      } catch (error) {
        lastError = error
        request.onProviderAttempt?.({
          providerId: provider.id,
          rawResultCount: 0,
          acceptedResultCount: 0,
          error: error instanceof Error ? error.message : String(error)
        })
      }
    }
    if (collected.length > 0) {
      this.storeResults(cacheKey, collected)
      return collected
    }
    if (lastError) throw lastError
    return []
  }

  private cachedResults(key: string): WebSearchResult[] | undefined {
    const cached = this.cache.get(key)
    if (!cached) return undefined
    if (cached.expiresAt <= Date.now()) {
      this.cache.delete(key)
      return undefined
    }
    return cached.results
  }

  private storeResults(key: string, results: WebSearchResult[]): void {
    this.cache.set(key, { expiresAt: Date.now() + 10 * 60_000, results: [...results] })
  }
}

function cascadeCacheKey(request: WebSearchRequest): string {
  return JSON.stringify({
    query: request.query.trim().replace(/\s+/gu, ' ').toLowerCase(),
    timeRange: request.timeRange ?? null,
    limit: request.limit,
    allowFallbackOnly: request.allowFallbackOnly ?? null
  })
}

async function searchWithProviderTimeSlice(
  provider: WebProvider,
  request: WebSearchRequest
): Promise<WebSearchResult[]> {
  if (!provider.search) return []
  const controller = new AbortController()
  const onAbort = () => controller.abort(request.signal.reason)
  request.signal.addEventListener('abort', onAbort, { once: true })
  if (request.signal.aborted) onAbort()
  const timeoutMs = provider.fallbackOnly
    ? request.timeoutMs
    : Math.max(1, Math.min(8_000, Math.floor(request.timeoutMs / 3)))
  const timeout = setTimeout(() => controller.abort(new Error(`search_provider_timeout: ${provider.id}`)), timeoutMs)
  try {
    return await provider.search({ ...request, timeoutMs, signal: controller.signal })
  } finally {
    clearTimeout(timeout)
    request.signal.removeEventListener('abort', onAbort)
  }
}
