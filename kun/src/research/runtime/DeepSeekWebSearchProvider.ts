/**
 * [INPUT]: 依赖 DeepSeek Anthropic-compatible web_search、WebProvider 端口和 fetch
 * [OUTPUT]: 对外提供 DeepSeekWebSearchProvider，以足够响应空间完成最多三轮原始发布者或文档索引核验，把联网搜索结果和有效范围内 usage 归一化，并在运行实例内复用同查询结果
 * [POS]: research/runtime 的真实联网搜索末级适配器，被 SeededWebResearchTaskWorker 用于主材料发现
 * [PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
 */
import type { WebProvider, WebSearchRequest, WebSearchResult } from '../../ports/web-provider.js'
import { sourceIdFor } from '../../ports/web-provider.js'
import type { UsageSnapshot } from '../../contracts/usage.js'
import { estimateDeepseekCost } from '../../adapters/model/deepseek-pricing.js'

const DEFAULT_DEEPSEEK_ANTHROPIC_BASE = 'https://api.deepseek.com/anthropic'
const WEB_SEARCH_TOOL_TYPE = 'web_search_20250305'
const WEB_SEARCH_RESPONSE_TOKENS = 1_800
const WEB_SEARCH_MAX_USES = 3

type DeepSeekWebSearchProviderOptions = {
  apiKey: string
  baseUrl?: string
  model: string
  fetchImpl?: typeof fetch
  nowIso?: () => string
  cacheTtlMs?: number
}

export class DeepSeekWebSearchProvider implements WebProvider {
  readonly id = 'deepseek-web-search'
  readonly fallbackOnly = true
  private readonly fetchImpl: typeof fetch
  private readonly nowIso: () => string
  private readonly cacheTtlMs: number
  private readonly cache = new Map<string, { expiresAt: number; results: SearchLikeResult[] }>()

  constructor(private readonly options: DeepSeekWebSearchProviderOptions) {
    this.fetchImpl = options.fetchImpl ?? fetch
    this.nowIso = options.nowIso ?? (() => new Date().toISOString())
    this.cacheTtlMs = Math.max(1_000, options.cacheTtlMs ?? 10 * 60_000)
  }

  async search(request: WebSearchRequest): Promise<WebSearchResult[]> {
    const apiKey = this.options.apiKey.trim()
    if (!apiKey) throw new Error('DeepSeek API key is required for web search')
    const cacheKey = webSearchCacheKey(request)
    const cached = this.cachedResults(cacheKey)
    if (cached) return this.toSearchResults(request.query, cached, request.limit)
    const controller = new AbortController()
    const timeout = setTimeout(() => controller.abort(), request.timeoutMs)
    const onAbort = () => controller.abort()
    request.signal.addEventListener('abort', onAbort, { once: true })
    const model = mapDeepSeekModel(this.options.model)
    if (request.modelExecution && !request.modelExecution.canReserve({
      providerId: this.id,
      model,
      estimatedTokens: 30_000
    })) {
      clearTimeout(timeout)
      request.signal.removeEventListener('abort', onAbort)
      return []
    }
    const reservation = request.modelExecution?.reserve({
      providerId: this.id,
      model,
      estimatedTokens: 30_000
    })
    let usageRecorded = false
    try {
      const response = await this.fetchImpl(deepSeekAnthropicMessagesUrl(this.options.baseUrl), {
        method: 'POST',
        signal: controller.signal,
        headers: {
          'content-type': 'application/json',
          'anthropic-version': '2023-06-01',
          'x-api-key': apiKey,
          authorization: `Bearer ${apiKey}`
        },
        body: JSON.stringify({
          model,
          max_tokens: WEB_SEARCH_RESPONSE_TOKENS,
          tools: [{
            type: WEB_SEARCH_TOOL_TYPE,
            name: 'web_search',
            max_uses: WEB_SEARCH_MAX_USES
          }],
          messages: [{
            role: 'user',
            content: [{
              type: 'text',
              text: [
                `请联网搜索：${request.query}`,
                ...(request.timeRange ? [
                  '',
                  `时间范围：${request.timeRange.startDate} 至 ${request.timeRange.endDate}。`,
                  request.timeRange.defaulted
                    ? '这是用户未指定时间时的默认最近一年窗口；除非网页明确落在该窗口或用于解释该窗口内事件背景，否则不要优先返回。'
                    : '这是用户指定或确认过的时间范围，请优先返回该范围内的来源。'
                ] : []),
                '',
                '只需要找到适合深度研究引用的一手或高可信来源。优先原始发布者、正式披露机构、原始数据页，以及能继续打开原始文件的文档索引。',
                '不要把第三方分析、行情预测、营销材料或评论文章仅因为 URL 以 PDF 结尾就当成一手材料。',
                '如果前两次检索没有找到可核验的原始发布者或文档索引，最后一次必须改用原始机构名称和官网 site: 查询核验，而不是返回更多同类二手材料。',
                '请返回尽量包含 URL、标题和一句话摘要的结果。'
              ].join('\n')
            }]
          }]
        })
      })
      const text = await response.text()
      if (!response.ok) {
        throw new Error(`DeepSeek web search HTTP ${response.status}: ${text.slice(0, 240)}`)
      }
      const payload = parseJson(text)
      const usage = deepSeekUsage(payload)
      if (usage && reservation && request.modelExecution) {
        await request.modelExecution.record({
          providerId: this.id,
          model,
          reservation,
          usage
        })
        usageRecorded = true
      }
      const extracted = collectSearchLikeResults(payload)
      const fallback = extracted.length > 0 ? extracted : collectMarkdownLinks(text)
      const results = dedupeSearchResults(fallback)
      if (results.length > 0) {
        this.cache.set(cacheKey, { expiresAt: Date.now() + this.cacheTtlMs, results })
      }
      return this.toSearchResults(request.query, results, request.limit)
    } finally {
      clearTimeout(timeout)
      request.signal.removeEventListener('abort', onAbort)
      if (reservation && request.modelExecution) {
        await request.modelExecution.finish({
          reservation,
          chargeEstimateOnMissing: !usageRecorded
        })
      }
    }
  }

