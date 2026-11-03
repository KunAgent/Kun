import type { MarketCatalog, MarketSourceInfo } from '../../../shared/market/market-types'

export type MarketFetch = (url: string, init?: RequestInit) => Promise<Response>

export type MarketSourceCatalog = Omit<MarketCatalog, 'sourceId' | 'fetchedAt'>

/**
 * One remote market (Youdao, ...). Implementations only know how to fetch and
 * normalize their own catalog; caching, install and IPC are source-agnostic.
 */
export type MarketSource = {
  info: MarketSourceInfo
  /**
   * Hosts skill archives may be downloaded from: an exact hostname, or a
   * `.suffix` that matches the domain and every subdomain. The catalog is
   * remote data, so this is the guard against it pointing an install at an
   * arbitrary server.
   */
  allowedDownloadHosts: readonly string[]
  fetchCatalog: (fetcher: MarketFetch, signal: AbortSignal) => Promise<MarketSourceCatalog>
}

export function isAllowedDownloadUrl(url: string, allowedHosts: readonly string[]): boolean {
  let parsed: URL
  try {
    parsed = new URL(url)
  } catch {
    return false
  }
  if (parsed.protocol !== 'https:') return false
  const host = parsed.hostname.toLowerCase()
  return allowedHosts.some((allowed) => {
    const rule = allowed.toLowerCase()
    return rule.startsWith('.') ? host === rule.slice(1) || host.endsWith(rule) : host === rule
  })
}

// Lowercase slug: it is the install folder, the config key and the id Kun's
// skill discovery reports back, so all three must agree.
const SAFE_ID = /^[a-z0-9][a-z0-9_-]{0,63}$/

/** Ids become folder names / config keys, so refuse anything path-like or non-slug. */
export function isSafeMarketId(id: unknown): id is string {
  return typeof id === 'string' && SAFE_ID.test(id)
}

export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

export function asString(value: unknown): string {
  return typeof value === 'string' ? value.trim() : ''
}

export function asStringList(value: unknown): string[] {
  return Array.isArray(value)
    ? value.filter((item): item is string => typeof item === 'string' && item.length > 0)
    : []
}
