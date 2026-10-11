import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { discoverCustomModels } from './provider-custom-discovery.js'
import { ProviderDiscoverySchema } from '../contracts/provider-configuration.js'
import { readModelCatalog, writeModelCatalog } from './model-catalog-store.js'

const folders: string[] = []
afterEach(async () => { await Promise.all(folders.splice(0).map((folder) => rm(folder, { recursive: true, force: true }))) })
function custom(overrides: Record<string, unknown> = {}) {
  const value = ProviderDiscoverySchema.parse({ mode: 'custom', modelsUrl: 'https://provider.test/catalog',
    nextCursorPointer: '/next', cursorParameter: 'cursor', ...overrides })
  if (value.mode !== 'custom') throw new Error('Expected custom discovery')
  return value
}

describe('provider discovery boundaries', () => {
  it('follows bounded cursor pages without changing the selected model list', async () => {
    const fetcher = vi.fn<typeof fetch>(async (url, init) => {
      expect(init?.redirect).toBe('error')
      return new URL(String(url)).searchParams.has('cursor')
        ? Response.json({ data: [{ id: 'model-b' }, { id: 'model-a' }] })
        : Response.json({ data: [{ id: 'model-a' }], next: 'page-2' })
    })
    expect(await discoverCustomModels({ discovery: custom(), baseUrl: 'https://provider.test/v1',
      headers: { Authorization: 'Bearer test-key' }, fetcher })).toEqual(['model-a', 'model-b'])
    expect(fetcher).toHaveBeenCalledTimes(2)
  })

  it('rejects credential forwarding to a different unapproved model-list origin', async () => {
    const fetcher = vi.fn<typeof fetch>()
    await expect(discoverCustomModels({ discovery: custom({ modelsUrl: 'https://other.test/models' }),
      baseUrl: 'https://provider.test/v1', headers: { Authorization: 'Bearer test-key' }, fetcher })).rejects.toThrow('not been approved')
    expect(fetcher).not.toHaveBeenCalled()
  })

  it('rejects repeated pagination cursors and excessive pages', async () => {
    const fetcher = vi.fn<typeof fetch>(async () => Response.json({ data: [{ id: 'one' }], next: 'again' }))
    await expect(discoverCustomModels({ discovery: custom(), baseUrl: 'https://provider.test', headers: {}, fetcher })).rejects.toThrow('repeated')
    await expect(discoverCustomModels({ discovery: custom({ maxPages: 1 }), baseUrl: 'https://provider.test', headers: {}, fetcher })).rejects.toThrow('pagination limit')
  })

  it('accepts an empty live catalog and propagates cancellation', async () => {
    expect(await discoverCustomModels({ discovery: custom(), baseUrl: 'https://provider.test', headers: {},
      fetcher: async () => Response.json({ data: [] }) })).toEqual([])
    const signal = AbortSignal.abort(new Error('cancelled'))
    await expect(discoverCustomModels({ discovery: custom(), baseUrl: 'https://provider.test', headers: {}, signal,
      fetcher: async (_url, init) => { init?.signal?.throwIfAborted(); return Response.json({ data: [] }) } })).rejects.toThrow('cancelled')
  })

  it('isolates formerly colliding IDs and marks old account observations stale', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'kun-catalog-identity-')); folders.push(dir)
    const entry = { fetchedAt: new Date().toISOString(), models: ['model-a'], identity: 'account-a', configurationRevision: 3 }
    await writeModelCatalog(dir, 'provider/a', entry)
    await writeModelCatalog(dir, 'provider_a', { ...entry, models: ['model-b'], identity: 'account-b' })
    expect((await readModelCatalog(dir, 'provider/a', 'account-a'))?.models).toEqual(['model-a'])
    expect(await readModelCatalog(dir, 'provider/a', 'new-account')).toMatchObject({ stale: true, identityChanged: true })
    expect((await readModelCatalog(dir, 'provider_a', 'account-b'))?.models).toEqual(['model-b'])
    await writeModelCatalog(dir, 'provider_a', { ...entry, models: ['obsolete'], configurationRevision: 2 })
    expect((await readModelCatalog(dir, 'provider_a', 'account-b'))?.models).toEqual(['model-b'])
  })
})
