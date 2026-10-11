import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it, vi } from 'vitest'
import { MODELS_DEV_CACHE_TTL_MS, ModelsDevCatalogService } from './models-dev-catalog'

const io = vi.hoisted(() => ({
  directory: '',
  target: '',
  mkdirCalls: 0,
  committed: 0,
  renameAttempts: 0,
  firstWrite: undefined as (() => Promise<void>) | undefined
}))

vi.mock('node:fs/promises', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:fs/promises')>()
  return {
    ...actual,
    mkdir: async (...args: Parameters<typeof actual.mkdir>) => {
      const first = String(args[0]) === io.directory && ++io.mkdirCalls === 1
      const result = await actual.mkdir(...args)
      if (first) await io.firstWrite?.()
      return result
    },
    rename: async (...args: Parameters<typeof actual.rename>) => {
      try {
        await actual.rename(...args)
        if (String(args[1]) === io.target) io.committed++
      } finally {
        if (String(args[1]) === io.target) io.renameAttempts++
      }
    }
  }
})

function deferred() {
  let resolve!: () => void
  const promise = new Promise<void>((done) => { resolve = done })
  return { promise, resolve }
}

const request = { providerId: 'deepseek', baseUrl: 'https://api.deepseek.com' }
const catalog = {
  deepseek: { id: 'deepseek', name: 'DeepSeek', models: {
    'deepseek-chat': { id: 'deepseek-chat', name: 'DeepSeek Chat' }
  } }
}

describe('ModelsDevCatalogService ordered atomic persistence', () => {
  it.each([false, true])('publishes the latest snapshot after a delayed write (failure=%s)', async (failFirst) => {
    const directory = await mkdtemp(join(tmpdir(), 'models-dev-persist-'))
    const target = join(directory, 'models-dev.json')
    const started = deferred()
    const release = deferred()
    io.directory = directory
    io.target = target
    io.mkdirCalls = 0
    io.committed = 0
    io.renameAttempts = 0
    io.firstWrite = async () => {
      started.resolve()
      await release.promise
      if (failFirst) throw new Error('simulated disk failure')
    }
    let now = 1_000
    const fetcher = vi.fn(async () => new Response(JSON.stringify(catalog)))
    const service = new ModelsDevCatalogService(fetcher, () => now, target)
    const commits = failFirst ? 1 : 2
    try {
      // Neither the initial response nor stale responses wait on disk IO.
      await expect(service.fetch(request)).resolves.toMatchObject({ status: 'ok', stale: false })
      await started.promise
      now += MODELS_DEV_CACHE_TTL_MS + 1
      await expect(service.fetch(request)).resolves.toMatchObject({ status: 'ok', stale: true })
      await vi.waitFor(async () => {
        expect(await service.fetch(request)).toMatchObject({ status: 'ok', stale: false })
      })
      const writesWhileFirstBlocked = io.mkdirCalls
      release.resolve()
      await vi.waitFor(() => expect(io.renameAttempts).toBe(commits))
      const persisted = JSON.parse(await readFile(target, 'utf8'))
      expect(persisted).toMatchObject({ fetchedAt: now, source: 'models.dev', catalog })
      expect(writesWhileFirstBlocked).toBe(1)
      expect(io.committed).toBe(commits)
      expect(fetcher).toHaveBeenCalledTimes(2)
    } finally {
      release.resolve()
      // Cleanup must run even when a regression loses one of the commits.
      await vi.waitFor(() => expect(io.renameAttempts).toBe(commits)).catch(() => undefined)
      io.firstWrite = undefined
      await rm(directory, { recursive: true, force: true })
    }
  })
})
