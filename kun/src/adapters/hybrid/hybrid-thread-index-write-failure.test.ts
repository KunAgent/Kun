import { afterEach, describe, expect, it, vi } from 'vitest'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { Database as BetterSqliteDatabase } from 'better-sqlite3'
import { HybridThreadStore } from './hybrid-thread-store.js'
import { createThreadRecord } from '../../domain/thread.js'
import type { ThreadIndexRecord } from './hybrid-thread-index-mapping.js'

const roots: string[] = []

afterEach(async () => {
  for (const root of roots.splice(0)) {
    await rm(root, { recursive: true, force: true })
  }
})

async function createStore(): Promise<{ root: string; store: HybridThreadStore }> {
  const root = await mkdtemp(join(tmpdir(), 'kun-hybrid-index-write-'))
  roots.push(root)
  return { root, store: new HybridThreadStore({ dataDir: root }) }
}

type StoreInternals = {
  db: BetterSqliteDatabase | null
  index: { upsert(record: ThreadIndexRecord): void } | null
  dirtyIndex: { size: number; has(threadId: string): boolean; ids(): string[] }
  backfill: { wait(): Promise<void>; isIndexReady(): boolean } | null
}

function internals(store: HybridThreadStore): StoreInternals {
  return store as unknown as StoreInternals
}

function thread(id: string, title: string) {
  return createThreadRecord({ id, title, workspace: '/tmp/workspace', model: 'test-model' })
}

async function journalThreadIds(root: string): Promise<string[]> {
  const journal = JSON.parse(await readFile(join(root, 'index-dirty.json'), 'utf-8')) as {
    version: number
    threadIds?: string[]
  }
  return journal.threadIds ?? []
}

async function waitForJournal(root: string, predicate: (ids: string[]) => boolean): Promise<void> {
  for (let attempt = 0; attempt < 100; attempt += 1) {
    try {
      if (predicate(await journalThreadIds(root))) return
    } catch {
      // Journal not written yet.
    }
    await new Promise((resolve) => setTimeout(resolve, 10))
  }
  throw new Error('dirty journal did not reach the expected state in time')
}

