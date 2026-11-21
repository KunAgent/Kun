import type { ServeProviderConfig } from '../../config/kun-config-application.js'
import type { WebFetchRequest, WebFetchResult, WebProvider, WebSearchRequest, WebSearchResult } from '../../ports/web-provider.js'
import { sourceIdFor } from '../../ports/web-provider.js'
import type { KunServeRuntimeOptions } from '../../server/runtime-factory-types.js'
import { createProxyFetch } from '../model/proxy-fetch.js'
import type { ProviderCredentialResolver } from './image-gen-tool-provider.js'

const DEFAULT_DEEPSEEK_API_BASE_URL = 'https://api.deepseek.com'

export type DeepSeekWebAuth = {
  baseUrl: string
  apiKey: string
  headers?: Record<string, string>
  proxyUrl?: string
}

export type DeepSeekWebProviderOptions = {
  resolveAuth: () => Promise<DeepSeekWebAuth | undefined>
  fallbackFetch?: WebProvider
  nowIso?: () => string
  fetchImpl?: typeof fetch
}

export function resolveDeepSeekToolsEndpointUrl(
  baseUrl: string,
  toolName: 'search' | 'fetch'
): string {
  const parsed = new URL(baseUrl.trim() || DEFAULT_DEEPSEEK_API_BASE_URL)
  // Official tools are independent of the configured model endpoint.
  const root = isOfficialDeepSeekUrl(parsed.origin)
    ? ''
    : parsed.pathname.replace(/\/+$/, '').replace(/\/(?:v1|beta)$/i, '')
  parsed.pathname = `${root}/v1/tools/${toolName}`
  parsed.hash = ''
  return parsed.toString()
}

export class DeepSeekWebProvider implements WebProvider {
  readonly id = 'deepseek'
  private readonly resolveAuth: () => Promise<DeepSeekWebAuth | undefined>
  private readonly fallbackFetch?: WebProvider
  private readonly nowIso: () => string
  private readonly fetchImpl?: typeof fetch

  constructor(options: DeepSeekWebProviderOptions) {
    this.resolveAuth = options.resolveAuth
    this.fallbackFetch = options.fallbackFetch
    this.nowIso = options.nowIso ?? (() => new Date().toISOString())
    this.fetchImpl = options.fetchImpl
  }

  async search(request: WebSearchRequest): Promise<WebSearchResult[]> {
    const auth = await this.resolveAuth()
    const apiKey = auth?.apiKey?.trim()
    if (!auth || !apiKey) {
      throw new Error('DeepSeek API key is unavailable for web search')
    }
    const fetchFn = this.fetchImpl ?? createProxyFetch(auth.proxyUrl ?? '') ?? fetch
    const endpointUrl = resolveDeepSeekToolsEndpointUrl(auth.baseUrl, 'search')
    const { signal, cleanup } = combineAbortSignal(request.signal, request.timeoutMs)
    try {
      const response = await fetchFn(endpointUrl, {
        method: 'POST',
        headers: {
          ...(auth.headers ?? {}),
          authorization: `Bearer ${apiKey}`,
          'content-type': 'application/json'
        },
        body: JSON.stringify({
          query: request.query,
          count: request.limit,
          need_content: false
        }),
        signal
      })
      if (!response.ok) {
        throw new Error(`DeepSeek web search failed (HTTP ${response.status})`)
      }
      const payload = await response.json() as {
        results?: Array<{
          title?: unknown
          url?: unknown
          snippet?: unknown
          summary?: unknown
          content?: unknown
        }>
      }
      const rawResults = Array.isArray(payload?.results) ? payload.results : []
      const retrievedAt = this.nowIso()
      const mapped: WebSearchResult[] = []
      for (const item of rawResults) {
        if (mapped.length >= request.limit) break
        const url = pickNonEmptyString(item?.url)
        if (!url) continue
        const index = mapped.length
        const title = pickNonEmptyString(item?.title)
        const snippet = pickNonEmptyString(item?.snippet, item?.summary, item?.content) ?? ''
        mapped.push({
          sourceId: sourceIdFor('search', `${request.query}:${url}:${index}`),
          url,
          ...(title ? { title } : {}),
          snippet,
          retrievedAt,
          provider: this.id,
          rank: index + 1
        })
      }
      return mapped
    } finally {
      cleanup()
    }
  }

