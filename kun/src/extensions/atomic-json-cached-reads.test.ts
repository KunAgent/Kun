import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { AtomicJsonFile } from './atomic-json.js'

type Document = { items: Array<{ id: string }> }

function validate(value: unknown): Document {
  if (!value || typeof value !== 'object' || !Array.isArray((value as Document).items)) throw new Error('invalid')
  return { items: (value as Document).items.map((item) => ({ id: item.id })) }
}

function requestBody(init?: RequestInit): Record<string, unknown> {
  return JSON.parse(String(init?.body)) as Record<string, unknown>
}

beforeEach(() => {
  vi.stubEnv('KUN_MANAGER_BASE_URL', 'http://127.0.0.1:19010')
  vi.stubEnv('KUN_MANAGER_TOKEN', 'manager-secret')
  vi.stubEnv('KUN_MANAGER_DATA_DIR', '/tmp/kun-cached-reads')
})

afterEach(() => {
  vi.unstubAllEnvs()
  vi.unstubAllGlobals()
})

describe('AtomicJsonFile cached Manager reads', () => {
  it('revalidates with the etag and returns a private copy when unchanged', async () => {
    const validator = vi.fn(validate)
    const fetchMock = vi.fn(async (_input: string | URL | Request, init?: RequestInit) => {
      const body = requestBody(init)
      if (body.ifNoneMatch === 'epoch:3') return Response.json({ snapshot: { revision: 3, etag: 'epoch:3', unchanged: true } })
      return Response.json({ snapshot: { revision: 3, etag: 'epoch:3', value: { items: [{ id: 'a' }] } } })
    })
    vi.stubGlobal('fetch', fetchMock)
    const file = new AtomicJsonFile('/tmp/kun-cached-reads/doc.json', validator, false, { cacheManagerReads: true })

    const first = await file.read(() => ({ items: [] }))
    first.items.push({ id: 'mutated by caller' })
    const second = await file.read(() => ({ items: [] }))

    expect(second).toEqual({ items: [{ id: 'a' }] })
    expect(validator).toHaveBeenCalledTimes(1)
    expect(requestBody(fetchMock.mock.calls[0]?.[1])).toEqual({ path: '/tmp/kun-cached-reads/doc.json' })
    expect(requestBody(fetchMock.mock.calls[1]?.[1])).toEqual({ path: '/tmp/kun-cached-reads/doc.json', ifNoneMatch: 'epoch:3' })
  })

  it('reads the new document after the etag changes and keeps the fallback for a missing file', async () => {
    let revision = 1
    const fetchMock = vi.fn(async (_input: string | URL | Request, init?: RequestInit) => {
      const etag = `epoch:${revision}`
      if (requestBody(init).ifNoneMatch === etag) return Response.json({ snapshot: { revision, etag, unchanged: true } })
      return Response.json({ snapshot: { revision, etag, value: revision === 1 ? null : { items: [{ id: String(revision) }] } } })
    })
    vi.stubGlobal('fetch', fetchMock)
    const file = new AtomicJsonFile('/tmp/kun-cached-reads/doc.json', validate, false, { cacheManagerReads: true })
    const fallback = vi.fn(() => ({ items: [{ id: 'fallback' }] }))

    await expect(file.read(fallback)).resolves.toEqual({ items: [{ id: 'fallback' }] })
    await expect(file.read(fallback)).resolves.toEqual({ items: [{ id: 'fallback' }] })
    expect(fallback).toHaveBeenCalledTimes(2)
    revision = 2
    await expect(file.read(fallback)).resolves.toEqual({ items: [{ id: '2' }] })
  })

  it('drops the cached document when this instance writes', async () => {
    let value: Document = { items: [{ id: 'before' }] }
    let revision = 1
    const fetchMock = vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
      const url = String(input)
      const body = requestBody(init)
      if (url.endsWith('/atomic-json/write')) {
        value = body.value as Document
        revision += 1
        return Response.json({ snapshot: { revision, value } })
      }
      const etag = `epoch:${revision}`
      if (body.ifNoneMatch === etag) return Response.json({ snapshot: { revision, etag, unchanged: true } })
      return Response.json({ snapshot: { revision, etag, value } })
    })
    vi.stubGlobal('fetch', fetchMock)
    const file = new AtomicJsonFile('/tmp/kun-cached-reads/doc.json', validate, false, { cacheManagerReads: true })

    await file.read(() => ({ items: [] }))
    await file.write({ items: [{ id: 'after' }] })
    await expect(file.read(() => ({ items: [] }))).resolves.toEqual({ items: [{ id: 'after' }] })
    const reads = fetchMock.mock.calls.filter(([url]) => String(url).endsWith('/atomic-json/read'))
    expect(requestBody(reads.at(-1)?.[1])).toEqual({ path: '/tmp/kun-cached-reads/doc.json' })
  })

  it('keeps uncached instances on full reads', async () => {
    const fetchMock = vi.fn(async (_input: string | URL | Request, _init?: RequestInit) =>
      Response.json({ snapshot: { revision: 1, etag: 'epoch:1', value: { items: [] } } }))
    vi.stubGlobal('fetch', fetchMock)
    const file = new AtomicJsonFile('/tmp/kun-cached-reads/doc.json', validate, false)
    await file.read(() => ({ items: [] }))
    await file.read(() => ({ items: [] }))
    expect(fetchMock.mock.calls.map(([, init]) => requestBody(init))).toEqual([
      { path: '/tmp/kun-cached-reads/doc.json' }, { path: '/tmp/kun-cached-reads/doc.json' }
    ])
  })
  it('falls back to a plain read when a Manager rejects the conditional field', async () => {
    const fetchMock = vi.fn(async (_input: string | URL | Request, init?: RequestInit) => {
      if (requestBody(init).ifNoneMatch) return Response.json({ error: 'invalid atomic JSON read' }, { status: 400 })
      return Response.json({ snapshot: { revision: 1, etag: 'epoch:1', value: { items: [{ id: 'plain' }] } } })
    })
    vi.stubGlobal('fetch', fetchMock)
    const file = new AtomicJsonFile('/tmp/kun-cached-reads/doc.json', validate, false, { cacheManagerReads: true })
    await file.read(() => ({ items: [] }))
    await expect(file.read(() => ({ items: [] }))).resolves.toEqual({ items: [{ id: 'plain' }] })
    expect(fetchMock).toHaveBeenCalledTimes(3)
  })
})
