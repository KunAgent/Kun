import type {
  MarketCatalog,
  MarketCatalogMode,
  MarketCatalogResult,
  MarketSourceInfo
} from '../../../shared/market/market-types'
import { MarketCatalogCache } from './market-cache'
import type { MarketFetch, MarketSource } from './market-source'

/** A synced catalog is reused for this long before `auto` mode re-syncs. */
export const MARKET_CATALOG_TTL_MS = 6 * 60 * 60 * 1000
const SYNC_TIMEOUT_MS = 15_000

export type MarketServiceOptions = {
  sources: readonly MarketSource[]
  cacheDir: string
  fetcher: MarketFetch
  now?: () => number
}

/**
 * Registry of market sources plus the shared catalog policy: a disk cache per
 * source, a TTL, request de-duplication, and falling back to the last good
 * cache when the network is unavailable.
 */
export class MarketService {
  private readonly sources = new Map<string, MarketSource>()
  private readonly cache: MarketCatalogCache
  private readonly fetcher: MarketFetch
  private readonly now: () => number
  private readonly inflight = new Map<string, Promise<MarketCatalog>>()

  constructor(options: MarketServiceOptions) {
    for (const source of options.sources) this.sources.set(source.info.id, source)
    this.cache = new MarketCatalogCache(options.cacheDir)
    this.fetcher = options.fetcher
    this.now = options.now ?? Date.now
  }

  listSources(): MarketSourceInfo[] {
    return [...this.sources.values()].map((source) => source.info)
  }

  getSource(sourceId: string): MarketSource | undefined {
    return this.sources.get(sourceId)
  }

  async getCatalog(sourceId: string, mode: MarketCatalogMode = 'auto'): Promise<MarketCatalogResult> {
    const source = this.sources.get(sourceId)
    if (!source) {
      return {
        ok: false,
        source: { id: sourceId, label: { en: sourceId } },
        code: 'unavailable',
        message: `Unknown market source "${sourceId}".`
      }
    }
    const cached = await this.cache.read(sourceId)
    const fresh = cached !== null && this.now() - cached.fetchedAt < MARKET_CATALOG_TTL_MS
    if (mode === 'cache-only') {
      return cached
        ? { ok: true, source: source.info, catalog: cached, origin: 'cache', stale: !fresh }
        : { ok: false, source: source.info, code: 'no-cache', message: 'Nothing cached yet.' }
    }
    if (mode === 'auto' && cached && fresh) {
      return { ok: true, source: source.info, catalog: cached, origin: 'cache', stale: false }
    }
    try {
      const catalog = await this.sync(source)
      return { ok: true, source: source.info, catalog, origin: 'network', stale: false }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      if (cached) {
        return {
          ok: true,
          source: source.info,
          catalog: cached,
          origin: 'cache',
          stale: !fresh,
          refreshError: message
        }
      }
      return { ok: false, source: source.info, code: 'unavailable', message }
    }
  }

  private sync(source: MarketSource): Promise<MarketCatalog> {
    const running = this.inflight.get(source.info.id)
    if (running) return running
    const task = (async () => {
      const synced = await source.fetchCatalog(this.fetcher, AbortSignal.timeout(SYNC_TIMEOUT_MS))
      // An empty payload is a malformed response, not "the market is empty";
      // keep the last good cache instead of replacing it.
      if (synced.skills.length === 0 && synced.mcpServers.length === 0) {
        throw new Error('The market returned an empty catalog.')
      }
      const catalog: MarketCatalog = { ...synced, sourceId: source.info.id, fetchedAt: this.now() }
      // A cache write failure must not hide a catalog we already have in hand.
      await this.cache.write(catalog).catch(() => undefined)
      return catalog
    })().finally(() => this.inflight.delete(source.info.id))
    this.inflight.set(source.info.id, task)
    return task
  }
}
