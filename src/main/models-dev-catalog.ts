import {
  MAX_MODEL_CONTEXT_WINDOW_TOKENS,
  MAX_MODEL_OUTPUT_TOKENS,
  resolveModelProviderProxyUrl,
  type AppSettingsV1
} from '../shared/app-settings'
import type {
  ModelsDevCatalogMatchMode,
  ModelsDevCatalogMetadataIssue,
  ModelsDevCatalogModel,
  ModelsDevCatalogModality,
  ModelsDevCatalogPricing,
  ModelsDevCatalogRequest,
  ModelsDevCatalogResult,
  ModelsDevCatalogSource
} from '../shared/kun-gui-api'
import { fetchWithOptionalProxy } from './proxy-fetch'

export const MODELS_DEV_CATALOG_URL = 'https://models.dev/api.json'
// Fallback used when the public catalog is unreachable (network error, timeout,
// non-2xx status, oversized response, or invalid JSON). Kept in the same
// provider-map shape so parsing and matching can be shared.
export const KUN_AGENT_MODELS_URL = 'https://www.kun-agent.com/api/models'
export const MODELS_DEV_CACHE_TTL_MS = 6 * 60 * 60 * 1_000
// The public catalog is several megabytes and can take more than ten seconds
// to download on higher-latency connections. Model IDs are still useful when
// this request fails, but silently losing capability metadata leaves imported
// providers stuck on the default profile. Keep the request bounded while
// allowing enough time for the full catalog to arrive.
export const MODELS_DEV_TIMEOUT_MS = 30_000
// The fallback endpoint is first-party and expected to be fast; keep it short
// so a dead fallback does not double the worst-case wait.
export const KUN_AGENT_TIMEOUT_MS = 15_000
export const MODELS_DEV_MAX_RESPONSE_BYTES = 8 * 1024 * 1024

const MAX_PROVIDER_COUNT = 1_000
const MAX_MODEL_COUNT = 5_000
const MAX_MODEL_ID_LENGTH = 512
const MAX_MODEL_NAME_LENGTH = 256
const MAX_MODEL_DESCRIPTION_LENGTH = 2_000
const ALLOWED_MODALITIES = new Set<ModelsDevCatalogModality>([
  'text',
  'audio',
  'image',
  'video',
  'pdf'
])

type CatalogRoot = Record<string, unknown>
type ModelsDevFetch = typeof fetchWithOptionalProxy
type ModelsDevProviderMatch = {
  providerKey: string
  matchMode: ModelsDevCatalogMatchMode
}
type CatalogCache = {
  catalog: CatalogRoot
  source: ModelsDevCatalogSource
  etag?: string
  fetchedAt: number
}
type LoadedCatalog = {
  catalog: CatalogRoot
  source: ModelsDevCatalogSource
  stale: boolean
}
type CursorCatalogFamily = {
  providerKey: string
  pattern: RegExp
}

// Provider keys in the kun-agent.com catalog may differ from models.dev's.
// Map kun-agent-specific keys onto models.dev keys so the shared matching
// tables (PROFILE_MATCHES / URL matches) work unchanged. Fill entries in from
// the real endpoint response during integration testing; an empty table keeps
// the models.dev primary path byte-for-byte identical.
const KUN_AGENT_PROVIDER_ALIASES: Record<string, string> = {}

const PROFILE_MATCHES: Record<string, ModelsDevProviderMatch> = {
  deepseek: catalogMatch('deepseek'),
  longcat: catalogMatch('longcat'),
  'zhipu-coding-plan': catalogMatch('zhipuai-coding-plan'),
  'zai-coding-plan': catalogMatch('zai-coding-plan'),
  'kimi-code': catalogMatch('kimi-for-coding'),
  'opencode-go': catalogMatch('opencode-go'),
  'opencode-free': catalogMatch('opencode'),
  'moonshot-cn': catalogMatch('moonshotai-cn'),
  'moonshot-global': catalogMatch('moonshotai'),
  xiaomi: catalogMatch('xiaomi'),
  'tencentcloud-token-plan': catalogMatch('tencent-token-plan'),
  codex: catalogMatch('openai', 'enrichment-only'),
  'claude-subscription': catalogMatch('anthropic', 'enrichment-only'),
  'gemini-subscription': catalogMatch('google', 'enrichment-only'),
  'gemini-cli-subscription': catalogMatch('google', 'enrichment-only'),
  ollama: catalogMatch('ollama-cloud', 'enrichment-only'),
  'grok-subscription': catalogMatch('xai', 'enrichment-only'),
  'vercel-ai-gateway': catalogMatch('vercel')
}

