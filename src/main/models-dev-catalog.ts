import { mkdir, readFile, rename, writeFile } from 'node:fs/promises'
import { dirname } from 'node:path'
import {
  getModelProviderSettings,
  resolveModelProviderProxyUrl,
  type AppSettingsV1
} from '../shared/app-settings'
import type {
  ModelsDevCatalogMatchMode,
  ModelsDevCatalogRequest,
  ModelsDevCatalogResult,
  ModelsDevCatalogSource
} from '../shared/kun-gui-api'
import { fetchWithOptionalProxy } from './proxy-fetch'
import {
  catalogSourceLabel,
  isRecord,
  normalizeCatalogKeys,
  parseCatalog,
  sanitizeProvider,
  type CatalogRoot
} from './models-dev-catalog-sanitize'
import {
  resolveCursorModelsDevCatalog,
  resolveFamilyModelsDevCatalog
} from './models-dev-catalog-families'

export { normalizeCatalogKeys } from './models-dev-catalog-sanitize'
export {
  resolveCursorModelsDevCatalog,
  resolveFamilyModelsDevCatalog
} from './models-dev-catalog-families'

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
  stepfun: catalogMatch('stepfun'),
  'stepfun-token-plan': catalogMatch('stepfun-step-plan'),
  codex: catalogMatch('openai', 'enrichment-only'),
  'claude-subscription': catalogMatch('anthropic', 'enrichment-only'),
  'gemini-subscription': catalogMatch('google', 'enrichment-only'),
  'gemini-cli-subscription': catalogMatch('google', 'enrichment-only'),
  ollama: catalogMatch('ollama-cloud', 'enrichment-only'),
  'grok-subscription': catalogMatch('xai', 'enrichment-only'),
  opper: catalogMatch('opper'),
  'vercel-ai-gateway': catalogMatch('vercel')
}
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
  'https://api.opper.ai/v3/compat': 'opper',
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
  private diskCachePath: string | null = null
  private diskLoaded = false

  constructor(
    private readonly fetcher: ModelsDevFetch = fetchWithOptionalProxy,
    private readonly now: () => number = Date.now,
    diskCachePath?: string
  ) {
    this.diskCachePath = diskCachePath ?? null
  }

  /**
   * Disk persistence (`userData/cache/models-dev.json`): the last successful
   * catalog (with etag and fetchedAt) survives restarts, so startup shows
   * catalog metadata immediately and offline launches reuse the last fetch.
   * The in-memory TTL still governs background refreshes; a failed refresh
   * falls back to the disk-seeded cache marked stale.
   */
  attachDiskCache(path: string): void {
    this.diskCachePath = path
  }

  private async loadDiskCache(): Promise<void> {
    if (this.diskLoaded) return
    this.diskLoaded = true
    if (!this.diskCachePath || this.cache) return
    try {
      const parsed = JSON.parse(await readFile(this.diskCachePath, 'utf8')) as Partial<CatalogCache>
      if (
        !parsed || typeof parsed !== 'object' ||
        !isRecord(parsed.catalog) ||
        (parsed.source !== 'models.dev' && parsed.source !== 'kun-agent') ||
        typeof parsed.fetchedAt !== 'number'
      ) return
      this.cache = {
        catalog: parsed.catalog,
        source: parsed.source,
        fetchedAt: parsed.fetchedAt,
        ...(typeof parsed.etag === 'string' ? { etag: parsed.etag } : {})
      }
    } catch {
      // Missing or corrupt cache file is fine — the next refresh rewrites it.
    }
  }

  private persistDiskCache(): void {
    const path = this.diskCachePath
    const cache = this.cache
    if (!path || !cache) return
    void (async () => {
      try {
        await mkdir(dirname(path), { recursive: true })
        // Write-then-rename keeps readers from observing a torn cache file
        // when a background refresh overlaps an earlier persist.
        const tmp = `${path}.tmp`
        await writeFile(tmp, JSON.stringify({
          catalog: cache.catalog,
          source: cache.source,
          fetchedAt: cache.fetchedAt,
          ...(cache.etag ? { etag: cache.etag } : {})
        }), 'utf8')
        await rename(tmp, path)
      } catch {
        // Cache persistence is best-effort; never fail a catalog fetch on it.
      }
    })()
  }

  async fetch(
    request: ModelsDevCatalogRequest,
    settings?: AppSettingsV1
  ): Promise<ModelsDevCatalogResult> {
    let match = resolveModelsDevProvider(request)
    const normalizedBaseUrl = normalizeCatalogBaseUrl(request.baseUrl)
    const cursorMixedCatalog = request.providerId.trim().toLowerCase() === 'cursor-subscription'
    if (!match && !normalizedBaseUrl && !cursorMixedCatalog && !(request.modelHints?.length)) {
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
      // Profile-declared catalog sources take precedence over host matching:
      // relays commonly re-expose an upstream catalog under a custom host.
      const declaredSources = catalogSourcesForRequest(request, settings)
      for (const source of declaredSources) {
        if (match) break
        if (sanitizeProvider(loaded.catalog[source])) match = catalogMatch(source)
      }
      match ??= resolveUniqueCatalogApiMatch(loaded.catalog, normalizedBaseUrl)
      if (!match) {
        // Completion-only family enrichment for unmapped custom/relay
        // providers: known model families borrow catalog metadata without
        // adding models the provider did not report.
        const familyModels = resolveFamilyModelsDevCatalog(loaded.catalog, request.modelHints ?? [])
        if (familyModels.length === 0) return { status: 'unmapped', models: [] }
        return {
          status: 'ok',
          providerKey: 'family-mixed',
          providerName: '',
          matchMode: 'enrichment-only',
          stale: loaded.stale,
          source: loaded.source,
          models: familyModels
        }
      }
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
    await this.loadDiskCache()
    const cached = this.cache
    if (!forceRefresh && cached && this.now() - cached.fetchedAt < MODELS_DEV_CACHE_TTL_MS) {
      return { catalog: cached.catalog, source: cached.source, stale: false }
    }
    // A stale but present cache answers immediately; the refresh continues in
    // the background so callers never block on a slow network. Only an empty
    // cache (or an explicit forceRefresh) waits on the wire.
    if (!forceRefresh && cached) {
      this.inFlight ??= this.refreshCatalog(proxyUrl).finally(() => {
        this.inFlight = null
      })
      void this.inFlight.catch(() => undefined)
      return { catalog: cached.catalog, source: cached.source, stale: true }
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
      this.persistDiskCache()
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
    this.persistDiskCache()
    return { catalog, source, stale: false }
  }
}

function catalogSourcesForRequest(
  request: ModelsDevCatalogRequest,
  settings?: AppSettingsV1
): string[] {
  const providerId = request.providerId.trim()
  if (!providerId || !settings) return []
  const profile = getModelProviderSettings(settings).providers.find(
    (candidate) => candidate.id === providerId
  )
  return (profile?.catalogSources ?? [])
    .map((source) => source.trim())
    .filter((source) => source.length > 0 && source.length <= 128)
    .slice(0, 8)
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

export function attachModelsDevDiskCache(path: string): void {
  modelsDevCatalogService.attachDiskCache(path)
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