  async fetch(request: WebFetchRequest): Promise<WebFetchResult> {
    let fetchError: unknown
    const auth = await this.resolveAuth()
    const apiKey = auth?.apiKey?.trim()
    if (auth && apiKey) {
      const fetchFn = this.fetchImpl ?? createProxyFetch(auth.proxyUrl ?? '') ?? fetch
      const endpointUrl = resolveDeepSeekToolsEndpointUrl(auth.baseUrl, 'fetch')
      const { signal, cleanup } = combineAbortSignal(request.signal, request.timeoutMs)
      try {
        const response = await fetchFn(endpointUrl, {
          method: 'POST',
          headers: {
            ...(auth.headers ?? {}),
            authorization: `Bearer ${apiKey}`,
            'content-type': 'application/json'
          },
          body: JSON.stringify({ url: request.url }),
          signal
        })
        if (!response.ok) {
          throw new Error(`DeepSeek web fetch failed (HTTP ${response.status})`)
        }
        const payload = await response.json() as {
          url?: unknown
          final_url?: unknown
          title?: unknown
          markdown?: unknown
          content?: unknown
          text?: unknown
        }
        const rawText = pickNonEmptyString(payload?.markdown, payload?.content, payload?.text)
        if (rawText) {
          const finalUrl = pickNonEmptyString(payload?.final_url, payload?.url) ?? request.url
          const title = pickNonEmptyString(payload?.title)
          const fullBytes = Buffer.from(rawText, 'utf8')
          const truncated = fullBytes.length > request.maxBytes
          const text = truncated
            ? fullBytes.subarray(0, request.maxBytes).toString('utf8')
            : rawText
          const byteCount = Buffer.byteLength(text, 'utf8')
          return {
            sourceId: sourceIdFor('fetch', finalUrl),
            url: request.url,
            finalUrl,
            ...(title ? { title } : {}),
            contentType: 'text/markdown',
            text,
            retrievedAt: this.nowIso(),
            byteCount,
            truncated
          }
        }
      } catch (error) {
        if (request.signal.aborted) throw error
        fetchError = error
      } finally {
        cleanup()
      }
    }

    if (this.fallbackFetch?.fetch) {
      return this.fallbackFetch.fetch(request)
    }
    if (fetchError !== undefined) {
      throw fetchError
    }
    throw new Error('DeepSeek web fetch returned empty content')
  }
}

export function resolveDeepSeekWebProvider(input: {
  runtimeOptions?: () => KunServeRuntimeOptions | undefined
  resolveCredential?: ProviderCredentialResolver
  fallbackFetch?: WebProvider
  nowIso?: () => string
  fetchImpl?: typeof fetch
  preferredProvider?: string
}): DeepSeekWebProvider | undefined {
  if (input.preferredProvider && input.preferredProvider !== 'deepseek' && input.preferredProvider !== 'default') {
    return undefined
  }
  const initialOptions = input.runtimeOptions?.()
  if (!initialOptions) return undefined
  const initialMatch = selectDeepSeekCandidate(initialOptions, Boolean(input.resolveCredential))
  if (!initialMatch) return undefined

  return new DeepSeekWebProvider({
    fallbackFetch: input.fallbackFetch,
    nowIso: input.nowIso,
    fetchImpl: input.fetchImpl,
    resolveAuth: async () => {
      const currentOptions = input.runtimeOptions?.() ?? initialOptions
      const match = selectDeepSeekCandidate(currentOptions, Boolean(input.resolveCredential))
      if (!match) return undefined
      if (match.kind === 'root') {
        const apiKey = currentOptions.apiKey?.trim() ?? ''
        if (!apiKey) return undefined
        return {
          baseUrl: currentOptions.baseUrl?.trim() || DEFAULT_DEEPSEEK_API_BASE_URL,
          apiKey,
          ...(currentOptions.headers ? { headers: currentOptions.headers } : {}),
          ...(currentOptions.modelProxyUrl ? { proxyUrl: currentOptions.modelProxyUrl } : {})
        }
      }

      const { providerId, config } = match
      let apiKey = config.apiKey?.trim() ?? ''
      let headers = config.headers
      let proxyUrl = config.modelProxyUrl ?? currentOptions.modelProxyUrl
      if (input.resolveCredential) {
        try {
          const resolved = await input.resolveCredential(providerId)
          if (resolved.apiKey.trim()) {
            apiKey = resolved.apiKey.trim()
          }
          if (resolved.headers) {
            headers = { ...(headers ?? {}), ...resolved.headers }
          }
          if (resolved.proxyUrl) {
            proxyUrl = resolved.proxyUrl
          }
        } catch {
          // Fallback to inline apiKey on provider config when credential lookup fails.
        }
      }
      if (!apiKey) return undefined
      return {
        baseUrl: config.baseUrl?.trim() || DEFAULT_DEEPSEEK_API_BASE_URL,
        apiKey,
        ...(headers ? { headers } : {}),
        ...(proxyUrl ? { proxyUrl } : {})
      }
    }
  })
}

