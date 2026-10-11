import { mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import type { MarketCatalog } from '../../../shared/market/market-types'

const CACHE_FORMAT_VERSION = 1

type CacheFile = { version: number; catalog: MarketCatalog }

/** One JSON file per market source under `dir` (`<sourceId>.json`). */
export class MarketCatalogCache {
  constructor(private readonly dir: string) {}

  private fileFor(sourceId: string): string {
    // Source ids are registered in code, but keep the path inside `dir` regardless.
    return join(this.dir, `${sourceId.replace(/[^A-Za-z0-9_-]/g, '_')}.json`)
  }

  async read(sourceId: string): Promise<MarketCatalog | null> {
    try {
      const parsed = JSON.parse(await readFile(this.fileFor(sourceId), 'utf8')) as Partial<CacheFile>
      const catalog = parsed.catalog
      if (
        parsed.version !== CACHE_FORMAT_VERSION ||
        !catalog ||
        catalog.sourceId !== sourceId ||
        typeof catalog.fetchedAt !== 'number' ||
        !Array.isArray(catalog.skills) ||
        !Array.isArray(catalog.mcpServers) ||
        !Array.isArray(catalog.skillTags) ||
        !Array.isArray(catalog.mcpCategories)
      ) {
        return null
      }
      return catalog
    } catch {
      // Missing or corrupt cache is equivalent to "never synced".
      return null
    }
  }

  async write(catalog: MarketCatalog): Promise<void> {
    const file = this.fileFor(catalog.sourceId)
    const temp = `${file}.${process.pid}.tmp`
    await mkdir(dirname(file), { recursive: true })
    try {
      await writeFile(temp, JSON.stringify({ version: CACHE_FORMAT_VERSION, catalog }), 'utf8')
      await rename(temp, file)
    } catch (error) {
      await rm(temp, { force: true }).catch(() => undefined)
      throw error
    }
  }
}
