/**
 * Contracts for remote Skill / MCP markets ("market sources").
 *
 * A market source is a third-party catalog Kun can browse and install from
 * (the Youdao market is the first). The main process fetches and caches each
 * catalog; the renderer only ever sees the normalized shapes below, so adding
 * another market never touches the marketplace UI beyond registering a source.
 */

/** Per-language copy as published by the market. Missing languages fall back. */
export type MarketLocalizedText = { en?: string; zh?: string }

export type MarketSourceInfo = {
  /** Stable id, also used as the on-disk cache key and the skill provenance tag. */
  id: string
  label: MarketLocalizedText
  homepage?: string
}

export type MarketTaxon = { id: string; name: MarketLocalizedText }

export type MarketOrigin = { author?: string; from?: string; url?: string }

export type MarketSkillEntry = {
  sourceId: string
  id: string
  name: MarketLocalizedText
  description: MarketLocalizedText
  version?: string
  tags: string[]
  downloadUrl: string
  origin?: MarketOrigin
}

type MarketMcpEntryBase = {
  sourceId: string
  id: string
  name: MarketLocalizedText
  description: MarketLocalizedText
  category?: string
  icon?: string
}

export type MarketMcpEntry =
  | (MarketMcpEntryBase & {
      transport: 'stdio'
      command: string
      args: string[]
      requiredEnvKeys: string[]
      optionalEnvKeys: string[]
    })
  | (MarketMcpEntryBase & {
      transport: 'remote'
      url: string
      requiredEnvKeys: string[]
      optionalEnvKeys: string[]
    })

export type MarketCatalog = {
  sourceId: string
  skills: MarketSkillEntry[]
  mcpServers: MarketMcpEntry[]
  skillTags: MarketTaxon[]
  mcpCategories: MarketTaxon[]
  /** Epoch ms of the network sync that produced this data. */
  fetchedAt: number
}

/**
 * How a catalog request is satisfied:
 * - `cache-only`: never touch the network; fails when nothing is cached.
 * - `auto`: use a fresh cache, otherwise sync and fall back to the stale cache.
 * - `refresh`: always sync, falling back to the cache when offline.
 */
export type MarketCatalogMode = 'cache-only' | 'auto' | 'refresh'

export type MarketCatalogResult =
  | {
      ok: true
      source: MarketSourceInfo
      catalog: MarketCatalog
      origin: 'network' | 'cache'
      /** Cached data older than the TTL (the sync failed or was skipped). */
      stale: boolean
      refreshError?: string
    }
  | { ok: false; source: MarketSourceInfo; code: 'no-cache' | 'unavailable'; message: string }

export type MarketInstallSkillRequest = {
  sourceId: string
  skillId: string
  rootPath: string
  /** Replace an earlier install that came from the same market (upgrade). */
  overwrite?: boolean
}

export type MarketInstallSkillResult =
  | { ok: true; path: string; version?: string }
  | { ok: false; code: 'exists' | 'failed'; message: string }

export type MarketMcpInstallRequest = { sourceId: string; serverId: string }

/**
 * What the renderer needs to write one market MCP server into the Kun config.
 * `args` already carry an exact npm version: Kun refuses unpinned `npx`
 * servers, so the main process resolves `@latest` at install time.
 */
export type MarketMcpInstallPlan =
  | {
      transport: 'stdio'
      id: string
      command: string
      args: string[]
      requiredEnvKeys: string[]
      optionalEnvKeys: string[]
      pinned?: { packageName: string; version: string }
    }
  | {
      transport: 'remote'
      id: string
      url: string
      requiredEnvKeys: string[]
      optionalEnvKeys: string[]
    }

export type MarketMcpInstallResult =
  | { ok: true; plan: MarketMcpInstallPlan }
  | { ok: false; message: string }

/** Provenance written next to a market-installed skill (`.kun-market.json`). */
export type MarketSkillProvenance = {
  sourceId: string
  skillId: string
  version?: string
  installedAt: string
  downloadUrl: string
}

export const MARKET_PROVENANCE_FILE = '.kun-market.json'