const CURSOR_CATALOG_FAMILIES: readonly CursorCatalogFamily[] = [
  { providerKey: 'openai', pattern: /^(?:gpt(?:-|$)|chatgpt(?:-|$)|codex(?:-|$)|o[1-9](?:-|$))/i },
  { providerKey: 'anthropic', pattern: /^claude(?:-|$)/i },
  { providerKey: 'google', pattern: /^gemini(?:-|$)/i },
  { providerKey: 'xai', pattern: /^grok(?:-|$)/i },
  { providerKey: 'moonshotai', pattern: /^(?:kimi|moonshot)(?:-|$)/i }
]

const XIAOMI_TOKEN_PLAN_URLS = urlMatchMap({
  'https://token-plan-cn.xiaomimimo.com/v1': 'xiaomi-token-plan-cn',
  'https://token-plan-sgp.xiaomimimo.com/v1': 'xiaomi-token-plan-sgp',
  'https://token-plan-ams.xiaomimimo.com/v1': 'xiaomi-token-plan-ams'
})

const MINIMAX_URLS = urlMatchMap({
  'https://api.minimaxi.com/v1': 'minimax-cn',
  'https://api.minimaxi.com/v1/': 'minimax-cn',
  'https://api.minimax.io/v1': 'minimax',
  'https://api.minimax.io/v1/': 'minimax',
  'https://api.minimaxi.com/anthropic': 'minimax-cn',
  'https://api.minimaxi.com/anthropic/v1': 'minimax-cn',
  'https://api.minimax.io/anthropic': 'minimax',
  'https://api.minimax.io/anthropic/v1': 'minimax'
})

const MINIMAX_TOKEN_PLAN_URLS = urlMatchMap({
  'https://api.minimaxi.com/v1': 'minimax-cn-coding-plan',
  'https://api.minimaxi.com/v1/': 'minimax-cn-coding-plan',
  'https://api.minimax.io/v1': 'minimax-coding-plan',
  'https://api.minimax.io/v1/': 'minimax-coding-plan',
  'https://api.minimaxi.com/anthropic': 'minimax-cn-coding-plan',
  'https://api.minimaxi.com/anthropic/v1': 'minimax-cn-coding-plan',
  'https://api.minimax.io/anthropic': 'minimax-coding-plan',
  'https://api.minimax.io/anthropic/v1': 'minimax-coding-plan'
})

const ALIYUN_URLS = urlMatchMap({
  'https://dashscope.aliyuncs.com/compatible-mode/v1': 'alibaba-cn',
  'https://dashscope-intl.aliyuncs.com/compatible-mode/v1': 'alibaba'
})

const ALIYUN_TOKEN_PLAN_URLS = urlMatchMap({
  'https://token-plan.cn-beijing.maas.aliyuncs.com/compatible-mode/v1': 'alibaba-token-plan-cn',
  'https://token-plan.ap-southeast-1.maas.aliyuncs.com/compatible-mode/v1': 'alibaba-token-plan'
})

const ENRICHMENT_ONLY_URL_MATCHES = new Map<string, ModelsDevProviderMatch>([
  [
    normalizeCatalogBaseUrl('https://ollama.com/v1'),
    catalogMatch('ollama-cloud', 'enrichment-only')
  ]
])

