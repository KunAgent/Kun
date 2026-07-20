/**
 * [INPUT]: 依赖 DeepSeek Anthropic-compatible web_search、WebProvider 端口和 fetch
 * [OUTPUT]: 对外提供 DeepSeekWebSearchProvider，把 DeepSeek 联网搜索结果归一为 WebSearchResult
 * [POS]: research/runtime 的真实联网搜索适配器，被 SeededWebResearchTaskWorker 用于补充网页种子源
 * [PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
 */
import type { WebProvider, WebSearchRequest, WebSearchResult } from '../../ports/web-provider.js'
import { sourceIdFor } from '../../ports/web-provider.js'

const DEFAULT_DEEPSEEK_ANTHROPIC_BASE = 'https://api.deepseek.com/anthropic'
const WEB_SEARCH_TOOL_TYPE = 'web_search_20250305'

type DeepSeekWebSearchProviderOptions = {
  apiKey: string
  baseUrl?: string
  model: string
  fetchImpl?: typeof fetch
  nowIso?: () => string
}

export class DeepSeekWebSearchProvider implements WebProvider {
  readonly id = 'deepseek-web-search'
  private readonly fetchImpl: typeof fetch
  private readonly nowIso: () => string

  constructor(private readonly options: DeepSeekWebSearchProviderOptions) {
    this.fetchImpl = options.fetchImpl ?? fetch
    this.nowIso = options.nowIso ?? (() => new Date().toISOString())
  }

  async search(request: WebSearchRequest): Promise<WebSearchResult[]> {
    const apiKey = this.options.apiKey.trim()
    if (!apiKey) throw new Error('DeepSeek API key is required for web search')
    const controller = new AbortController()
    const timeout = setTimeout(() => controller.abort(), request.timeoutMs)
    const onAbort = () => controller.abort()
    request.signal.addEventListener('abort', onAbort, { once: true })
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
          model: mapDeepSeekModel(this.options.model),
          max_tokens: 1_200,
          tools: [{
            type: WEB_SEARCH_TOOL_TYPE,
            name: 'web_search',
            max_uses: 3
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
                '只需要找到适合深度研究引用的一手或高可信来源。',
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
      const extracted = collectSearchLikeResults(payload)
      const fallback = extracted.length > 0 ? extracted : collectMarkdownLinks(text)
      return dedupeSearchResults(fallback)
        .slice(0, request.limit)
        .map((result, index) => ({
          sourceId: sourceIdFor('search', `${request.query}:${result.url}:${index}`),
          url: result.url,
          ...(result.title ? { title: result.title } : {}),
          snippet: result.snippet || result.title || result.url,
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
