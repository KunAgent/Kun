/**
 * [INPUT]: 依赖 DNS、固定目标 IP 的 HTTP(S) transport、ResearchPdfText、模型流、SeedSource 和 evidence/core 类型
 * [OUTPUT]: 对外提供防 DNS 重绑定/SSRF 且兼容代理 Fake-IP DNS 的有界并发网页抓取、HTML 直链文档发现、HTML/通用 JSON/PDF 清洗、不可引用搜索摘要降级、经正文身份复核的强来源归一化和含逐问题角色建议的 evidence-card 字段归一化函数
 * [POS]: research/runtime 的网页内容安全适配层，被 SeededWebResearchTaskWorker 调用，逐跳校验来源策略并固定已批准地址；HTML 只发现一跳直接文档候选，PDF 使用独立长超时完整下载并按研究焦点提取，禁止把二进制解码为证据文本
 * [PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
 */
import type { ModelStreamChunk } from '../../ports/model-client.js'
import { lookup } from 'node:dns/promises'
import { request as httpRequest, type IncomingHttpHeaders, type IncomingMessage } from 'node:http'
import { request as httpsRequest } from 'node:https'
import { isIP } from 'node:net'
import { Readable } from 'node:stream'
import { parse } from 'parse5'
import { linkResearchAbortSignal } from '../core/abort.js'
import { hashText } from '../core/hash.js'
import type { ResearchConfidence, ResearchModelUsageRecord, ResearchSourcePolicy } from '../core/types.js'
import type { AtomicClaim, SourceRecord } from '../evidence/types.js'
import type { ConflictCandidate, ResearchTaskWorkerInput } from '../agents/types.js'
import type { SeedSource } from './ResearchWebTypes.js'
import { isResearchSourceUrlAllowed } from './ResearchSourcePolicy.js'
import { extractResearchPdfText } from './ResearchPdfText.js'

const WEB_RESEARCH_TEXT_CHARS = 16_000
const WEB_RESEARCH_PDF_MAX_BYTES = 32 * 1024 * 1024
const WEB_RESEARCH_PDF_TIMEOUT_MS = 90_000
const WEB_RESEARCH_FETCH_CONCURRENCY = 3

export type FetchedSeedSource = SeedSource & {
  finalUrl: string
  title: string
  text: string
  contentType?: string
  byteCount: number
  fetchedAt: string
  linkedDocuments?: SeedSource[]
}

export type WebExtractionCard = {
  sourceIndex?: unknown
  questionIds?: unknown
  assignments?: unknown
  evidenceText?: unknown
  claimText?: unknown
  claimType?: unknown
  confidence?: unknown
  critical?: unknown
  entities?: unknown
  noteSummary?: unknown
  implicationForBrief?: unknown
  limitations?: unknown
  comparisonTargets?: unknown
}

export async function fetchSeedSources(
  seeds: SeedSource[],
  options: {
    fetchImpl: typeof fetch
    nowIso: () => string
    timeoutMs: number
    maxBytes: number
    sourcePolicy: ResearchSourcePolicy
    focusText?: string
    pdfTimeoutMs?: number
    maxConcurrency?: number
    signal?: AbortSignal
    taskId?: string
    onAudit?: (record: {
      taskId: string
      phase: 'fetch'
      status: 'success' | 'fallback' | 'failed'
      url: string
      error?: string
    }) => Promise<void>
  }
): Promise<FetchedSeedSource[]> {
  const results = await mapWithConcurrency(seeds, options.maxConcurrency ?? WEB_RESEARCH_FETCH_CONCURRENCY, async (seed) => {
    try {
      const fetched = await fetchSeedSource(seed, options)
      if (options.taskId) {
        await options.onAudit?.({ taskId: options.taskId, phase: 'fetch', status: 'success', url: seed.url })
      }
      return fetched
    } catch (error) {
      const fallback = fetchedFromSearchContent(seed, options.nowIso())
      if (options.taskId) {
        await options.onAudit?.({
          taskId: options.taskId,
          phase: 'fetch',
          status: fallback ? 'fallback' : 'failed',
          url: seed.url,
          error: error instanceof Error ? error.message : String(error)
        })
      }
      return fallback
    }
  })
  return results.filter((result): result is FetchedSeedSource => Boolean(result))
}