// URL fallback is intentionally limited to unambiguous public endpoints.
// MiniMax exposes both OpenAI-compatible and Anthropic-compatible URLs for
// the regular API and Token Plan, so those entries require a known Kun profile
// id and are excluded here.
const UNAMBIGUOUS_URL_MATCHES = urlMatchMap({
  'https://api.deepseek.com': 'deepseek',
  'https://api.longcat.chat/openai': 'longcat',
  'https://open.bigmodel.cn/api/coding/paas/v4': 'zhipuai-coding-plan',
  'https://open.bigmodel.cn/api/coding/paas/v4/chat/completions': 'zhipuai-coding-plan',
  'https://api.z.ai/api/coding/paas/v4': 'zai-coding-plan',
  'https://api.z.ai/api/coding/paas/v4/chat/completions': 'zai-coding-plan',
  'https://api.kimi.com/coding/v1': 'kimi-for-coding',
  'https://opencode.ai/zen/go/v1': 'opencode-go',
  'https://opencode.ai/zen/v1': 'opencode',
  'https://api.moonshot.cn/v1': 'moonshotai-cn',
  'https://api.moonshot.ai/v1': 'moonshotai',
  'https://api.xiaomimimo.com/v1': 'xiaomi',
  'https://dashscope.aliyuncs.com/compatible-mode/v1': 'alibaba-cn',
  'https://dashscope-intl.aliyuncs.com/compatible-mode/v1': 'alibaba',
  'https://api.lkeap.cloud.tencent.com/plan/v3': 'tencent-token-plan',
  'https://ai-gateway.vercel.sh/v1': 'vercel',
  'https://token-plan-cn.xiaomimimo.com/v1': 'xiaomi-token-plan-cn',
  'https://token-plan-sgp.xiaomimimo.com/v1': 'xiaomi-token-plan-sgp',
  'https://token-plan-ams.xiaomimimo.com/v1': 'xiaomi-token-plan-ams',
  'https://token-plan.cn-beijing.maas.aliyuncs.com/compatible-mode/v1': 'alibaba-token-plan-cn',
  'https://token-plan.ap-southeast-1.maas.aliyuncs.com/compatible-mode/v1': 'alibaba-token-plan'
})

function catalogMatch(
  providerKey: string,
  matchMode: ModelsDevCatalogMatchMode = 'catalog'
): ModelsDevProviderMatch {
  return { providerKey, matchMode }
}

function urlMatchMap(entries: Record<string, string>): Map<string, ModelsDevProviderMatch> {
  return new Map(
    Object.entries(entries).map(([url, providerKey]) => [
      normalizeCatalogBaseUrl(url),
      catalogMatch(providerKey)
    ])
  )
}

export function normalizeCatalogBaseUrl(value: string): string {
  try {
    const url = new URL(value.trim())
    if (url.protocol !== 'http:' && url.protocol !== 'https:') return ''
    url.hash = ''
    url.search = ''
    url.pathname = url.pathname.replace(/\/+$/, '') || '/'
    return url.toString().replace(/\/$/, '')
  } catch {
    return ''
  }
}

export function resolveModelsDevProvider(
  request: ModelsDevCatalogRequest
): ModelsDevProviderMatch | null {
  const providerId = request.providerId.trim().toLowerCase()
  const baseUrl = normalizeCatalogBaseUrl(request.baseUrl)

  if (providerId === 'xiaomi-token-plan') {
    return XIAOMI_TOKEN_PLAN_URLS.get(baseUrl) ?? null
  }
  if (providerId === 'minimax') {
    return MINIMAX_URLS.get(baseUrl) ?? null
  }
  if (providerId === 'minimax-token-plan') {
    return MINIMAX_TOKEN_PLAN_URLS.get(baseUrl) ?? null
  }
  if (providerId === 'aliyun') {
    return ALIYUN_URLS.get(baseUrl) ?? null
  }
  if (providerId === 'aliyun-token-plan') {
    return ALIYUN_TOKEN_PLAN_URLS.get(baseUrl) ?? null
  }

  return PROFILE_MATCHES[providerId]
    ?? ENRICHMENT_ONLY_URL_MATCHES.get(baseUrl)
    ?? UNAMBIGUOUS_URL_MATCHES.get(baseUrl)
    ?? null
}

