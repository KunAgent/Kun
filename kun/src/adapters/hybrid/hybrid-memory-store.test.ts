import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { MemoryCapabilityConfig } from '../../contracts/capabilities.js'
import { FileMemoryStore } from '../../memory/memory-store.js'
import { HybridMemoryStore } from './hybrid-memory-store.js'

const roots: string[] = []
const policy: MemoryCapabilityConfig = {
  enabled: true,
  scopes: ['user', 'workspace', 'project'],
  maxInjectedRecords: 8
}

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })))
})

describe('HybridMemoryStore', () => {
  it('projects canonical JSON into FTS5 and retrieves bounded Latin and CJK records', async () => {
    const { store } = await createStore()
    await store.createWithId('mem_latin', {
      content: 'Use pnpm for package management', scope: 'workspace', workspace: '/workspace-a'
    })
    await store.createWithId('mem_cjk', {
      content: '中文接口文档需要示例', scope: 'workspace', workspace: '/workspace-a'
    })
    await store.waitForBackfill()

    await expect(store.retrieve({ query: 'pnpm package', workspace: '/workspace-a', limit: 3 }))
      .resolves.toMatchObject([{ id: 'mem_latin' }])
    await expect(store.retrieve({ query: '中文接口文档', workspace: '/workspace-a', limit: 3 }))
      .resolves.toMatchObject([{ id: 'mem_cjk' }])
    const diagnostics = await store.diagnostics()
    expect(diagnostics).toMatchObject({
      canonicalCount: 2, indexedCount: 2, staleCount: 0, indexState: 'ready', indexSchemaVersion: 1
    })
    expect(diagnostics.lastRetrieval?.mode).toBe('sqlite-fts5')
    await store.shutdown()
  })

  it('filters temporal lifecycle before FTS ranking and candidate limits', async () => {
    const { store } = await createStore()
    for (let index = 0; index < 20; index += 1) {
      await store.createWithId(`mem_expired_${index}`, {
        content: `exact temporal lifecycle query ${index}`,
        scope: 'workspace',
        workspace: '/workspace-a',
        validTo: '2026-08-27T00:00:00.000Z'
      })
    }
    await store.createWithId('mem_temporal_active', {
      content: 'exact temporal lifecycle query active',
      scope: 'workspace',
      workspace: '/workspace-a'
    })

    await expect(store.retrieve({
      query: 'exact temporal lifecycle query',
      workspace: '/workspace-a',
      limit: 1
    })).resolves.toMatchObject([{ id: 'mem_temporal_active' }])
    expect((await store.diagnostics()).lastRetrieval?.filtered.lifecycle).toBeGreaterThanOrEqual(20)
    await store.shutdown()
  })

  it('keeps canonical success across a projection crash window and reconciles on restart', async () => {
    const root = await tempRoot()
    let failProjection = true
    const first = new HybridMemoryStore({
      dataDir: root, config: policy,
      beforeProject: () => { if (failProjection) throw new Error('simulated projection interruption token=private') }
    })
    await first.ready()
    await first.createWithId('mem_crash', {
      content: 'Canonical data survives projection failure', scope: 'workspace', workspace: '/workspace-a'
    })
    expect(JSON.parse(await readFile(join(root, 'memory', 'mem_crash.json'), 'utf8'))).toMatchObject({ id: 'mem_crash' })
    const degraded = await first.diagnostics()
    expect(degraded.indexState).toBe('degraded')
    expect(degraded.degradedReason).toContain('token=[redacted]')
    await first.shutdown()

    failProjection = false
    const second = new HybridMemoryStore({ dataDir: root, config: policy })
    await second.waitForBackfill()
    await expect(second.retrieve({ query: 'projection failure', workspace: '/workspace-a', limit: 3 }))
      .resolves.toMatchObject([{ id: 'mem_crash' }])
    expect(await second.diagnostics()).toMatchObject({ indexState: 'ready', staleCount: 0 })
    await second.shutdown()
  })

  it('rebuilds a deleted index from canonical files without losing lifecycle state', async () => {
    const root = await tempRoot()
    const first = new HybridMemoryStore({ dataDir: root, config: policy })
    await first.createWithId('mem_rebuild', {
      content: 'Rebuild this indexed memory', scope: 'workspace', workspace: '/workspace-a'
    })
    await first.update('mem_rebuild', { disabled: true }, { workspace: '/workspace-a' })
    await first.shutdown()
    await removeIndexFiles(root)

    const second = new HybridMemoryStore({ dataDir: root, config: policy })
    await second.waitForBackfill()
    expect(await second.retrieve({ query: 'rebuild indexed', workspace: '/workspace-a', limit: 3 })).toEqual([])
    expect((await second.list({ all: true })).find((record) => record.id === 'mem_rebuild')?.disabledAt).toBeTruthy()
    expect(await second.diagnostics()).toMatchObject({ canonicalCount: 1, indexedCount: 1, staleCount: 0 })
    await second.shutdown()
  })

  it('falls back for corrupt SQLite and migration failure without deleting damaged JSON', async () => {
    const root = await tempRoot()
    await mkdir(join(root, 'memory'), { recursive: true })
    await writeFile(join(root, 'memory-index.sqlite3'), 'not a database')
    await writeFile(join(root, 'memory', 'damaged.json'), '{broken')
    const corrupt = new HybridMemoryStore({ dataDir: root, config: policy })
    await corrupt.ready()
    await corrupt.createWithId('mem_fallback', {
      content: 'Filesystem fallback remains available', scope: 'workspace', workspace: '/workspace-a'
    })
    await expect(corrupt.retrieve({ query: 'filesystem fallback', workspace: '/workspace-a', limit: 3 }))
      .resolves.toMatchObject([{ id: 'mem_fallback' }])
    expect(await corrupt.diagnostics()).toMatchObject({ indexState: 'degraded', malformedCount: 1 })
    expect(await readFile(join(root, 'memory', 'damaged.json'), 'utf8')).toBe('{broken')
    await corrupt.shutdown()

    await removeIndexFiles(root)
    const migrationFailure = new HybridMemoryStore({
      dataDir: root,
      config: policy,
      beforeMigrate: () => { throw new Error('simulated migration failure') }
    })
    await migrationFailure.ready()
    await expect(migrationFailure.retrieve({ query: 'filesystem fallback', workspace: '/workspace-a', limit: 3 }))
      .resolves.toMatchObject([{ id: 'mem_fallback' }])
    expect((await migrationFailure.diagnostics()).degradedReason).toContain('migration failure')
    await migrationFailure.shutdown()
  })

  it('retries a transient indexed retrieval failure without restarting', async () => {
    const root = await tempRoot()
    let queryAttempts = 0
    const store = new HybridMemoryStore({
      dataDir: root,
      config: policy,
      beforeIndexQuery: (operation) => {
        if (operation === 'retrieve' && queryAttempts++ === 0) {
          throw new Error('simulated transient retrieval failure')
        }
      }
    })
    try {
      await store.createWithId('mem_recover', {
        content: 'Recover indexed retrieval without restart', scope: 'workspace', workspace: '/workspace-a'
      })

      await expect(store.retrieve({ query: 'recover indexed', workspace: '/workspace-a', limit: 3 }))
        .resolves.toMatchObject([{ id: 'mem_recover' }])
      expect(await store.diagnostics()).toMatchObject({
        indexState: 'degraded',
        degradedReason: expect.stringContaining('transient retrieval failure'),
        lastRetrieval: { mode: 'filesystem-fallback' }
      })

      await expect(store.retrieve({ query: 'recover indexed', workspace: '/workspace-a', limit: 3 }))
        .resolves.toMatchObject([{ id: 'mem_recover' }])
      expect(await store.diagnostics()).toMatchObject({
        indexState: 'ready',
        degradedReason: undefined,
        lastRetrieval: { mode: 'sqlite-fts5' }
      })
      expect(queryAttempts).toBe(2)
    } finally {
      await store.shutdown()
    }
  })

  it('retries a transient indexed list failure without restarting', async () => {
    const root = await tempRoot()
    let queryAttempts = 0
    const store = new HybridMemoryStore({
      dataDir: root,
      config: policy,
      beforeIndexQuery: (operation) => {
        if (operation === 'list' && queryAttempts++ === 0) {
          throw new Error('simulated transient list failure')
        }
      }
    })
    try {
      await store.createWithId('mem_list_recover', {
        content: 'Recover indexed list without restart', scope: 'workspace', workspace: '/workspace-a'
      })
      await expect(store.list({ workspace: '/workspace-a' }))
        .resolves.toMatchObject([{ id: 'mem_list_recover' }])
      expect(await store.diagnostics()).toMatchObject({
        indexState: 'degraded', degradedReason: expect.stringContaining('transient list failure')
      })

      await expect(store.list({ workspace: '/workspace-a' }))
        .resolves.toMatchObject([{ id: 'mem_list_recover' }])
      expect(await store.diagnostics()).toMatchObject({ indexState: 'ready', degradedReason: undefined })
      expect(queryAttempts).toBe(2)
    } finally {
      await store.shutdown()
    }
  })

  it('falls back and reconciles a stale canonical projection without restarting', async () => {
    const { root, store } = await createStore()
    try {
      await store.createWithId('mem_external', {
        content: 'Original searchable memory text', scope: 'workspace', workspace: '/workspace-a'
      })
      await store.waitForBackfill()
      const path = join(root, 'memory', 'mem_external.json')
      const record = JSON.parse(await readFile(path, 'utf8')) as Record<string, unknown>
      await writeFile(path, JSON.stringify({
        ...record,
        content: 'Externally updated canonical phrase',
        updatedAt: '2026-08-28T00:01:00.000Z'
      }, null, 2))

      expect(await store.diagnostics()).toMatchObject({ staleCount: 1, indexState: 'degraded' })
      await expect(store.retrieve({ query: 'externally updated', workspace: '/workspace-a', limit: 3 }))
        .resolves.toMatchObject([{ id: 'mem_external' }])
      expect((await store.diagnostics()).lastRetrieval?.mode).toBe('filesystem-fallback')

      await store.waitForBackfill()
      await expect(store.retrieve({ query: 'externally updated', workspace: '/workspace-a', limit: 3 }))
        .resolves.toMatchObject([{ id: 'mem_external' }])
      expect(await store.diagnostics()).toMatchObject({
        staleCount: 0,
        indexState: 'ready',
        degradedReason: undefined,
        lastRetrieval: { mode: 'sqlite-fts5' }
      })
    } finally {
      await store.shutdown()
    }
  })

  it('reconciles a failed canonical projection before indexed retrieval resumes', async () => {
    const root = await tempRoot()
    let failProjection = true
    const store = new HybridMemoryStore({
      dataDir: root,
      config: policy,
      beforeProject: () => {
        if (failProjection) throw new Error('simulated projection failure')
      }
    })
    try {
      await store.createWithId('mem_projection_recover', {
        content: 'Projection recovery stays searchable', scope: 'workspace', workspace: '/workspace-a'
      })
      failProjection = false
      await expect(store.retrieve({ query: 'projection recovery', workspace: '/workspace-a', limit: 3 }))
        .resolves.toMatchObject([{ id: 'mem_projection_recover' }])
      expect((await store.diagnostics()).lastRetrieval?.mode).toBe('filesystem-fallback')

      await store.waitForBackfill()
      await expect(store.retrieve({ query: 'projection recovery', workspace: '/workspace-a', limit: 3 }))
        .resolves.toMatchObject([{ id: 'mem_projection_recover' }])
      expect(await store.diagnostics()).toMatchObject({
        indexState: 'ready', staleCount: 0, lastRetrieval: { mode: 'sqlite-fts5' }
      })
    } finally {
      await store.shutdown()
    }
  })

  it('falls back until a failed purge projection removes the stale index row', async () => {
    const root = await tempRoot()
    let failRemove = true
    const store = new HybridMemoryStore({
      dataDir: root,
      config: policy,
      beforeIndexRemove: () => {
        if (failRemove) throw new Error('simulated purge projection failure')
      }
    })
    try {
      await store.createWithId('mem_purge_recover', {
        content: 'Purged memory must not leak from the index', scope: 'workspace', workspace: '/workspace-a'
      })
      await store.purge('mem_purge_recover')
      failRemove = false

      expect(await store.retrieve({ query: 'purged memory', workspace: '/workspace-a', limit: 3 })).toEqual([])
      expect((await store.diagnostics()).lastRetrieval?.mode).toBe('filesystem-fallback')

      await store.waitForBackfill()
      expect(await store.retrieve({ query: 'purged memory', workspace: '/workspace-a', limit: 3 })).toEqual([])
      expect(await store.diagnostics()).toMatchObject({
        canonicalCount: 0, indexedCount: 0, staleCount: 0, indexState: 'ready',
        lastRetrieval: { mode: 'sqlite-fts5' }
      })
    } finally {
      await store.shutdown()
    }
  })

  it('converges lifecycle and purge projections and protects exact paths', async () => {
    const { root, store } = await createStore()
    await store.createWithId('mem_lifecycle', {
      content: 'Lifecycle projection', scope: 'workspace', workspace: '/workspace-a'
    })
    await store.update('mem_lifecycle', { disabled: true }, { workspace: '/workspace-a' })
    expect(await store.retrieve({ query: 'lifecycle', workspace: '/workspace-a', limit: 3 })).toEqual([])
    await store.update('mem_lifecycle', { disabled: false }, { workspace: '/workspace-a' })
    await expect(store.retrieve({ query: 'lifecycle', workspace: '/workspace-a', limit: 3 }))
      .resolves.toMatchObject([{ id: 'mem_lifecycle' }])
    await store.delete('mem_lifecycle', { workspace: '/workspace-a' })
    expect(await store.retrieve({ query: 'lifecycle', workspace: '/workspace-a', limit: 3 })).toEqual([])
    await store.purge('mem_lifecycle')
    expect(await store.list({ all: true, includeDeleted: true })).toEqual([])
    expect(await store.diagnostics()).toMatchObject({ canonicalCount: 0, indexedCount: 0 })
    await expect(store.createWithId('../escape', { content: 'bad', scope: 'user' })).rejects.toThrow(/invalid memory id/u)
    expect(() => new HybridMemoryStore({
      dataDir: root, config: policy, sqlitePath: join(root, '..', 'outside.sqlite3')
    })).toThrow(/below the configured data directory/u)
    await store.shutdown()
  })

  it('serializes concurrent canonical writes and returns stable ordering', async () => {
    const { store } = await createStore()
    await Promise.all(Array.from({ length: 16 }, (_, index) => store.createWithId(`mem_concurrent_${index}`, {
      content: `Concurrent memory ${index}`, scope: 'workspace', workspace: '/workspace-a'
    })))
    await store.waitForBackfill()
    const first = (await store.retrieve({ query: 'concurrent memory', workspace: '/workspace-a', limit: 8 }))
      .map((record) => record.id)
    const second = (await store.retrieve({ query: 'concurrent memory', workspace: '/workspace-a', limit: 8 }))
      .map((record) => record.id)
    expect(first).toEqual(second)
    expect(first).toHaveLength(8)
    expect(await store.diagnostics()).toMatchObject({ canonicalCount: 16, indexedCount: 16, staleCount: 0 })
    await store.shutdown()
  })

  it('projects create and supersede by id without a full canonical list scan', async () => {
    const { store } = await createStore()
    const listSpy = vi.spyOn(FileMemoryStore.prototype, 'list')
    try {
      await store.createWithId('mem_supersede_source', {
        content: 'Superseded source memory', scope: 'workspace', workspace: '/workspace-a'
      })
      await store.createWithId('mem_supersede_dest', {
        content: 'Superseding memory', scope: 'workspace', workspace: '/workspace-a',
        supersedes: 'mem_supersede_source'
      })
      await store.waitForBackfill()

      expect(listSpy).not.toHaveBeenCalled()
      await expect(store.retrieve({ query: 'superseding memory', workspace: '/workspace-a', limit: 3 }))
        .resolves.toMatchObject([{ id: 'mem_supersede_dest' }])
      expect(await store.diagnostics()).toMatchObject({ canonicalCount: 2, indexedCount: 2, staleCount: 0 })
    } finally {
      listSpy.mockRestore()
      await store.shutdown()
    }
  })

  it('does not let backfill overwrite a foreground update that lands mid-backfill', async () => {
    const { root } = await seedCanonicalRecord('mem_race', 'stale snapshot content')
    const gate = backfillGate()
    const store = new HybridMemoryStore({
      dataDir: root,
      config: policy,
      nowIso: () => '2026-08-28T00:00:00.000Z',
      backfillBatchSize: 1,
      beforeBackfillBatch: gate.beforeBatch
    })
    try {
      await store.ready()
      await gate.arrived
      await store.update('mem_race', { content: 'fresh foreground update' }, { workspace: '/workspace-a' })
      gate.release()
      await store.waitForBackfill()

      await expect(store.retrieve({ query: 'fresh foreground', workspace: '/workspace-a', limit: 3 }))
        .resolves.toMatchObject([{ id: 'mem_race', content: 'fresh foreground update' }])
      expect((await store.diagnostics()).lastRetrieval?.mode).toBe('sqlite-fts5')
      expect(await store.list({ workspace: '/workspace-a' }))
        .toMatchObject([{ id: 'mem_race', content: 'fresh foreground update' }])
      const diagnostics = await store.diagnostics()
      expect(diagnostics).toMatchObject({
        indexState: 'ready',
        staleCount: 0,
        degradedReason: undefined
      })
      expect(diagnostics.indexedCount).toBeGreaterThanOrEqual(1)
      expect(JSON.parse(await readFile(join(root, 'memory', 'mem_race.json'), 'utf8'))).toMatchObject({
        id: 'mem_race',
        content: 'fresh foreground update'
      })
    } finally {
      await store.shutdown()
    }
  })

  it('does not resurrect a memory deleted during backfill', async () => {
    const { root } = await seedCanonicalRecord('mem_delete_race', 'will be deleted during backfill')
    const gate = backfillGate()
    const store = new HybridMemoryStore({
      dataDir: root,
      config: policy,
      nowIso: () => '2026-08-28T00:00:00.000Z',
      backfillBatchSize: 1,
      beforeBackfillBatch: gate.beforeBatch
    })
    try {
      await store.ready()
      await gate.arrived
      await store.delete('mem_delete_race', { workspace: '/workspace-a' })
      gate.release()
      await store.waitForBackfill()

      await expect(store.retrieve({ query: 'deleted during backfill', workspace: '/workspace-a', limit: 3 }))
        .resolves.toEqual([])
      expect(await store.list({ workspace: '/workspace-a' })).toEqual([])
      expect(await store.list({ all: true, includeDeleted: true }))
        .toMatchObject([{ id: 'mem_delete_race', deletedAt: expect.any(String) }])
      expect(await store.diagnostics()).toMatchObject({ staleCount: 0 })
    } finally {
      await store.shutdown()
    }
  })
})

