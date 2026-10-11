import semver from 'semver'
import { CODEX_CLI_VERSION, codexCliUserAgent } from './provider-cli-identity.js'
import { readLimitedResponseText } from './compat-model-support.js'

// Only public release metadata is read here. Provider discovery must not depend
// on an installed agent, its credentials, or its model cache.
export const CODEX_PROVIDER_VERSION_URL = 'https://registry.npmjs.org/@openai/codex/latest'
const VERSION_CACHE_MS = 24 * 60 * 60 * 1_000
const VERSION_RETRY_MS = 5 * 60 * 1_000
const VERSION_TIMEOUT_MS = 3_000
const MAX_CATALOG_BYTES = 2_000_000

type CatalogFetch = (url: string, init: RequestInit, proxyUrl: string) => Promise<Response>
type CatalogRequest = { url: string; headers: Record<string, string> }
type CatalogResult = CatalogRequest & {
  response: Response
  text: string
  truncated: boolean
}
type VersionState = {
  candidate: string
  lastGood: string
  refreshAt: number
  pending?: Promise<void>
}

export function codexProviderCatalogUrl(version = CODEX_CLI_VERSION): string {
  return `https://chatgpt.com/backend-api/codex/models?client_version=${version}`
}

/** Cache versions, never account-specific catalogs or credentials. */
export function createCodexProviderCatalogFetcher(now: () => number = Date.now) {
  const transports = new WeakMap<CatalogFetch, Map<string, VersionState>>()

  async function refreshVersion(state: VersionState, fetcher: CatalogFetch, proxyUrl: string) {
    if (state.pending) return state.pending
    if (state.refreshAt > now()) return
    state.pending = (async () => {
      try {
        const response = await fetcher(CODEX_PROVIDER_VERSION_URL, {
          method: 'GET',
          headers: { Accept: 'application/json' },
          redirect: 'error',
          signal: AbortSignal.timeout(VERSION_TIMEOUT_MS)
        }, proxyUrl)
        if (!response.ok) {
          await response.body?.cancel().catch(() => undefined)
          throw new Error('Provider version lookup failed')
        }
        const body = await readLimitedResponseText(response, 256_000)
        if (body.exceeded) throw new Error('Provider version metadata exceeded its limit')
        const metadata = JSON.parse(body.text)
        const version = metadata?.version
        if (metadata?.name !== '@openai/codex' || typeof version !== 'string' ||
            !/^\d+\.\d+\.\d+$/.test(version) || !semver.valid(version)) {
          throw new Error('Invalid provider version metadata')
        }
        state.candidate = semver.gt(version, state.lastGood) ? version : state.lastGood
        state.refreshAt = now() + VERSION_CACHE_MS
      } catch {
        state.candidate = state.lastGood
        state.refreshAt = now() + VERSION_RETRY_MS
      }
    })().finally(() => { state.pending = undefined })
    return state.pending
  }

  return async (input: {
    fetcher: CatalogFetch
    proxyUrl: string
    headers: Record<string, string>
    timeoutMs: number
    signal?: AbortSignal
    onRequest?: (request: CatalogRequest) => void
  }): Promise<CatalogResult> => {
    let routes = transports.get(input.fetcher)
    if (!routes) {
      routes = new Map()
      transports.set(input.fetcher, routes)
    }
    let state = routes.get(input.proxyUrl)
    if (!state) {
      // Avoid retaining every proxy configuration used during a long session.
      if (routes.size >= 8) routes.delete(routes.keys().next().value!)
      state = { candidate: CODEX_CLI_VERSION, lastGood: CODEX_CLI_VERSION, refreshAt: 0 }
      routes.set(input.proxyUrl, state)
    }
    await refreshVersion(state, input.fetcher, input.proxyUrl)

    const request = async (version: string): Promise<CatalogResult> => {
      input.signal?.throwIfAborted()
      const url = codexProviderCatalogUrl(version)
      const headers = {
        ...Object.fromEntries(Object.entries(input.headers)
          .filter(([key]) => key.toLowerCase() !== 'user-agent')),
        'User-Agent': codexCliUserAgent(version)
      }
      input.onRequest?.({ url, headers })
      const response = await input.fetcher(url, {
        redirect: 'error',
        method: 'GET', headers, signal: input.signal
          ? AbortSignal.any([input.signal, AbortSignal.timeout(input.timeoutMs)]) : AbortSignal.timeout(input.timeoutMs)
      }, input.proxyUrl)
      const body = await readLimitedResponseText(response, MAX_CATALOG_BYTES)
      return { url, headers, response, text: body.text, truncated: body.exceeded }
    }

    const version = state.candidate
    let result = await request(version)
    const fallback = state.lastGood
    if (version !== fallback && shouldRetryVersion(result)) {
      // Do not turn auth failures, rate limits, or outages into successful
      // discovery. Retry only an incompatible catalog/version response.
      if (state.candidate === version) {
        state.candidate = fallback
        state.refreshAt = now() + VERSION_RETRY_MS
      }
      result = await request(fallback)
    } else if (isValidCatalog(result) && semver.gt(version, state.lastGood)) {
      state.lastGood = version
    }
    return result
  }
}

function isValidCatalog(result: CatalogResult): boolean {
  if (!result.response.ok || result.truncated) return false
  try { return Array.isArray(JSON.parse(result.text)?.models) } catch { return false }
}

function shouldRetryVersion(result: CatalogResult): boolean {
  return [400, 404, 422].includes(result.response.status) ||
    (result.response.ok && !isValidCatalog(result))
}

export const fetchCodexProviderCatalog = createCodexProviderCatalogFetcher()