export class ModelsDevCatalogService {
  private cache: CatalogCache | null = null
  private inFlight: Promise<LoadedCatalog> | null = null

  constructor(
    private readonly fetcher: ModelsDevFetch = fetchWithOptionalProxy,
    private readonly now: () => number = Date.now
  ) {}

  async fetch(
    request: ModelsDevCatalogRequest,
    settings?: AppSettingsV1
  ): Promise<ModelsDevCatalogResult> {
    let match = resolveModelsDevProvider(request)
    const normalizedBaseUrl = normalizeCatalogBaseUrl(request.baseUrl)
    const cursorMixedCatalog = request.providerId.trim().toLowerCase() === 'cursor-subscription'
    if (!match && !normalizedBaseUrl && !cursorMixedCatalog) {
      return { status: 'unmapped', models: [] }
    }

    try {
      const proxyUrl = settings ? resolveModelProviderProxyUrl(settings) : ''
      const loaded = await this.loadCatalog(proxyUrl, request.forceRefresh === true)
      if (cursorMixedCatalog) {
        return {
          status: 'ok',
          providerKey: 'cursor-mixed',
          providerName: 'Cursor',
          matchMode: 'enrichment-only',
          stale: loaded.stale,
          source: loaded.source,
          models: resolveCursorModelsDevCatalog(loaded.catalog, request.modelHints ?? [])
        }
      }
      match ??= resolveUniqueCatalogApiMatch(loaded.catalog, normalizedBaseUrl)
      if (!match) return { status: 'unmapped', models: [] }
      const provider = sanitizeProvider(loaded.catalog[match.providerKey])
      if (!provider) {
        return {
          status: 'error',
          message: `${catalogSourceLabel(loaded.source)} did not contain the mapped provider "${match.providerKey}".`,
          models: []
        }
      }
      return {
        status: 'ok',
        providerKey: match.providerKey,
        providerName: provider.name,
        matchMode: match.matchMode,
        stale: loaded.stale,
        source: loaded.source,
        models: provider.models
      }
    } catch (error) {
      return {
        status: 'error',
        message: modelsDevFailureMessage(error),
        models: []
      }
    }
  }

  clearCache(): void {
    this.cache = null
    this.inFlight = null
  }

  private async loadCatalog(proxyUrl: string, forceRefresh: boolean): Promise<LoadedCatalog> {
    const cached = this.cache
    if (!forceRefresh && cached && this.now() - cached.fetchedAt < MODELS_DEV_CACHE_TTL_MS) {
      return { catalog: cached.catalog, source: cached.source, stale: false }
    }
    if (this.inFlight) return this.inFlight

    this.inFlight = this.refreshCatalog(proxyUrl).finally(() => {
      this.inFlight = null
    })
    return this.inFlight
  }

  private async refreshCatalog(proxyUrl: string): Promise<LoadedCatalog> {
    const cached = this.cache
    const attempts: ReadonlyArray<{
      source: ModelsDevCatalogSource
      url: string
      timeoutMs: number
    }> = [
      { source: 'models.dev', url: MODELS_DEV_CATALOG_URL, timeoutMs: MODELS_DEV_TIMEOUT_MS },
      { source: 'kun-agent', url: KUN_AGENT_MODELS_URL, timeoutMs: KUN_AGENT_TIMEOUT_MS }
    ]
    let lastError: unknown
    for (const attempt of attempts) {
      try {
        return await this.fetchSource(attempt, cached, proxyUrl)
      } catch (error) {
        lastError = error
      }
    }
    if (cached) return { catalog: cached.catalog, source: cached.source, stale: true }
    throw new Error(
      `models.dev and the kun-agent.com fallback both failed: ${modelsDevFailureMessage(lastError)}`
    )
  }