type DeepSeekCandidateMatch =
  | { kind: 'provider'; providerId: string; config: ServeProviderConfig }
  | { kind: 'root' }

function selectDeepSeekCandidate(
  options: KunServeRuntimeOptions,
  hasResolver: boolean
): DeepSeekCandidateMatch | undefined {
  const providers = options.providers
  if (providers) {
    const orderedIds = Array.from(new Set([
      ...(options.activeProviderId ? [options.activeProviderId] : []),
      'deepseek',
      ...Object.keys(providers)
    ]))
    for (const providerId of orderedIds) {
      const cfg = providers[providerId]
      if (!cfg) continue
      if ((cfg.kind ?? 'http') !== 'http') continue
      const matchesDeepSeekHost = isOfficialDeepSeekUrl(cfg.baseUrl)
        || ((providerId === 'deepseek' || cfg.presetSource === 'deepseek') && !cfg.baseUrl?.trim())
      if (!matchesDeepSeekHost) continue
      const hasAuthSource = Boolean(cfg.apiKey?.trim())
        || Boolean(cfg.credentialSourceId?.trim())
        || hasResolver
      if (!hasAuthSource) continue
      return { kind: 'provider', providerId, config: cfg }
    }
  }

  const rootMatchesDeepSeek = isOfficialDeepSeekUrl(options.baseUrl)
    || (!options.baseUrl?.trim() && options.activeProviderId === 'deepseek')
  if (rootMatchesDeepSeek && (Boolean(options.apiKey?.trim()) || Boolean(options.credentialSourceId?.trim()))) {
    return { kind: 'root' }
  }
  return undefined
}

function isOfficialDeepSeekUrl(rawUrl: string | undefined): boolean {
  const trimmed = rawUrl?.trim()
  if (!trimmed) return false
  try {
    return new URL(trimmed).hostname.toLowerCase() === 'api.deepseek.com'
  } catch {
    return false
  }
}

function pickNonEmptyString(...values: unknown[]): string | undefined {
  for (const value of values) {
    if (typeof value === 'string' && value.trim()) {
      return value.trim()
    }
  }
  return undefined
}

function combineAbortSignal(
  parentSignal: AbortSignal,
  timeoutMs: number
): { signal: AbortSignal; cleanup: () => void } {
  const controller = new AbortController()
  if (parentSignal.aborted) {
    controller.abort()
    return { signal: controller.signal, cleanup: () => undefined }
  }
  const onAbort = () => controller.abort()
  parentSignal.addEventListener('abort', onAbort, { once: true })
  const timeout = setTimeout(() => controller.abort(), timeoutMs)
  return {
    signal: controller.signal,
    cleanup: () => {
      clearTimeout(timeout)
      parentSignal.removeEventListener('abort', onAbort)
    }
  }
}