async function createStore(): Promise<{ root: string; store: HybridMemoryStore }> {
  const root = await tempRoot()
  const store = new HybridMemoryStore({
    dataDir: root,
    config: policy,
    nowIso: () => '2026-08-28T00:00:00.000Z'
  })
  await store.ready()
  return { root, store }
}

async function tempRoot(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), 'kun-hybrid-memory-'))
  roots.push(root)
  return root
}

async function removeIndexFiles(root: string): Promise<void> {
  await Promise.all(['memory-index.sqlite3', 'memory-index.sqlite3-wal', 'memory-index.sqlite3-shm']
    .map((name) => rm(join(root, name), { force: true })))
}

async function seedCanonicalRecord(id: string, content: string): Promise<{ root: string }> {
  const root = await tempRoot()
  const seed = new HybridMemoryStore({
    dataDir: root,
    config: policy,
    nowIso: () => '2026-08-28T00:00:00.000Z'
  })
  await seed.ready()
  await seed.createWithId(id, { content, scope: 'workspace', workspace: '/workspace-a' })
  await seed.shutdown()
  await removeIndexFiles(root)
  return { root }
}

function backfillGate(): {
  arrived: Promise<void>
  release: () => void
  beforeBatch: () => Promise<void> | void
} {
  let release!: () => void
  let markArrived!: () => void
  const releaseSignal = new Promise<void>((resolve) => { release = resolve })
  const arrived = new Promise<void>((resolve) => { markArrived = resolve })
  let used = false
  return {
    arrived,
    release,
    beforeBatch: () => {
      if (used) return
      used = true
      markArrived()
      return releaseSignal
    }
  }
}