  private async fetchSource(
    attempt: { source: ModelsDevCatalogSource; url: string; timeoutMs: number },
    cached: CatalogCache | null,
    proxyUrl: string
  ): Promise<LoadedCatalog> {
    const { source, url, timeoutMs } = attempt
    const headers: Record<string, string> = { Accept: 'application/json' }
    if (cached?.source === source && cached.etag) headers['If-None-Match'] = cached.etag
    let response: Response
    try {
      response = await this.fetcher(url, {
        method: 'GET',
        headers,
        signal: AbortSignal.timeout(timeoutMs)
      }, proxyUrl)
    } catch (error) {
      if (error instanceof Error && error.name === 'TimeoutError') {
        throw new Error(
          `Request to ${catalogSourceLabel(source)} timed out after ${timeoutMs / 1_000}s.`
        )
      }
      throw error
    }

    if (response.status === 304 && cached?.source === source) {
      this.cache = { ...cached, fetchedAt: this.now() }
      await response.body?.cancel().catch(() => undefined)
      return { catalog: cached.catalog, source, stale: false }
    }

    const body = await readBoundedResponseText(response, MODELS_DEV_MAX_RESPONSE_BYTES)
    if (body.truncated) {
      throw new Error(
        `${catalogSourceLabel(source)} response exceeded the ${MODELS_DEV_MAX_RESPONSE_BYTES} byte limit.`
      )
    }
    if (!response.ok) {
      throw new Error(
        `${catalogSourceLabel(source)} responded ${response.status}: ${body.text.slice(0, 300)}`
      )
    }
    const catalog = normalizeCatalogKeys(
      parseCatalog(body.text, source),
      source === 'kun-agent' ? KUN_AGENT_PROVIDER_ALIASES : {}
    )
    this.cache = {
      catalog,
      source,
      fetchedAt: this.now(),
      ...(response.headers.get('etag')
        ? { etag: response.headers.get('etag') ?? undefined }
        : {})
    }
    return { catalog, source, stale: false }
  }
}

export function resolveCursorModelsDevCatalog(
  catalog: CatalogRoot,
  hints: readonly { id: string; aliases?: readonly string[] }[]
): ModelsDevCatalogModel[] {
  const providers = new Map<string, Map<string, ModelsDevCatalogModel>>()
  const resolved: ModelsDevCatalogModel[] = []
  const seen = new Set<string>()

  for (const hint of hints.slice(0, MAX_MODEL_COUNT)) {
    const id = boundedString(hint.id, MAX_MODEL_ID_LENGTH)?.trim()
    const key = id?.toLowerCase() ?? ''
    if (!id || !key || seen.has(key)) continue
    seen.add(key)

    const family = CURSOR_CATALOG_FAMILIES.find((candidate) => candidate.pattern.test(id))
    if (!family) continue
    let providerModels = providers.get(family.providerKey)
    if (!providerModels) {
      const provider = sanitizeProvider(catalog[family.providerKey])
      if (!provider) continue
      providerModels = new Map(
        provider.models.map((model) => [model.id.trim().toLowerCase(), model] as const)
      )
      providers.set(family.providerKey, providerModels)
    }

    const candidateIds = [id, ...(hint.aliases ?? [])]
      .map((candidate) => boundedString(candidate, MAX_MODEL_ID_LENGTH)?.trim())
      .filter((candidate): candidate is string => Boolean(candidate))
    const catalogModel = candidateIds
      .map((candidate) => providerModels?.get(candidate.toLowerCase()))
      .find((candidate): candidate is ModelsDevCatalogModel => Boolean(candidate))
    if (!catalogModel) continue
    resolved.push({
      ...catalogModel,
      id,
      providerKey: family.providerKey
    })
  }

  return resolved
}

function resolveUniqueCatalogApiMatch(
  catalog: CatalogRoot,
  normalizedBaseUrl: string
): ModelsDevProviderMatch | null {
  if (!normalizedBaseUrl) return null
  const matches: string[] = []
  for (const [providerKey, rawProvider] of Object.entries(catalog)) {
    if (!isRecord(rawProvider) || typeof rawProvider.api !== 'string') continue
    if (normalizeCatalogBaseUrl(rawProvider.api) !== normalizedBaseUrl) continue
    matches.push(providerKey)
    if (matches.length > 1) return null
  }
  return matches.length === 1 ? catalogMatch(matches[0]) : null
}

const modelsDevCatalogService = new ModelsDevCatalogService()