  private cachedResults(key: string): SearchLikeResult[] | undefined {
    const cached = this.cache.get(key)
    if (!cached) return undefined
    if (cached.expiresAt <= Date.now()) {
      this.cache.delete(key)
      return undefined
    }
    return cached.results
  }

  private toSearchResults(query: string, results: SearchLikeResult[], limit: number): WebSearchResult[] {
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

function webSearchCacheKey(request: WebSearchRequest): string {
  return JSON.stringify({
    query: request.query.trim().replace(/\s+/gu, ' ').toLowerCase(),
    timeRange: request.timeRange ?? null
  })
}

function deepSeekAnthropicMessagesUrl(baseUrl: string | undefined): string {
  const raw = (baseUrl?.trim() || DEFAULT_DEEPSEEK_ANTHROPIC_BASE).replace(/\/+$/, '')
  try {
    const url = new URL(raw)
    url.pathname = '/anthropic/v1/messages'
    url.search = ''
    return url.toString()
  } catch {
    return `${DEFAULT_DEEPSEEK_ANTHROPIC_BASE}/v1/messages`
  }
}

type SearchLikeResult = {
  url: string
  title?: string
  snippet?: string
}

function parseJson(text: string): unknown {
  try {
    return JSON.parse(text)
  } catch {
    return undefined
  }
}

function deepSeekUsage(value: unknown): UsageSnapshot | undefined {
  if (!isRecord(value) || !isRecord(value.usage)) return undefined
  const promptTokens = nonNegativeInteger(value.usage.input_tokens)
  const completionTokens = nonNegativeInteger(value.usage.output_tokens)
  const cacheHitTokens = Math.min(promptTokens, nonNegativeInteger(value.usage.cache_read_input_tokens))
  const cacheMissTokens = Math.max(0, promptTokens - cacheHitTokens)
  const estimatedCost = estimateDeepseekCost({
    model: 'deepseek-chat',
    cacheHitTokens,
    cacheMissTokens,
    outputTokens: completionTokens
  })
  return {
    promptTokens,
    completionTokens,
    totalTokens: promptTokens + completionTokens,
    cacheHitTokens,
    cacheMissTokens,
    cacheHitRate: promptTokens > 0 ? cacheHitTokens / promptTokens : null,
    turns: 1,
    ...(estimatedCost ?? {})
  }
}

function nonNegativeInteger(value: unknown): number {
  const number = typeof value === 'number' ? value : Number(value)
  return Number.isFinite(number) && number >= 0 ? Math.floor(number) : 0
}

function collectSearchLikeResults(value: unknown): SearchLikeResult[] {
  const results: SearchLikeResult[] = []
  const visit = (node: unknown): void => {
    if (Array.isArray(node)) {
      for (const item of node) visit(item)
      return
    }
    if (!isRecord(node)) return
    const url = stringValue(node.url)
    if (/^https?:\/\//i.test(url)) {
      results.push({
        url,
        title: stringValue(node.title) || stringValue(node.name),
        snippet: stringValue(node.snippet)
          || stringValue(node.summary)
          || stringValue(node.text)
          || stringValue(node.page_age)
      })
    }
    for (const item of Object.values(node)) visit(item)
  }
  visit(value)
  return results
}

function collectMarkdownLinks(text: string): SearchLikeResult[] {
  const results: SearchLikeResult[] = []
  const markdownLinkRe = /\[([^\]]{1,160})\]\((https?:\/\/[^)\s]+)\)/g
  for (let match = markdownLinkRe.exec(text); match; match = markdownLinkRe.exec(text)) {
    const title = match[1]?.trim()
    results.push({
      ...(title ? { title } : {}),
      url: stripTrailingPunctuation(match[2] ?? '')
    })
  }
  const bareUrlRe = /https?:\/\/[^\s<>)"']+/g
  for (let match = bareUrlRe.exec(text); match; match = bareUrlRe.exec(text)) {
    results.push({ url: stripTrailingPunctuation(match[0] ?? '') })
  }
  return results
}

function dedupeSearchResults(results: SearchLikeResult[]): SearchLikeResult[] {
  const seen = new Set<string>()
  return results.filter((result) => {
    if (!/^https?:\/\//i.test(result.url)) return false
    const key = result.url.replace(/#.*$/, '').replace(/\/+$/, '')
    if (seen.has(key)) return false
    seen.add(key)
    return true
  })
}

function stripTrailingPunctuation(value: string): string {
  return value.replace(/[),.;，。；）]+$/g, '')
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function stringValue(value: unknown): string {
  return typeof value === 'string' ? value.trim() : ''
}

function mapDeepSeekModel(model: string): string {
  const normalized = model.toLowerCase()
  if (normalized.includes('pro') || normalized.includes('flash') || normalized.includes('chat')) {
    return 'deepseek-chat'
  }
  if (normalized.includes('reasoner')) {
    return 'deepseek-reasoner'
  }
  return model
}
