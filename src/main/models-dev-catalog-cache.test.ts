import { describe, expect, it, vi } from 'vitest'
import {
  MODELS_DEV_CACHE_TTL_MS,
  ModelsDevCatalogService
} from './models-dev-catalog'

function catalogBody(): string {
  return JSON.stringify({
    deepseek: {
      id: 'deepseek',
      name: 'DeepSeek',
      api: 'https://api.deepseek.com',
      models: {
        'deepseek-chat': {
          id: 'deepseek-chat',
          name: 'DeepSeek Chat',
          modalities: { input: ['text'], output: ['text'] },
          limit: { context: 128_000, output: 16_000 }
        }
      }
    }
  })
}

const deepseekRequest = { providerId: 'deepseek', baseUrl: 'https://api.deepseek.com' }

describe('ModelsDevCatalogService stale-while-revalidate cache', () => {
  it('returns a stale cache immediately and refreshes in the background', async () => {
    let now = 1_000
    const fetcher = vi
      .fn()
      .mockResolvedValueOnce(new Response(catalogBody(), { status: 200 }))
      .mockRejectedValueOnce(new Error('offline'))
      .mockRejectedValueOnce(new Error('offline'))
    const service = new ModelsDevCatalogService(fetcher, () => now)

    await service.fetch(deepseekRequest)
    now += MODELS_DEV_CACHE_TTL_MS + 1
    // The stale entry resolves right away; the failed background refresh does
    // not block or clobber it.
    const stale = await service.fetch(deepseekRequest)
    expect(stale).toMatchObject({
      status: 'ok',
      stale: true,
      source: 'models.dev'
    })
    await vi.waitFor(() => expect(fetcher).toHaveBeenCalledTimes(3))
  })

  it('does not block on the network while a stale cache exists', async () => {
    let now = 1_000
    let releaseRefresh!: (response: Response) => void
    const refreshGate = new Promise<Response>((resolve) => {
      releaseRefresh = resolve
    })
    const fetcher = vi
      .fn()
      .mockResolvedValueOnce(new Response(catalogBody(), { status: 200 }))
      .mockImplementationOnce(() => refreshGate)
    const service = new ModelsDevCatalogService(fetcher, () => now)

    await service.fetch(deepseekRequest)
    now += MODELS_DEV_CACHE_TTL_MS + 1
    const stale = await service.fetch(deepseekRequest)
    expect(stale).toMatchObject({ status: 'ok', stale: true })
    // The background refresh is still in-flight; it updates the cache later.
    expect(fetcher).toHaveBeenCalledTimes(2)
    releaseRefresh(new Response(catalogBody(), { status: 200 }))
    await vi.waitFor(async () => {
      now += MODELS_DEV_CACHE_TTL_MS + 1
      const refreshed = await service.fetch(deepseekRequest)
      expect(refreshed).toMatchObject({ status: 'ok', stale: true })
    })
  })

  it('persists the background refresh to the disk cache', async () => {
    const { mkdtemp, readFile, rm } = await import('node:fs/promises')
    const { tmpdir } = await import('node:os')
    const { join } = await import('node:path')
    const dir = await mkdtemp(join(tmpdir(), 'models-dev-cache-'))
    const cachePath = join(dir, 'models-dev.json')
    let now = 1_000
    const fetcher = vi
      .fn()
      .mockImplementation(async () => new Response(catalogBody(), { status: 200 }))
    const service = new ModelsDevCatalogService(fetcher, () => now, cachePath)

    try {
      await service.fetch(deepseekRequest)
      now += MODELS_DEV_CACHE_TTL_MS + 1
      const stale = await service.fetch(deepseekRequest)
      expect(stale).toMatchObject({ status: 'ok', stale: true })
      // The background refresh rewrites fetchedAt on disk.
      await vi.waitFor(async () => {
        const persisted = JSON.parse(await readFile(cachePath, 'utf8')) as { fetchedAt: number }
        expect(persisted.fetchedAt).toBe(now)
      })
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  })

  it('blocks on the wire only when no cache exists at all', async () => {
    let release!: (response: Response) => void
    const gate = new Promise<Response>((resolve) => {
      release = resolve
    })
    const fetcher = vi.fn(() => gate)
    const service = new ModelsDevCatalogService(fetcher as never)

    let settled = false
    const pending = service.fetch(deepseekRequest).then((result) => {
      settled = true
      return result
    })
    await new Promise((resolve) => setTimeout(resolve, 10))
    expect(settled).toBe(false)
    release(new Response(catalogBody(), { status: 200 }))
    await expect(pending).resolves.toMatchObject({ status: 'ok', stale: false })
  })
})