export function fetchModelsDevCatalog(
  request: ModelsDevCatalogRequest,
  settings?: AppSettingsV1
): Promise<ModelsDevCatalogResult> {
  return modelsDevCatalogService.fetch(request, settings)
}

export function normalizeCatalogKeys(
  catalog: CatalogRoot,
  aliases: Readonly<Record<string, string>>
): CatalogRoot {
  if (Object.keys(aliases).length === 0) return catalog
  const normalized: CatalogRoot = {}
  for (const [key, provider] of Object.entries(catalog)) {
    const target = aliases[key]?.trim()
    normalized[target && target !== key ? target : key] = provider
  }
  return normalized
}

function parseCatalog(body: string, source: ModelsDevCatalogSource): CatalogRoot {
  let parsed: unknown
  try {
    parsed = JSON.parse(body) as unknown
  } catch {
    throw new Error(`${catalogSourceLabel(source)} returned invalid JSON.`)
  }
  if (!isRecord(parsed)) throw new Error(`${catalogSourceLabel(source)} returned an invalid catalog.`)
  const entries = Object.entries(parsed)
  if (entries.length > MAX_PROVIDER_COUNT) {
    throw new Error(
      `${catalogSourceLabel(source)} catalog exceeded the ${MAX_PROVIDER_COUNT} provider limit.`
    )
  }
  return Object.fromEntries(entries)
}

function sanitizeProvider(value: unknown): { name: string; models: ModelsDevCatalogModel[] } | null {
  if (!isRecord(value) || !isRecord(value.models)) return null
  const rawModels = Object.entries(value.models)
  if (rawModels.length > MAX_MODEL_COUNT) return null
  const models: ModelsDevCatalogModel[] = []
  const seen = new Set<string>()
  for (const [fallbackId, rawModel] of rawModels) {
    const model = sanitizeModel(fallbackId, rawModel)
    if (!model) continue
    const key = model.id.toLowerCase()
    if (seen.has(key)) continue
    seen.add(key)
    models.push(model)
  }
  return {
    name: boundedString(value.name, MAX_MODEL_NAME_LENGTH) ?? boundedString(value.id, MAX_MODEL_NAME_LENGTH) ?? '',
    models
  }
}

function sanitizeModel(fallbackId: string, value: unknown): ModelsDevCatalogModel | null {
  if (!isRecord(value)) return null
  const id = (boundedString(value.id, MAX_MODEL_ID_LENGTH)
    ?? boundedString(fallbackId, MAX_MODEL_ID_LENGTH))?.trim()
  if (!id) return null
  const name = boundedString(value.name, MAX_MODEL_NAME_LENGTH)
  const description = boundedString(value.description, MAX_MODEL_DESCRIPTION_LENGTH)
  const modalities = isRecord(value.modalities) ? value.modalities : {}
  const limit = isRecord(value.limit) ? value.limit : {}
  const cost = isRecord(value.cost) ? value.cost : {}
  const free = cost.input === 0 && cost.output === 0
  const pricing = sanitizeCatalogPricing(cost)
  const reasoning = typeof value.reasoning === 'boolean' ? value.reasoning : undefined
  const toolCalling = typeof value.tool_call === 'boolean' ? value.tool_call : undefined
  const metadataIssues: ModelsDevCatalogMetadataIssue[] = []
  const contextWindowTokens = boundedCatalogLimit(
    limit.context,
    'contextWindowTokens',
    MAX_MODEL_CONTEXT_WINDOW_TOKENS,
    metadataIssues
  )
  const maxOutputTokens = boundedCatalogLimit(
    limit.output,
    'maxOutputTokens',
    MAX_MODEL_OUTPUT_TOKENS,
    metadataIssues
  )
  return {
    id,
    ...(name ? { name } : {}),
    ...(description ? { description } : {}),
    inputModalities: sanitizeModalities(modalities.input),
    outputModalities: sanitizeModalities(modalities.output),
    ...(reasoning !== undefined ? { reasoning } : {}),
    ...(toolCalling !== undefined ? { toolCalling } : {}),
    ...(free ? { free } : {}),
    ...(pricing ? { pricing } : {}),
    ...(contextWindowTokens ? { contextWindowTokens } : {}),
    ...(maxOutputTokens ? { maxOutputTokens } : {}),
    ...(metadataIssues.length ? { metadataIssues } : {})
  }
}

