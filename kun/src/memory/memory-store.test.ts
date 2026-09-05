import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { FileMemoryStore } from './memory-store.js'

const tempDirs: string[] = []

async function makeTempDir(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), 'kun-memory-store-'))
  tempDirs.push(dir)
  return dir
}

afterEach(async () => {
  await Promise.all(tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })))
})

describe('FileMemoryStore', () => {
  it('creates portable imports with exact expiry and disabled lifecycle state', async () => {
    const store = new FileMemoryStore({
      rootDir: await makeTempDir(),
      config: { enabled: true, scopes: ['user'], maxInjectedRecords: 8 },
      idGenerator: () => 'mem_portable',
      nowIso: () => '2026-06-21T00:00:00.000Z'
    })

    const created = await store.create({
      content: 'Portable disabled memory',
      scope: 'user',
      expiresAt: '2027-01-01T00:00:00.000Z',
      disabled: true
    })

    expect(created).toMatchObject({
      id: 'mem_portable',
      expiresAt: '2027-01-01T00:00:00.000Z',
      disabledAt: '2026-06-21T00:00:00.000Z'
    })
    await expect(store.retrieve({ query: 'Portable', limit: 8 })).resolves.toEqual([])
  })

  it('re-enables a disabled memory when updated with disabled false', async () => {
    let tick = 0
    const store = new FileMemoryStore({
      rootDir: await makeTempDir(),
      config: { enabled: true, scopes: ['workspace'], maxInjectedRecords: 8 },
      idGenerator: () => 'mem_toggle',
      nowIso: () => `2026-06-21T00:00:0${tick++}.000Z`
    })

    await store.create({
      content: 'Prefer pnpm',
      scope: 'workspace',
      workspace: '/tmp/workspace'
    })

    const disabled = await store.update('mem_toggle', { disabled: true }, { workspace: '/tmp/workspace' })
    expect(disabled.disabledAt).toBe('2026-06-21T00:00:01.000Z')
    await expect(store.retrieve({
      query: 'pnpm',
      workspace: '/tmp/workspace',
      limit: 8
    })).resolves.toEqual([])

    const enabled = await store.update('mem_toggle', { disabled: false }, { workspace: '/tmp/workspace' })
    expect(enabled.disabledAt).toBeUndefined()
    await expect(store.retrieve({
      query: 'pnpm',
      workspace: '/tmp/workspace',
      limit: 8
    })).resolves.toMatchObject([{ id: 'mem_toggle' }])
  })

  it('reads a record by id without a full directory scan', async () => {
    const store = new FileMemoryStore({
      rootDir: await makeTempDir(),
      config: { enabled: true, scopes: ['workspace'], maxInjectedRecords: 8 },
      nowIso: () => '2026-06-21T00:00:00.000Z'
    })

    await store.createWithId('mem_get', {
      content: 'Get me by id', scope: 'workspace', workspace: '/tmp/workspace'
    })
    await expect(store.get('mem_get')).resolves.toMatchObject({
      id: 'mem_get', content: 'Get me by id'
    })
    await expect(store.get('mem_missing')).resolves.toBeUndefined()

    await store.delete('mem_get', { workspace: '/tmp/workspace' })
    expect((await store.get('mem_get'))?.deletedAt).toBeTruthy()
  })

  it('returns undefined when the id file holds malformed JSON', async () => {
    const rootDir = await makeTempDir()
    const store = new FileMemoryStore({
      rootDir,
      config: { enabled: true, scopes: ['workspace'], maxInjectedRecords: 8 }
    })
    await writeFile(join(rootDir, 'mem_bad.json'), '{broken')
    await expect(store.get('mem_bad')).resolves.toBeUndefined()
  })

  it('createWithId is idempotent and does not rewrite an existing record', async () => {
    const store = new FileMemoryStore({
      rootDir: await makeTempDir(),
      config: { enabled: true, scopes: ['workspace'], maxInjectedRecords: 8 },
      nowIso: () => '2026-06-21T00:00:00.000Z'
    })
    const first = await store.createWithId('mem_idem', {
      content: 'Idempotent content', scope: 'workspace', workspace: '/tmp/workspace'
    })
    const second = await store.createWithId('mem_idem', {
      content: 'Different content', scope: 'workspace', workspace: '/tmp/workspace'
    })
    expect(second).toEqual(first)
    expect(second).toMatchObject({ id: 'mem_idem', content: 'Idempotent content' })
  })

  it('create and createWithId never trigger a full canonical list scan', async () => {
    const store = new FileMemoryStore({
      rootDir: await makeTempDir(),
      config: { enabled: true, scopes: ['workspace'], maxInjectedRecords: 8 },
      idGenerator: () => 'mem_new',
      nowIso: () => '2026-06-21T00:00:00.000Z'
    })
    const listSpy = vi.spyOn(store, 'list')
    await store.create({ content: 'New record', scope: 'workspace', workspace: '/tmp/workspace' })
    await store.createWithId('mem_superseded', {
      content: 'Superseded record', scope: 'workspace', workspace: '/tmp/workspace'
    })
    await store.createWithId('mem_replacement', {
      content: 'Replacement record', scope: 'workspace', workspace: '/tmp/workspace',
      supersedes: 'mem_superseded'
    })
    expect(listSpy).not.toHaveBeenCalled()
    listSpy.mockRestore()
  })
})