function fetchedFromSearchContent(seed: SeedSource, fetchedAt: string): FetchedSeedSource | null {
  const text = normalizeWhitespace(seed.searchContent ?? '')
  if (text.length < 120) return null
  return {
    ...seed,
    tags: [...new Set([...seed.tags, 'search_content_fallback'])],
    finalUrl: seed.url,
    title: seed.title,
    text,
    byteCount: Buffer.byteLength(text, 'utf8'),
    fetchedAt
  }
}

export async function fetchSeedSource(
  seed: SeedSource,
  options: {
    fetchImpl: typeof fetch
    nowIso: () => string
    timeoutMs: number
    maxBytes: number
    sourcePolicy: ResearchSourcePolicy
    focusText?: string
    pdfTimeoutMs?: number
    signal?: AbortSignal
  }
): Promise<FetchedSeedSource> {
  if (!isResearchSourceUrlAllowed(options.sourcePolicy, seed.url)) {
    throw new Error(`source_policy_domain_blocked: ${seed.url}`)
  }
  const controller = new AbortController()
  const unlinkAbort = linkResearchAbortSignal(options.signal, controller)
  let timeout = setTimeout(() => controller.abort(), options.timeoutMs)
  try {
    const fetched = await fetchWithSafeRedirects(seed.url, options, controller.signal)
    const { response, finalUrl } = fetched
    if (!response.ok) throw new Error(`HTTP ${response.status}`)
    if (!isResearchSourceUrlAllowed(options.sourcePolicy, finalUrl)) {
      throw new Error(`source_policy_redirect_blocked: ${finalUrl}`)
    }
    const contentType = response.headers.get('content-type') ?? undefined
    const pdfResource = isPdfResource(contentType, finalUrl)
    if (pdfResource) {
      clearTimeout(timeout)
      timeout = setTimeout(
        () => controller.abort(),
        Math.max(options.timeoutMs, options.pdfTimeoutMs ?? WEB_RESEARCH_PDF_TIMEOUT_MS)
      )
    }
    const raw = pdfResource
      ? await readResponseBytes(response, WEB_RESEARCH_PDF_MAX_BYTES)
      : await readResponsePrefix(response, options.maxBytes)
    const rawByteCount = typeof raw === 'string' ? Buffer.byteLength(raw, 'utf8') : raw.byteLength
    const extracted = pdfResource
      ? await extractResearchPdfText(raw as Uint8Array, WEB_RESEARCH_TEXT_CHARS, options.focusText)
      : extractReadableText(raw as string, contentType)
    const linkedDocuments = pdfResource
      ? []
      : extractLinkedDocumentSeeds(raw as string, finalUrl, seed)
    const text = extracted.text.slice(0, WEB_RESEARCH_TEXT_CHARS)
    if (text.trim().length < 300 && linkedDocuments.length === 0) {
      throw new Error('fetched source text is too short')
    }
    return {
      ...seed,
      title: extracted.title || seed.title,
      finalUrl,
      contentType,
      text,
      byteCount: rawByteCount,
      fetchedAt: options.nowIso(),
      ...(linkedDocuments.length > 0 ? { linkedDocuments } : {})
    }
  } finally {
    clearTimeout(timeout)
    unlinkAbort()
  }
}

async function mapWithConcurrency<T, R>(
  items: T[],
  concurrency: number,
  mapper: (item: T, index: number) => Promise<R>
): Promise<R[]> {
  if (items.length === 0) return []
  const results = new Array<R>(items.length)
  let nextIndex = 0
  const runner = async () => {
    while (nextIndex < items.length) {
      const index = nextIndex
      nextIndex += 1
      results[index] = await mapper(items[index]!, index)
    }
  }
  const runnerCount = Math.min(items.length, Math.max(1, Math.floor(concurrency)))
  await Promise.all(Array.from({ length: runnerCount }, runner))
  return results
}

