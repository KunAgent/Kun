import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { MARKET_CATALOG_TTL_MS, MarketService } from './market-service'
import type { MarketSource, MarketSourceCatalog } from './market-source'

const CATALOG: MarketSourceCatalog = {
  skills: [{ sourceId: 'demo', id: 'one', name: { en: 'One' }, description: {}, tags: [], downloadUrl: 'https://x.test/1.zip' }],
  mcpServers: [],
  skillTags: [],
  mcpCategories: []
}

function createSource(behavior: { calls: number; fail?: boolean; result?: MarketSourceCatalog; delayMs?: number }): MarketSource {
  return {
    info: { id: 'demo', label: { en: 'Demo' } },
    allowedDownloadHosts: ['x.test'],
    async fetchCatalog() {
      behavior.calls += 1
      if (behavior.delayMs) await new Promise((resolve) => setTimeout(resolve, behavior.delayMs))
      if (behavior.fail) throw new Error('network down')
      return behavior.result ?? CATALOG
    }
  }
}

describe('MarketService', () => {
  let cacheDir = ''
  let clock = 1_000_000

  beforeEach(async () => {
    cacheDir = await mkdtemp(join(tmpdir(), 'market-service-'))
    clock = 1_000_000
  })

  afterEach(async () => {
    await rm(cacheDir, { recursive: true, force: true })
  })

  function createService(behavior: Parameters<typeof createSource>[0]): MarketService {
    return new MarketService({
      sources: [createSource(behavior)],
      cacheDir,
      fetcher: async () => new Response(''),
      now: () => clock
    })
  }

  it('syncs once, then serves the fresh cache without touching the network', async () => {
    const behavior = { calls: 0 }
    const service = createService(behavior)
    const first = await service.getCatalog('demo')
    expect(first).toMatchObject({ ok: true, origin: 'network', stale: false })
    clock += MARKET_CATALOG_TTL_MS - 1
    const second = await service.getCatalog('demo')
    expect(second).toMatchObject({ ok: true, origin: 'cache', stale: false })
    expect(behavior.calls).toBe(1)
  })

  it('survives an app restart because the cache lives on disk', async () => {
    await createService({ calls: 0 }).getCatalog('demo')
    const behavior = { calls: 0 }
    const reopened = createService(behavior)
    await expect(reopened.getCatalog('demo', 'cache-only')).resolves.toMatchObject({ ok: true, origin: 'cache' })
    expect(behavior.calls).toBe(0)
  })

  it('re-syncs once the TTL has passed', async () => {
    const behavior = { calls: 0 }
    const service = createService(behavior)
    await service.getCatalog('demo')
    clock += MARKET_CATALOG_TTL_MS + 1
    await expect(service.getCatalog('demo')).resolves.toMatchObject({ ok: true, origin: 'network' })
    expect(behavior.calls).toBe(2)
  })

  it('falls back to the stale cache and reports why the sync failed', async () => {
    const behavior = { calls: 0, fail: false }
    const service = createService(behavior)
    await service.getCatalog('demo')
    clock += MARKET_CATALOG_TTL_MS + 1
    behavior.fail = true
    const result = await service.getCatalog('demo')
    expect(result).toMatchObject({ ok: true, origin: 'cache', stale: true, refreshError: 'network down' })
  })

  it('reports unavailable when the first sync fails and nothing is cached', async () => {
    const service = createService({ calls: 0, fail: true })
    await expect(service.getCatalog('demo')).resolves.toMatchObject({ ok: false, code: 'unavailable' })
    await expect(service.getCatalog('demo', 'cache-only')).resolves.toMatchObject({ ok: false, code: 'no-cache' })
  })

  it('refresh mode bypasses a fresh cache', async () => {
    const behavior = { calls: 0 }
    const service = createService(behavior)
    await service.getCatalog('demo')
    await service.getCatalog('demo', 'refresh')
    expect(behavior.calls).toBe(2)
  })

  it('never replaces a good cache with an empty payload', async () => {
    const behavior: { calls: number; result?: MarketSourceCatalog } = { calls: 0 }
    const service = createService(behavior)
    await service.getCatalog('demo')
    behavior.result = { skills: [], mcpServers: [], skillTags: [], mcpCategories: [] }
    const result = await service.getCatalog('demo', 'refresh')
    expect(result).toMatchObject({ ok: true, origin: 'cache', refreshError: expect.stringContaining('empty') })
    if (result.ok) expect(result.catalog.skills).toHaveLength(1)
  })

  it('shares one in-flight sync between concurrent callers', async () => {
    const behavior = { calls: 0, delayMs: 20 }
    const service = createService(behavior)
    await Promise.all([service.getCatalog('demo'), service.getCatalog('demo'), service.getCatalog('demo')])
    expect(behavior.calls).toBe(1)
  })

  it('treats a corrupt cache file as empty', async () => {
    const service = createService({ calls: 0 })
    await writeFile(join(cacheDir, 'demo.json'), '{not json', 'utf8')
    await expect(service.getCatalog('demo', 'cache-only')).resolves.toMatchObject({ ok: false, code: 'no-cache' })
  })

  it('rejects unknown sources without throwing', async () => {
    const service = createService({ calls: 0 })
    await expect(service.getCatalog('missing')).resolves.toMatchObject({ ok: false, code: 'unavailable' })
  })
})