/**
 * Parses models.dev cost fields (USD per million tokens). Pricing requires a
 * finite non-negative input and output price; cache prices stay optional.
 */
function sanitizeCatalogPricing(
  cost: Record<string, unknown>
): ModelsDevCatalogPricing | undefined {
  const input = nonNegativeFiniteCost(cost.input)
  const output = nonNegativeFiniteCost(cost.output)
  if (input == null || output == null) return undefined
  const cacheRead = nonNegativeFiniteCost(cost.cache_read)
  const cacheWrite = nonNegativeFiniteCost(cost.cache_write)
  return {
    inputUsdPerMillion: input,
    outputUsdPerMillion: output,
    ...(cacheRead != null ? { cacheReadUsdPerMillion: cacheRead } : {}),
    ...(cacheWrite != null ? { cacheWriteUsdPerMillion: cacheWrite } : {})
  }
}

function nonNegativeFiniteCost(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0 ? value : undefined
}

function sanitizeModalities(value: unknown): ModelsDevCatalogModality[] {
  if (!Array.isArray(value)) return []
  const out: ModelsDevCatalogModality[] = []
  for (const item of value) {
    if (typeof item !== 'string') continue
    const modality = item.trim().toLowerCase() as ModelsDevCatalogModality
    if (ALLOWED_MODALITIES.has(modality) && !out.includes(modality)) out.push(modality)
  }
  return out
}

function boundedCatalogLimit(
  value: unknown,
  field: ModelsDevCatalogMetadataIssue['field'],
  maxAllowed: number,
  issues: ModelsDevCatalogMetadataIssue[]
): number | undefined {
  if (typeof value !== 'number' || !Number.isSafeInteger(value)) return undefined
  if (value > 0 && value <= maxAllowed) return value
  issues.push({ field, code: 'out_of_range', rawValue: value, maxAllowed })
  return undefined
}

function boundedString(value: unknown, maxLength: number): string | undefined {
  if (typeof value !== 'string') return undefined
  const normalized = value.trim()
  return normalized && normalized.length <= maxLength ? normalized : undefined
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value)
}

function catalogSourceLabel(source: ModelsDevCatalogSource): string {
  return source === 'models.dev' ? 'models.dev' : 'kun-agent.com'
}

function modelsDevFailureMessage(error: unknown): string {
  if (error instanceof Error && error.name === 'TimeoutError') {
    return `Request to models.dev timed out after ${MODELS_DEV_TIMEOUT_MS / 1_000}s.`
  }
  return error instanceof Error ? error.message : String(error)
}

async function readBoundedResponseText(
  response: Response,
  maxBytes: number
): Promise<{ text: string; truncated: boolean }> {
  const contentLength = Number(response.headers.get('content-length'))
  if (Number.isFinite(contentLength) && contentLength > maxBytes) {
    await response.body?.cancel().catch(() => undefined)
    return { text: '', truncated: true }
  }
  if (!response.body) {
    const text = await response.text()
    return { text, truncated: new TextEncoder().encode(text).byteLength > maxBytes }
  }
  const reader = response.body.getReader()
  const chunks: Uint8Array[] = []
  let totalBytes = 0
  try {
    while (true) {
      const next = await reader.read()
      if (next.done) break
      if (!next.value) continue
      totalBytes += next.value.byteLength
      if (totalBytes > maxBytes) {
        await reader.cancel().catch(() => undefined)
        return { text: '', truncated: true }
      }
      chunks.push(next.value)
    }
  } finally {
    reader.releaseLock()
  }
  const bytes = new Uint8Array(totalBytes)
  let offset = 0
  for (const chunk of chunks) {
    bytes.set(chunk, offset)
    offset += chunk.byteLength
  }
  return { text: new TextDecoder().decode(bytes), truncated: false }
}