export function isPdfResource(contentType: string | undefined, url: string): boolean {
  return /application\/pdf/iu.test(contentType ?? '') || /\.pdf(?:$|[?#])/iu.test(url)
}

async function fetchWithSafeRedirects(
  initialUrl: string,
  options: {
    fetchImpl: typeof fetch
    sourcePolicy: ResearchSourcePolicy
  },
  signal: AbortSignal
): Promise<{ response: Response; finalUrl: string }> {
  let currentUrl = initialUrl
  for (let redirectCount = 0; redirectCount <= 5; redirectCount += 1) {
    if (!isResearchSourceUrlAllowed(options.sourcePolicy, currentUrl)) {
      throw new Error(`source_policy_redirect_blocked: ${currentUrl}`)
    }
    const response = options.fetchImpl === globalThis.fetch
      ? await fetchPinnedPublicUrl(currentUrl, signal)
      : await fetchWithInjectedTransport(currentUrl, options.fetchImpl, signal)
    if (![301, 302, 303, 307, 308].includes(response.status)) {
      return { response, finalUrl: currentUrl }
    }
    const location = response.headers.get('location')
    if (!location) throw new Error(`redirect_without_location: ${currentUrl}`)
    await response.body?.cancel()
    currentUrl = new URL(location, currentUrl).toString()
  }
  throw new Error(`too_many_redirects: ${initialUrl}`)
}

async function fetchWithInjectedTransport(rawUrl: string, fetchImpl: typeof fetch, signal: AbortSignal): Promise<Response> {
  await assertPublicResearchUrl(rawUrl, false)
  return fetchImpl(rawUrl, {
    signal,
    redirect: 'manual',
    headers: researchFetchHeaders()
  })
}

async function fetchPinnedPublicUrl(rawUrl: string, signal: AbortSignal): Promise<Response> {
  const { url, addresses } = await resolvePublicResearchUrl(rawUrl, true)
  const address = addresses[0]
  if (!address) throw new Error(`private_network_dns_blocked: ${rawUrl}`)
  const response = await requestPinnedAddress(url, address.address, address.family, signal)
  return nodeResponseToFetchResponse(response)
}

type ResearchDnsLookup = (hostname: string) => Promise<Array<{ address: string; family: number }>>

const defaultResearchDnsLookup: ResearchDnsLookup = (hostname) => lookup(hostname, { all: true, verbatim: true })

export async function assertPublicResearchUrl(
  rawUrl: string,
  resolveDns = true,
  lookupImpl: ResearchDnsLookup = defaultResearchDnsLookup
): Promise<void> {
  await resolvePublicResearchUrl(rawUrl, resolveDns, lookupImpl)
}

async function resolvePublicResearchUrl(
  rawUrl: string,
  resolveDns: boolean,
  lookupImpl: ResearchDnsLookup = defaultResearchDnsLookup
): Promise<{ url: URL; addresses: Array<{ address: string; family: number }> }> {
  let url: URL
  try {
    url = new URL(rawUrl)
  } catch {
    throw new Error(`invalid_research_url: ${rawUrl}`)
  }
  if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password) {
    throw new Error(`unsafe_research_url: ${rawUrl}`)
  }
  const hostname = url.hostname.toLowerCase().replace(/^\[|\]$/g, '').replace(/\.$/, '')
  if (!hostname || hostname === 'localhost' || hostname.endsWith('.localhost') || hostname.endsWith('.local')) {
    throw new Error(`private_network_url_blocked: ${rawUrl}`)
  }
  if (isIP(hostname)) {
    if (isPrivateOrLocalAddress(hostname)) throw new Error(`private_network_url_blocked: ${rawUrl}`)
    return { url, addresses: [{ address: hostname, family: isIP(hostname) }] }
  }
  if (!resolveDns) return { url, addresses: [] }
  const addresses = await lookupImpl(hostname)
  if (addresses.length === 0 || addresses.some((entry) => (
    isPrivateOrLocalAddress(entry.address) && !isProxyFakeIpAddress(entry.address)
  ))) {
    throw new Error(`private_network_dns_blocked: ${rawUrl}`)
  }
  return { url, addresses }
}

function requestPinnedAddress(url: URL, address: string, family: number, signal: AbortSignal): Promise<IncomingMessage> {
  return new Promise((resolve, reject) => {
    const request = (url.protocol === 'https:' ? httpsRequest : httpRequest)({
      protocol: url.protocol,
      hostname: address,
      family,
      port: url.port || undefined,
      path: `${url.pathname}${url.search}`,
      method: 'GET',
      headers: {
        ...researchFetchHeaders(),
        Host: url.host
      },
      ...(url.protocol === 'https:' ? { servername: url.hostname } : {}),
      signal
    }, resolve)
    request.once('error', reject)
    request.end()
  })
}

function nodeResponseToFetchResponse(response: IncomingMessage): Response {
  const status = response.statusCode ?? 500
  const body = status === 204 || status === 304
    ? null
    : Readable.toWeb(response) as ReadableStream<Uint8Array>
  return new Response(body, {
    status,
    statusText: response.statusMessage,
    headers: fetchHeadersFromNode(response.headers)
  })
}

function fetchHeadersFromNode(headers: IncomingHttpHeaders): Headers {
  const result = new Headers()
  for (const [name, value] of Object.entries(headers)) {
    if (Array.isArray(value)) {
      for (const item of value) result.append(name, item)
    } else if (typeof value === 'string' || typeof value === 'number') {
      result.set(name, String(value))
    }
  }
  return result
}

function researchFetchHeaders(): Record<string, string> {
  return {
    Accept: 'text/html,application/json,text/plain,*/*',
    'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
  }
}

function isPrivateOrLocalAddress(address: string): boolean {
  const normalized = address.toLowerCase().split('%')[0] ?? ''
  if (normalized.includes(':')) {
    const bytes = ipv6Bytes(normalized)
    if (!bytes) return true
    const mappedIpv4 = bytes.slice(0, 10).every((byte) => byte === 0)
      && bytes[10] === 0xff
      && bytes[11] === 0xff
    if (mappedIpv4) return isPrivateIpv4(bytes.slice(12))
    const unspecified = bytes.every((byte) => byte === 0)
    const loopback = bytes.slice(0, 15).every((byte) => byte === 0) && bytes[15] === 1
    return unspecified
      || loopback
      || (bytes[0]! & 0xfe) === 0xfc
      || (bytes[0] === 0xfe && (bytes[1]! & 0xc0) === 0x80)
      || bytes[0] === 0xff
      || (bytes[0] === 0x20 && bytes[1] === 0x01 && bytes[2] === 0x0d && bytes[3] === 0xb8)
  }
  const parts = normalized.split('.').map(Number)
  if (parts.length !== 4 || parts.some((part) => !Number.isInteger(part) || part < 0 || part > 255)) return true
  return isPrivateIpv4(parts)
}

function isProxyFakeIpAddress(address: string): boolean {
  const normalized = address.toLowerCase().split('%')[0] ?? ''
  if (normalized.includes(':')) return false
  const parts = normalized.split('.').map(Number)
  return parts.length === 4
    && parts.every((part) => Number.isInteger(part) && part >= 0 && part <= 255)
    && parts[0] === 198
    && (parts[1] === 18 || parts[1] === 19)
}

function isPrivateIpv4(parts: number[]): boolean {
  const [a, b, c] = parts
  return a === 0
    || a === 10
    || a === 127
    || (a === 169 && b === 254)
    || (a === 172 && b! >= 16 && b! <= 31)
    || (a === 192 && b === 168)
    || (a === 100 && b! >= 64 && b! <= 127)
    || (a === 192 && b === 0 && c === 0)
    || (a === 192 && b === 0 && c === 2)
    || (a === 198 && (b === 18 || b === 19))
    || (a === 198 && b === 51 && c === 100)
    || (a === 203 && b === 0 && c === 113)
    || a! >= 224
}

function ipv6Bytes(address: string): number[] | null {
  const halves = address.split('::')
  if (halves.length > 2) return null
  const parseGroups = (value: string): number[] | null => {
    if (!value) return []
    const groups: number[] = []
    for (const part of value.split(':')) {
      if (part.includes('.')) {
        const ipv4 = part.split('.').map(Number)
        if (ipv4.length !== 4 || ipv4.some((item) => !Number.isInteger(item) || item < 0 || item > 255)) return null
        groups.push((ipv4[0]! << 8) | ipv4[1]!, (ipv4[2]! << 8) | ipv4[3]!)
        continue
      }
      if (!/^[0-9a-f]{1,4}$/u.test(part)) return null
      groups.push(Number.parseInt(part, 16))
    }
    return groups
  }
  const left = parseGroups(halves[0] ?? '')
  const right = parseGroups(halves[1] ?? '')
  if (!left || !right) return null
  const missing = 8 - left.length - right.length
  if ((halves.length === 1 && missing !== 0) || (halves.length === 2 && missing < 1)) return null
  const groups = halves.length === 2 ? [...left, ...Array<number>(missing).fill(0), ...right] : left
  if (groups.length !== 8) return null
  return groups.flatMap((group) => [group >> 8, group & 0xff])
}

export async function readResponsePrefix(response: Response, maxBytes: number): Promise<string> {
  const reader = response.body?.getReader()
  if (!reader) return (await response.text()).slice(0, maxBytes)
  const chunks: Uint8Array[] = []
  let total = 0
  while (total < maxBytes) {
    const { done, value } = await reader.read()
    if (done) break
    const remaining = maxBytes - total
    if (value.length > remaining) {
      chunks.push(value.subarray(0, remaining))
      await reader.cancel()
      break
    }
    chunks.push(value)
    total += value.length
  }
  return Buffer.concat(chunks).toString('utf8')
}

async function readResponseBytes(response: Response, maxBytes: number): Promise<Uint8Array> {
  const reader = response.body?.getReader()
  if (!reader) {
    const bytes = new Uint8Array(await response.arrayBuffer())
    if (bytes.byteLength > maxBytes) throw new Error(`PDF source exceeds ${maxBytes} byte limit`)
    return bytes
  }
  const chunks: Uint8Array[] = []
  let total = 0
  while (true) {
    const { done, value } = await reader.read()
    if (done) break
    total += value.byteLength
    if (total > maxBytes) {
      await reader.cancel()
      throw new Error(`PDF source exceeds ${maxBytes} byte limit`)
    }
    chunks.push(value)
  }
  return Uint8Array.from(Buffer.concat(chunks))
}
export function sourceRecordForFetched(
  input: ResearchTaskWorkerInput,
  source: FetchedSeedSource,
  sourceIndex: number,
  nowIso: string
): SourceRecord {
  const usedSearchContentFallback = source.tags.includes('search_content_fallback')
  const isStrongSource = !usedSearchContentFallback && (
    source.tags.includes('official') ||
    source.tags.includes('international') ||
    source.tags.includes('academic') ||
    source.tags.includes('primary_research') ||
    source.tags.includes('document_verified_primary_source') ||
    source.tags.includes('model_verified_primary_source') ||
    source.tags.includes('model_verified_authoritative_source')
  )
  return {
    id: `${input.task.id}_web_source_${sourceIndex}`,
    sourceType: 'web',
    title: source.title,
    canonicalUrl: source.finalUrl,
    originalUrl: source.url,
    publisher: publisherForSource(source),
    accessedAt: source.fetchedAt,
    importedAt: nowIso,
    language: /[\u4e00-\u9fff]/u.test(source.text.slice(0, 800)) ? 'zh-CN' : 'en',
    reliability: isStrongSource ? 'high' : 'medium',
    reliabilityReason: usedSearchContentFallback
      ? `${source.reliabilityReason} 目标页直抓失败，本条只使用搜索服务返回的正文摘要，因此不能算强网页证据。`
      : source.reliabilityReason,
    sourcePolicyTags: [...new Set(['web_fetch', ...source.tags])],
    fingerprint: hashText(`${source.finalUrl}:${source.title}:${usedSearchContentFallback ? 'search_content_fallback' : 'fetched_page'}`),
    status: 'fetched',
    kind: isStrongSource ? 'web_strong' : 'web_weak'
  }
}

function publisherForSource(source: FetchedSeedSource): string {
  try {
    return new URL(source.finalUrl).hostname.replace(/^www\./, '')
  } catch {
    return source.publisher
  }
}

export async function collectModelText(
  stream: AsyncIterable<ModelStreamChunk>,
  signal: AbortSignal,
  onUsage?: (usage: ResearchModelUsageRecord['usage']) => void
): Promise<{ text: string; usage: ResearchModelUsageRecord['usage'][] }> {
  let text = ''
  let reasoningChars = 0
  let stopReason: 'stop' | 'tool_calls' | 'length' | 'error' | undefined
  const usage: ResearchModelUsageRecord['usage'][] = []
  for await (const chunk of stream) {
    if (signal.aborted) throw new Error('web extraction timed out')
    if (chunk.kind === 'assistant_text_delta') text += chunk.text
    if (chunk.kind === 'assistant_reasoning_delta') reasoningChars += chunk.text.length
    if (chunk.kind === 'completed') stopReason = chunk.stopReason
    if (chunk.kind === 'usage') {
      usage.push(chunk.usage)
      onUsage?.(chunk.usage)
    }
    if (chunk.kind === 'error') throw new Error(chunk.message)
  }
  if (!text.trim()) {
    const truncation = stopReason === 'length' || reasoningChars > 0
      ? `; output budget was consumed before JSON (${reasoningChars} reasoning chars, stop=${stopReason ?? 'unknown'})`
      : ''
    throw new Error(`web extraction returned empty text${truncation}`)
  }
  return { text, usage }
}

export function normalizeCards(value: unknown): WebExtractionCard[] {
  if (!Array.isArray(value)) return []
  return value.filter(isRecord) as WebExtractionCard[]
}

export function normalizeConflicts(value: unknown, claims: AtomicClaim[]): ConflictCandidate[] {
  if (!Array.isArray(value)) return []
  return value
    .filter(isRecord)
    .map((item, index) => {
      const claimIndexes = Array.isArray(item.claimIndexes) ? item.claimIndexes : []
      const claimIds = claimIndexes
        .map((candidate) => typeof candidate === 'number' ? candidate : Number(candidate))
        .filter((candidate) => Number.isInteger(candidate) && candidate >= 0 && candidate < claims.length)
        .map((candidate) => claims[candidate]?.id)
        .filter((candidate): candidate is string => Boolean(candidate))
      return {
        id: `conflict_${index + 1}`,
        claimIds,
        description: stringValue(item.description)
      }
    })
    .filter((item) => item.description)
    .slice(0, 6)
}

export function sourceIndexValue(value: unknown, sourceCount: number): number | undefined {
  const numeric = typeof value === 'number' ? value : typeof value === 'string' ? Number(value) : NaN
  return Number.isInteger(numeric) && numeric >= 1 && numeric <= sourceCount ? numeric : undefined
}

export function confidenceValue(value: unknown): ResearchConfidence {
  return value === 'high' || value === 'medium' || value === 'low' ? value : 'medium'
}

export function claimTypeValue(value: unknown): AtomicClaim['claimType'] {
  return value === 'fact'
    || value === 'metric'
    || value === 'date'
    || value === 'quote'
    || value === 'opinion'
    || value === 'inference'
    || value === 'recommendation'
    ? value
    : 'inference'
}

export function normalizeStringArray(value: unknown, limit: number): string[] {
  const values = Array.isArray(value) ? value : typeof value === 'string' ? value.split(/\n|；|;/) : []
  return values.map((item) => String(item).trim()).filter(Boolean).slice(0, limit)
}

export function stringValue(value: unknown): string {
  return typeof value === 'string' ? value.trim() : ''
}

export function booleanValue(value: unknown): boolean | undefined {
  if (typeof value === 'boolean') return value
  if (typeof value !== 'string') return undefined
  const normalized = value.trim().toLowerCase()
  if (['true', 'yes', '1', '是'].includes(normalized)) return true
  if (['false', 'no', '0', '否'].includes(normalized)) return false
  return undefined
}

export function excerptForSource(text: string): string {
  return normalizeWhitespace(text).slice(0, 500)
}

export function fitText(value: string, maxChars: number): string {
  if (value.length <= maxChars) return value
  return `${value.slice(0, maxChars)}\n\n[TRUNCATED ${value.length - maxChars} chars]`
}

export function extractReadableText(raw: string, contentType: string | undefined): { title?: string; text: string } {
  if (contentType?.toLowerCase().includes('json')) {
    const summarized = summarizeJsonSource(raw)
    if (summarized) return summarized
  }
  if (!contentType?.toLowerCase().includes('html')) {
    return { text: normalizeWhitespace(raw) }
  }
  const document = parse(raw) as unknown as HtmlNode
  const titleNode = findFirstElement(document, (node) => node.tagName === 'title')
  const title = titleNode ? readableNodeText(titleNode) : ''
  const contentCandidates = findElements(document, (node) =>
    node.tagName === 'article'
      || node.tagName === 'main'
      || node.attrs?.some((attribute) => attribute.name === 'role' && attribute.value === 'main') === true
  )
  const contentRoot = contentCandidates
    .map((node) => ({ node, text: readableNodeText(node) }))
    .sort((left, right) => right.text.length - left.text.length)[0]
  const body = findFirstElement(document, (node) => node.tagName === 'body') ?? document
  const text = contentRoot && contentRoot.text.length >= 300
    ? contentRoot.text
    : readableNodeText(body)
  return {
    ...(title ? { title: normalizeWhitespace(title) } : {}),
    text: normalizeReadableText(text)
  }
}

export function extractLinkedDocumentSeeds(
  rawHtml: string,
  pageUrl: string,
  parent: SeedSource,
  limit = 8
): SeedSource[] {
  let document: HtmlNode
  try {
    document = parse(rawHtml) as unknown as HtmlNode
  } catch {
    return []
  }

  const seen = new Set<string>()
  const linkedDocuments: SeedSource[] = []
  for (const anchor of findElements(document, (node) => node.tagName === 'a')) {
    const href = htmlAttribute(anchor, 'href')?.trim()
    if (!href) continue
    let target: URL
    try {
      target = new URL(href, pageUrl)
    } catch {
      continue
    }
    if (!['http:', 'https:'].includes(target.protocol) || !/\.pdf$/iu.test(target.pathname)) continue
    target.hash = ''
    const identity = target.toString()
    if (seen.has(identity)) continue
    seen.add(identity)

    const anchorText = normalizeWhitespace(readableNodeText(anchor))
    const filename = decodeURIComponent(target.pathname.split('/').at(-1) ?? 'document.pdf')
    linkedDocuments.push({
      url: identity,
      title: (anchorText || filename).slice(0, 240),
      publisher: target.hostname,
      reliabilityReason: `Direct document link discovered in the fetched page ${pageUrl}; authority remains subject to document-body verification.`,
      tags: [...new Set([
        ...parent.tags.filter((tag) => !['search_content_fallback', 'web_search_only', 'strong_web_evidence'].includes(tag)),
        'linked_document',
        'primary_material_candidate'
      ])]
    })
    if (linkedDocuments.length >= Math.max(1, limit)) break
  }
  return linkedDocuments
}

type HtmlNode = {
  nodeName?: string
  tagName?: string
  value?: string
  attrs?: Array<{ name: string; value: string }>
  childNodes?: HtmlNode[]
}

function htmlAttribute(node: HtmlNode, name: string): string | undefined {
  return node.attrs?.find((attribute) => attribute.name.toLowerCase() === name.toLowerCase())?.value
}

const SKIPPED_HTML_TAGS = new Set([
  'script', 'style', 'noscript', 'template', 'svg', 'canvas', 'nav', 'header', 'footer',
  'aside', 'form', 'button', 'dialog', 'menu'
])
const BLOCK_HTML_TAGS = new Set(['p', 'div', 'section', 'article', 'main', 'li', 'tr', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'blockquote', 'pre'])

function readableNodeText(node: HtmlNode): string {
  if (node.nodeName === '#text') return node.value ?? ''
  if (node.tagName && SKIPPED_HTML_TAGS.has(node.tagName)) return ''
  if (node.attrs?.some((attribute) =>
    (attribute.name === 'hidden')
      || (attribute.name === 'aria-hidden' && attribute.value === 'true')
  )) return ''
  const children = (node.childNodes ?? []).map(readableNodeText).join('')
  return node.tagName && BLOCK_HTML_TAGS.has(node.tagName) ? `\n${children}\n` : children
}

function normalizeReadableText(value: string): string {
  return value
    .split('\n')
    .map((line) => line.replace(/[\t\f\r ]+/g, ' ').trim())
    .filter(Boolean)
    .join('\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
}

function findElements(node: HtmlNode, predicate: (node: HtmlNode) => boolean): HtmlNode[] {
  const matches: HtmlNode[] = []
  if (predicate(node)) matches.push(node)
  for (const child of node.childNodes ?? []) matches.push(...findElements(child, predicate))
  return matches
}

function findFirstElement(node: HtmlNode, predicate: (node: HtmlNode) => boolean): HtmlNode | undefined {
  if (predicate(node)) return node
  for (const child of node.childNodes ?? []) {
    const match = findFirstElement(child, predicate)
    if (match) return match
  }
  return undefined
}

export function summarizeJsonSource(raw: string): { title?: string; text: string } | null {
  try {
    const parsed = JSON.parse(raw) as unknown
    const lines: string[] = []
    flattenJsonValue(parsed, '$', lines, 0)
    if (lines.length === 0) return null
    const title = isRecord(parsed)
      ? [parsed.title, parsed.name, parsed.label].find((value): value is string => typeof value === 'string' && value.trim().length > 0)
      : undefined
    return {
      ...(title ? { title: title.trim().slice(0, 240) } : {}),
      text: lines.join('\n')
    }
  } catch {
    return null
  }
}

function flattenJsonValue(value: unknown, path: string, lines: string[], depth: number): void {
  if (lines.length >= 500 || depth > 8 || value === null || typeof value === 'undefined') return
  if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') {
    const rendered = String(value).replace(/\s+/gu, ' ').trim()
    if (rendered) lines.push(`${path}: ${rendered.slice(0, 1_200)}`)
    return
  }
  if (Array.isArray(value)) {
    value.slice(0, 100).forEach((item, index) => flattenJsonValue(item, `${path}[${index}]`, lines, depth + 1))
    return
  }
  if (!isRecord(value)) return
  Object.entries(value).slice(0, 100).forEach(([key, item]) => {
    const safeKey = key.replace(/[\r\n]+/gu, ' ').trim().slice(0, 160)
    if (safeKey) flattenJsonValue(item, `${path}.${safeKey}`, lines, depth + 1)
  })
}

export function normalizeWhitespace(value: string): string {
  return value.replace(/\s+/g, ' ').trim()
}

export function decodeHtmlTextEntities(value: string): string {
  return value
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/gi, "'")
}

export function extractFirstJsonObject(raw: string): string | null {
  const start = raw.indexOf('{')
  const end = raw.lastIndexOf('}')
  return start >= 0 && end >= start ? raw.slice(start, end + 1) : null
}

export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
}