describe('HybridThreadStore index write failure fallback', () => {
  it('keeps a failed upsert visible from canonical JSONL and repairs on a later list', async () => {
    const { store } = await createStore()
    await store.ready()
    const intern = internals(store)
    expect(intern.db).not.toBeNull()

    const original = thread('thread_busy', 'Original')
    await store.upsert(original)

    const busy = Object.assign(new Error('SQLITE_BUSY: database is locked'), { code: 'SQLITE_BUSY' })
    const upsertSpy = vi.spyOn(intern.index!, 'upsert').mockImplementation(() => { throw busy })

    await store.upsert({ ...original, title: 'Updated' })

    const first = await store.list({ includeArchived: true })
    expect(first.find((summary) => summary.id === original.id)?.title).toBe('Updated')
    expect(intern.dirtyIndex.has(original.id)).toBe(true)

    upsertSpy.mockRestore()
    await store.list({ includeArchived: true })
    const row = intern.db!.prepare('SELECT title FROM threads WHERE id = ?').get(original.id) as
      | { title: string }
      | undefined
    expect(row?.title).toBe('Updated')
    expect(intern.dirtyIndex.has(original.id)).toBe(false)

    store.close()
  })

  it('degrades and falls back when the INSERT statement throws at the repository level', async () => {
    const { store } = await createStore()
    await store.ready()
    const intern = internals(store)
    expect(intern.db).not.toBeNull()

    const record = thread('thread_full', 'Disk full')
    const db = intern.db!
    const originalPrepare = db.prepare.bind(db)
    const prepareSpy = vi.spyOn(db, 'prepare')
    prepareSpy.mockImplementation((sql: string) => {
      if (sql.trimStart().startsWith('INSERT INTO threads')) {
        return {
          run: () => {
            throw Object.assign(new Error('SQLITE_FULL: database or disk is full'), { code: 'SQLITE_FULL' })
          }
        } as unknown as ReturnType<typeof db.prepare>
      }
      return originalPrepare(sql)
    })

    try {
      await store.upsert(record)
      const summaries = await store.list({ includeArchived: true })
      expect(summaries.map((summary) => summary.id)).toContain(record.id)
      expect(intern.dirtyIndex.has(record.id)).toBe(true)
    } finally {
      prepareSpy.mockRestore()
      store.close()
    }
  })

  it('repairs a stale row across restarts via the persisted dirty journal', async () => {
    const { root, store: first } = await createStore()
    const record = thread('thread_restart', 'First')
    await first.upsert(record)
    await first.shutdown()

    const second = new HybridThreadStore({ dataDir: root })
    await second.ready()
    const secondInternals = internals(second)
    expect(secondInternals.db).not.toBeNull()
    const busy = Object.assign(new Error('SQLITE_BUSY: database is locked'), { code: 'SQLITE_BUSY' })
    const spy = vi.spyOn(secondInternals.index!, 'upsert').mockImplementation(() => { throw busy })
    await second.upsert({ ...record, title: 'Second' })
    spy.mockRestore()
    await second.shutdown()

    await waitForJournal(root, (ids) => ids.includes(record.id))

    const third = new HybridThreadStore({ dataDir: root })
    try {
      const summaries = await third.list({ includeArchived: true })
      expect(summaries.find((summary) => summary.id === record.id)?.title).toBe('Second')
      const row = internals(third).db!.prepare('SELECT title FROM threads WHERE id = ?').get(record.id) as
        | { title: string }
        | undefined
      expect(row?.title).toBe('Second')
      expect(internals(third).dirtyIndex.has(record.id)).toBe(false)
    } finally {
      third.close()
    }
  })

  it('keeps a failed touch visible from canonical updatedAt', async () => {
    const { store } = await createStore()
    await store.ready()
    const intern = internals(store)
    expect(intern.db).not.toBeNull()

    const record = thread('thread_touch', 'Touch')
    await store.upsert(record)

    const db = intern.db!
    const originalPrepare = db.prepare.bind(db)
    const prepareSpy = vi.spyOn(db, 'prepare')
    prepareSpy.mockImplementation((sql: string) => {
      if (sql.trimStart().startsWith('UPDATE threads') && sql.includes('updated_at')) {
        return {
          run: () => {
            throw Object.assign(new Error('SQLITE_IOERR: disk I/O error'), { code: 'SQLITE_IOERR' })
          }
        } as unknown as ReturnType<typeof db.prepare>
      }
      return originalPrepare(sql)
    })

    try {
      const updatedAt = '2026-09-04T10:00:00.000Z'
      await store.touch(record.id, updatedAt)
      expect(intern.dirtyIndex.has(record.id)).toBe(true)
      const summaries = await store.list({ includeArchived: true })
      expect(summaries.find((summary) => summary.id === record.id)?.updatedAt).toBe(updatedAt)
    } finally {
      prepareSpy.mockRestore()
      store.close()
    }
  })

  it('persists dirty thread ids to the journal and clears them after repair', async () => {
    const { root, store } = await createStore()
    await store.ready()
    const intern = internals(store)
    expect(intern.db).not.toBeNull()

    const record = thread('thread_journal', 'Journal')
    await store.upsert(record)

    const busy = Object.assign(new Error('SQLITE_BUSY: database is locked'), { code: 'SQLITE_BUSY' })
    const spy = vi.spyOn(intern.index!, 'upsert').mockImplementation(() => { throw busy })
    try {
      await store.upsert({ ...record, title: 'Journal Updated' })
      await waitForJournal(root, (ids) => ids.includes(record.id))
      expect(await journalThreadIds(root)).toContain(record.id)
    } finally {
      spy.mockRestore()
    }

    await store.list({ includeArchived: true })
    await waitForJournal(root, (ids) => ids.length === 0)
    expect(await journalThreadIds(root)).toEqual([])
    store.close()
  })
})
