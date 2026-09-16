import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import {
  CONTEXT_WINDOWS_NOTE_FILE_MAX_BYTES,
  CONTEXT_WINDOWS_NOTE_MAX_FILES_PER_THREAD,
  CONTEXT_WINDOWS_NOTE_TOTAL_MAX_BYTES
} from '../../contracts/context-windows.js'
import {
  FileContextWindowStore,
  QuotaExceededError
} from './file-context-window-store.js'
import type { ContextWindowStoreLimits } from '../../ports/context-window-store.js'

const LIMITS: ContextWindowStoreLimits = {
  maxFileBytes: CONTEXT_WINDOWS_NOTE_FILE_MAX_BYTES,
  maxFilesPerThread: CONTEXT_WINDOWS_NOTE_MAX_FILES_PER_THREAD,
  maxTotalBytes: CONTEXT_WINDOWS_NOTE_TOTAL_MAX_BYTES
}

describe('FileContextWindowStore', () => {
  let dataDir: string
  let store: FileContextWindowStore
  const now = () => '2026-09-14T00:00:00.000Z'

  beforeEach(async () => {
    dataDir = await mkdtemp(join(tmpdir(), 'kun-context-notes-'))
    store = new FileContextWindowStore({ dataDir, limits: LIMITS })
  })

  afterEach(async () => {
    await rm(dataDir, { recursive: true, force: true })
  })

  it('writes with revision CAS and reports conflicts with actual revision', async () => {
    const created = await store.writeNote('thread1', 'notes/a.md', 0, 'hello', now(), 0)
    expect(created).toEqual({ status: 'ok', path: 'notes/a.md', revision: 1 })

    const conflict = await store.writeNote('thread1', 'notes/a.md', 0, 'stale', now(), 0)
    expect(conflict).toEqual({
      status: 'conflict',
      path: 'notes/a.md',
      expectedRevision: 0,
      actualRevision: 1
    })

    const replaced = await store.writeNote('thread1', 'notes/a.md', 1, 'hello v2', now(), 0)
    expect(replaced).toEqual({ status: 'ok', path: 'notes/a.md', revision: 2 })
    const read = await store.readNote('thread1', 'notes/a.md')
    expect(read).toEqual({ content: 'hello v2', revision: 2 })
  })

  it('appends idempotently by operation id', async () => {
    const first = await store.appendNote('thread1', 'log.md', 'op-1', '- step 1\n', now(), 0)
    expect(first).toEqual({ status: 'applied', revision: 1 })
    const replay = await store.appendNote('thread1', 'log.md', 'op-1', '- step 1\n', now(), 0)
    expect(replay).toEqual({ status: 'replayed', revision: 1 })
    const second = await store.appendNote('thread1', 'log.md', 'op-2', '- step 2\n', now(), 0)
    expect(second).toEqual({ status: 'applied', revision: 2 })
    const read = await store.readNote('thread1', 'log.md')
    expect(read?.content).toBe('- step 1\n- step 2\n')
  })

  it('recovers committed notes and revisions after a restart', async () => {
    await store.writeNote('thread1', 'a.md', 0, 'one', now(), 0)
    await store.appendNote('thread1', 'a.md', 'op-1', '+two', now(), 0)
    const restarted = new FileContextWindowStore({ dataDir, limits: LIMITS })
    const read = await restarted.readNote('thread1', 'a.md')
    expect(read).toEqual({ content: 'one+two', revision: 2 })
    // The append journal survives too, so a retried operation id still replays.
    const replay = await restarted.appendNote('thread1', 'a.md', 'op-1', '+two', now(), 0)
    expect(replay).toEqual({ status: 'replayed', revision: 2 })
  })

  it('lists note files with sizes and revisions', async () => {
    await store.writeNote('thread1', 'b/2.md', 0, 'two', now(), 0)
    await store.writeNote('thread1', 'a/1.md', 0, 'one', now(), 0)
    const files = await store.listNoteFiles('thread1')
    expect(files.map((file) => file.path)).toEqual(['a/1.md', 'b/2.md'])
    expect(files[0]).toMatchObject({ revision: 1, byteSize: 3 })
  })

  it('rejects per-file, file-count, and multibyte quotas without partial mutation', async () => {
    const oversized = 'x'.repeat(CONTEXT_WINDOWS_NOTE_FILE_MAX_BYTES + 1)
    await expect(store.writeNote('thread1', 'big.md', 0, oversized, now(), 0))
      .rejects.toThrow(QuotaExceededError)
    expect(await store.readNote('thread1', 'big.md')).toBeNull()

    await store.writeNote('thread1', 'ok.md', 0, 'fine', now(), 0)
    const before = await store.listNoteFiles('thread1')
    // The byte ceiling counts UTF-8 bytes, not characters.
    await expect(store.writeNote('thread1', 'a.md', 0, '汉'.repeat(CONTEXT_WINDOWS_NOTE_FILE_MAX_BYTES), now(), 0))
      .rejects.toThrow(QuotaExceededError)
    expect(await store.listNoteFiles('thread1')).toEqual(before)

    // ok.md already occupies one slot; 99 more fill the 100-file quota.
    for (let index = 0; index < CONTEXT_WINDOWS_NOTE_MAX_FILES_PER_THREAD - 1; index += 1) {
      await store.writeNote('thread1', `f${index}.md`, 0, 'x', now(), 0)
    }
    await expect(store.writeNote('thread1', 'one-more.md', 0, 'x', now(), 0))
      .rejects.toThrow(QuotaExceededError)
    expect(await store.readNote('thread1', 'one-more.md')).toBeNull()
  })

  it('enforces the per-thread total quota without partial mutation', async () => {
    const small = new FileContextWindowStore({
      dataDir,
      limits: { maxFileBytes: 64, maxFilesPerThread: 100, maxTotalBytes: 100 }
    })
    await small.writeNote('thread1', 'a.md', 0, 'x'.repeat(60), now(), 0)
    await small.writeNote('thread1', 'b.md', 0, 'x'.repeat(40), now(), 0)
    await expect(small.writeNote('thread1', 'a.md', 1, 'x'.repeat(61), now(), 0))
      .rejects.toThrow(QuotaExceededError)
    expect((await small.readNote('thread1', 'a.md'))?.content).toBe('x'.repeat(60))
    expect((await small.readNote('thread1', 'b.md'))?.content).toBe('x'.repeat(40))
  })

  it('copies note data on fork and isolates later mutations', async () => {
    await store.writeNote('thread1', 'a.md', 0, 'base', now(), 0)
    await store.appendNote('thread1', 'a.md', 'op-1', '+v1', now(), 0)
    await store.copyThreadData('thread1', 'thread2')

    const child = await store.readNote('thread2', 'a.md')
    expect(child).toEqual({ content: 'base+v1', revision: 2 })
    await store.appendNote('thread2', 'a.md', 'op-2', '+child', now(), 0)
    const parent = await store.readNote('thread1', 'a.md')
    expect(parent?.content).toBe('base+v1')
    expect((await store.readNote('thread2', 'a.md'))?.content).toBe('base+v1+child')
    // The fork inherits the commit sequence: a source operation id replays in
    // the child instead of duplicating content.
    const childReplay = await store.appendNote('thread2', 'a.md', 'op-1', '+v1', now(), 0)
    expect(childReplay).toEqual({ status: 'replayed', revision: 2 })
    expect((await store.readNote('thread2', 'a.md'))?.content).toBe('base+v1+child')
  })

  it('removes all feature data on delete without touching the thread dir', async () => {
    await store.writeNote('thread1', 'a.md', 0, 'gone', now(), 0)
    await store.deleteThreadData('thread1')
    expect(await store.listNoteFiles('thread1')).toEqual([])
    expect(await store.readNote('thread1', 'a.md')).toBeNull()
    // A later write still works from a clean slate.
    await store.writeNote('thread1', 'b.md', 0, 'fresh', now(), 0)
    expect((await store.readNote('thread1', 'b.md'))?.content).toBe('fresh')
  })

  it('records an immutable version per commit and enforces the per-file retention bound', async () => {
    const bounded = new FileContextWindowStore({
      dataDir,
      limits: { ...LIMITS, maxVersionsPerFile: 3 }
    })
    for (let revision = 1; revision <= 5; revision += 1) {
      await bounded.writeNote('thread1', 'a.md', revision - 1, `v${revision}`, now(), revision)
    }
    const read = await bounded.readNote('thread1', 'a.md')
    expect(read).toEqual({ content: 'v5', revision: 5 })
    // A head fork replays the retained versions: the three newest snapshots
    // survive, the two oldest were evicted, and current content is intact.
    await bounded.copyThreadData('thread1', 'thread2')
    expect(await bounded.readNote('thread2', 'a.md')).toEqual({ content: 'v5', revision: 5 })
    // A cutoff fork replays the newest snapshot at or below the cutoff that
    // is still retained.
    await bounded.copyThreadData('thread1', 'thread3', 3)
    expect(await bounded.readNote('thread3', 'a.md')).toEqual({ content: 'v3', revision: 1 })
  })

  it('enforces the per-thread version byte bound without touching current content', async () => {
    const bounded = new FileContextWindowStore({
      dataDir,
      limits: { ...LIMITS, maxVersionsPerFile: 100, maxVersionBytesPerThread: 30 }
    })
    for (let revision = 1; revision <= 4; revision += 1) {
      await bounded.writeNote('thread1', 'a.md', revision - 1, `aaaaaaaa${revision}`, now(), revision)
    }
    expect((await bounded.readNote('thread1', 'a.md'))?.content).toBe('aaaaaaaa4')
    // Version bytes over the cap are evicted oldest-first; replay at an old
    // cutoff can only reach the oldest retained snapshot.
    await bounded.copyThreadData('thread1', 'thread2', 2)
    expect(await bounded.readNote('thread2', 'a.md')).toEqual({ content: 'aaaaaaaa2', revision: 1 })
  })

  it('forks only the versions committed at or before the cutoff and isolates later writes', async () => {
    await store.writeNote('thread1', 'a.md', 0, 'v1', now(), 1)
    await store.appendNote('thread1', 'a.md', 'op-v2', '+v2', now(), 5)
    await store.copyThreadData('thread1', 'thread2', 1)

    const child = await store.readNote('thread2', 'a.md')
    expect(child).toEqual({ content: 'v1', revision: 1 })
    // The post-cutoff append journal entry stays private to the source: the
    // same operation id applies fresh in the child instead of replaying.
    const childApply = await store.appendNote('thread2', 'a.md', 'op-v2', '+child', now(), 1)
    expect(childApply).toEqual({ status: 'applied', revision: 2 })
    expect((await store.readNote('thread2', 'a.md'))?.content).toBe('v1+child')
    expect((await store.readNote('thread1', 'a.md'))?.content).toBe('v1+v2')
    // Files with no version at or below the cutoff are dropped entirely.
    await store.writeNote('thread1', 'b.md', 0, 'later only', now(), 9)
    await store.copyThreadData('thread1', 'thread3', 1)
    expect(await store.readNote('thread3', 'b.md')).toBeNull()
    expect(await store.readNote('thread3', 'a.md')).toEqual({ content: 'v1', revision: 1 })
  })

  it('loads legacy schema v1 state files and backfills their first version on commit', async () => {
    const statePath = join(dataDir, 'threads', 'thread1', 'context-notes.json')
    await mkdir(dirname(statePath), { recursive: true })
    await writeFile(statePath, JSON.stringify({
      schemaVersion: 1,
      files: { 'legacy.md': { revision: 2, byteSize: 8, updatedAt: now(), content: 'legacy-v2' } },
      appends: { 'op-1': { path: 'legacy.md', revision: 2 } }
    }), 'utf8')

    const restarted = new FileContextWindowStore({ dataDir, limits: LIMITS })
    expect(await restarted.readNote('thread1', 'legacy.md'))
      .toEqual({ content: 'legacy-v2', revision: 2 })
    // Legacy content predates version tracking: it is treated as pre-fork
    // content and copied by a cutoff fork as-is.
    await restarted.copyThreadData('thread1', 'thread2', 0)
    expect(await restarted.readNote('thread2', 'legacy.md'))
      .toEqual({ content: 'legacy-v2', revision: 2 })
    // The first versioned commit backfills the pre-existing content so the
    // file joins the version chain; replay then reaches it.
    await restarted.writeNote('thread1', 'legacy.md', 2, 'legacy-v3', now(), 3)
    await restarted.copyThreadData('thread1', 'thread3', 3)
    // The child revision counts the replayed versions: the backfilled legacy
    // snapshot plus the new commit.
    expect(await restarted.readNote('thread3', 'legacy.md'))
      .toEqual({ content: 'legacy-v3', revision: 2 })
    // The backfilled legacy snapshot is stamped as pre-fork content, so an
    // older cutoff replays it while the newer committed version is excluded.
    await restarted.copyThreadData('thread1', 'thread4', 0)
    expect(await restarted.readNote('thread4', 'legacy.md'))
      .toEqual({ content: 'legacy-v2', revision: 1 })
  })
})
