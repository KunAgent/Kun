import { mkdtemp, rm } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { afterEach, describe, expect, it } from 'vitest'
import type { MemoryCapabilityConfig } from '../contracts/capabilities.js'
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

  async function cappedStore(
    maxInjectedRecords: number,
    idPrefix: string,
    scopes: MemoryCapabilityConfig['scopes'] = ['workspace']
  ) {
    let nextId = 1
    return new FileMemoryStore({
      rootDir: await makeTempDir(),
      config: { enabled: true, scopes, maxInjectedRecords },
      idGenerator: () => `${idPrefix}_${nextId++}`,
      nowIso: () => '2026-06-21T00:00:00.000Z'
    })
  }

  it('caps injection at the configured maxInjectedRecords', async () => {
    const store = await cappedStore(2, 'mem_cap')
    for (let i = 0; i < 3; i += 1) {
      await store.create({
        content: `Project ${i} uses pnpm for installs`,
        scope: 'workspace',
        workspace: '/tmp/workspace'
      })
    }
    await expect(store.retrieve({
      query: 'pnpm installs',
      workspace: '/tmp/workspace',
      limit: 8
    })).resolves.toHaveLength(2)
  })

  it('lets an explicit limit narrow below the configured cap', async () => {
    const store = await cappedStore(2, 'mem_min')
    await store.create({
      content: 'Use pnpm for frontend installs',
      scope: 'workspace',
      workspace: '/tmp/workspace'
    })
    await store.create({
      content: 'Use pnpm for backend installs',
      scope: 'workspace',
      workspace: '/tmp/workspace'
    })
    await expect(store.retrieve({
      query: 'pnpm installs',
      workspace: '/tmp/workspace',
      limit: 1
    })).resolves.toHaveLength(1)
  })

  it('injects only user-scope memories when scopes = [user]', async () => {
    const store = await cappedStore(8, 'mem_user', ['user'])
    await store.create({ content: 'User prefers pnpm', scope: 'user' })
    await store.create({ content: 'Workspace prefers pnpm', scope: 'workspace', workspace: '/tmp/workspace' })
    await store.create({ content: 'Project prefers pnpm', scope: 'project', workspace: '/tmp/workspace' })
    const hits = await store.retrieve({ query: 'pnpm', workspace: '/tmp/workspace', limit: 8 })
    expect(hits.map((memory) => memory.scope)).toEqual(['user'])
  })

  it('does not inject user memories when scopes excludes user', async () => {
    const store = await cappedStore(8, 'mem_nows', ['workspace'])
    await store.create({ content: 'User prefers pnpm', scope: 'user' })
    await store.create({ content: 'Workspace prefers pnpm', scope: 'workspace', workspace: '/tmp/workspace' })
    const hits = await store.retrieve({ query: 'who am I', workspace: '/tmp/workspace', limit: 8 })
    expect(hits).toEqual([])
  })

  it('filters the full scope matrix through the injection allow-list', async () => {
    const seed = async (store: FileMemoryStore) => {
      await store.create({ content: 'User prefers pnpm', scope: 'user' })
      await store.create({ content: 'Workspace prefers pnpm', scope: 'workspace', workspace: '/tmp/workspace' })
      await store.create({ content: 'Project prefers pnpm', scope: 'project', workspace: '/tmp/workspace' })
    }
    const wsStore = await cappedStore(8, 'mem_matrix_ws', ['workspace'])
    await seed(wsStore)
    expect((await wsStore.retrieve({ query: 'pnpm', workspace: '/tmp/workspace', limit: 8 })).map((memory) => memory.scope)).toEqual(['workspace'])

    const projStore = await cappedStore(8, 'mem_matrix_proj', ['project'])
    await seed(projStore)
    expect((await projStore.retrieve({ query: 'pnpm', workspace: '/tmp/workspace', limit: 8 })).map((memory) => memory.scope)).toEqual(['project'])
  })

  it('treats empty scopes as injection disabled while keeping list and writes', async () => {
    const store = await cappedStore(8, 'mem_none', [])
    await store.create({ content: 'Use pnpm', scope: 'workspace', workspace: '/tmp/workspace' })
    expect(await store.retrieve({ query: 'pnpm', workspace: '/tmp/workspace', limit: 8 })).toEqual([])
    expect(await store.list({ workspace: '/tmp/workspace' })).toHaveLength(1)
  })

  it('still imports and dedups excluded-scope records via createWithId', async () => {
    const store = await cappedStore(8, 'mem_mig', ['user'])
    const imported = await store.createWithId('mem_legacy', {
      content: 'Legacy workspace preference',
      scope: 'workspace',
      workspace: '/tmp/workspace'
    })
    expect(imported.id).toBe('mem_legacy')
    expect(await store.list({ all: true })).toHaveLength(1)
    await store.createWithId('mem_legacy', {
      content: 'Legacy workspace preference',
      scope: 'workspace',
      workspace: '/tmp/workspace'
    })
    expect(await store.list({ all: true })).toHaveLength(1)
  })

  describe('injection quotas across scopes', () => {
    async function userAndScoredStore(maxInjectedRecords: number, idPrefix: string) {
      let nextId = 1
      return new FileMemoryStore({
        rootDir: await makeTempDir(),
        config: { enabled: true, scopes: ['user', 'workspace'], maxInjectedRecords },
        idGenerator: () => `${idPrefix}_${nextId++}`,
        nowIso: () => '2026-06-21T00:00:00.000Z'
      })
    }

    async function seedUser(store: FileMemoryStore, count: number): Promise<void> {
      for (let i = 0; i < count; i += 1) {
        await store.create({ content: `User preference number ${i}`, scope: 'user' })
      }
    }

    it.each([8, 5, 2])('keeps a scored slot at cap %i', async (cap) => {
      const store = await userAndScoredStore(cap, 'mem_quota_cap')
      await seedUser(store, 8)
      await store.create({ content: 'Use pnpm for frontend installs', scope: 'workspace', workspace: '/tmp/workspace' })
      const hits = await store.retrieve({ query: 'pnpm installs', workspace: '/tmp/workspace', limit: cap })
      expect(hits).toHaveLength(cap)
      expect(hits.some((memory) => memory.scope === 'workspace')).toBe(true)
    })

    it('lets both scored memories through when user memories are near the cap', async () => {
      const store = await userAndScoredStore(8, 'mem_quota2')
      await seedUser(store, 7)
      await store.create({ content: 'Use pnpm for frontend installs', scope: 'workspace', workspace: '/tmp/workspace' })
      await store.create({ content: 'Use pnpm for backend installs', scope: 'workspace', workspace: '/tmp/workspace' })
      const hits = await store.retrieve({ query: 'pnpm installs', workspace: '/tmp/workspace', limit: 8 })
      expect(hits).toHaveLength(8)
      expect(hits.filter((memory) => memory.scope === 'workspace')).toHaveLength(2)
    })

    it('lets scored memories fill the full cap when there are no user memories', async () => {
      const store = await userAndScoredStore(4, 'mem_quota_nouser')
      for (let i = 0; i < 6; i += 1) {
        await store.create({ content: `Project ${i} uses pnpm`, scope: 'workspace', workspace: '/tmp/workspace' })
      }
      const hits = await store.retrieve({ query: 'pnpm', workspace: '/tmp/workspace', limit: 4 })
      expect(hits).toHaveLength(4)
    })

    it('keeps identity memories when the scored pool is empty', async () => {
      const store = await userAndScoredStore(8, 'mem_quota_ident')
      await seedUser(store, 8)
      const hits = await store.retrieve({ query: 'who am I', workspace: '/tmp/workspace', limit: 8 })
      expect(hits).toHaveLength(8)
      expect(hits.every((memory) => memory.scope === 'user')).toBe(true)
    })

    it('splits a narrowed limit between user and scored', async () => {
      const store = await userAndScoredStore(8, 'mem_quota_limit')
      await seedUser(store, 4)
      await store.create({ content: 'Use pnpm for frontend installs', scope: 'workspace', workspace: '/tmp/workspace' })
      await store.create({ content: 'Use pnpm for backend installs', scope: 'workspace', workspace: '/tmp/workspace' })
      const hits = await store.retrieve({ query: 'pnpm installs', workspace: '/tmp/workspace', limit: 2 })
      expect(hits).toHaveLength(2)
      expect(hits.filter((memory) => memory.scope === 'user')).toHaveLength(1)
      expect(hits.filter((memory) => memory.scope === 'workspace')).toHaveLength(1)
    })
  })

  describe('retrieval fallback for degenerate queries', () => {
    async function tickedStore(prefix: string, tick: { value: number }) {
      return new FileMemoryStore({
        rootDir: await makeTempDir(),
        config: { enabled: true, scopes: ['workspace'], maxInjectedRecords: 8 },
        idGenerator: () => `${prefix}_${++tick.value}`,
        nowIso: () => `2026-06-21T00:00:0${tick.value}.000Z`
      })
    }

    it('recalls recently updated memories for a continuation query', async () => {
      const tick = { value: 0 }
      const store = await tickedStore('mem_rec', tick)
      await store.create({ content: 'The deploy pipeline runs pnpm test before release', scope: 'workspace', workspace: '/tmp/workspace' })
      await store.create({ content: 'Use vitest for the test suite', scope: 'workspace', workspace: '/tmp/workspace' })
      await store.create({ content: 'Frontend uses Vite 5', scope: 'workspace', workspace: '/tmp/workspace' })
      const hits = await store.retrieve({ query: '继续', workspace: '/tmp/workspace', limit: 8, allowRecencyFallback: true })
      expect(hits).toHaveLength(3)
      expect(hits[0]?.content).toContain('Vite 5')
    })

    it('does not fall back when the primary query already scores hits', async () => {
      const store = await tickedStore('mem_nofb', { value: 0 })
      await store.create({ content: 'The project uses TypeScript', scope: 'workspace', workspace: '/tmp/workspace' })
      const hits = await store.retrieve({
        query: 'TypeScript project',
        workspace: '/tmp/workspace',
        limit: 8,
        allowRecencyFallback: true
      })
      expect(hits.map((memory) => memory.content)).toEqual(['The project uses TypeScript'])
    })
  })
})
