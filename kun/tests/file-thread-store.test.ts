import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { FileThreadStore } from '../src/adapters/file/file-thread-store.js'
import { atomicWriteFile } from '../src/adapters/file/atomic-write.js'
import { createThreadRecord } from '../src/domain/thread.js'

const cleanup: string[] = []

afterEach(async () => {
  vi.restoreAllMocks()
  await Promise.all(cleanup.splice(0).map((path) => rm(path, { recursive: true, force: true })))
})

async function tempDir(label: string): Promise<string> {
  const path = await mkdtemp(join(tmpdir(), label))
  cleanup.push(path)
  return path
}

async function writeThread(dataDir: string, thread: ReturnType<typeof createThreadRecord>): Promise<void> {
  const dir = join(dataDir, 'threads', thread.id)
  await mkdir(dir, { recursive: true })
  await writeFile(join(dir, 'thread.json'), JSON.stringify(thread), 'utf8')
}

describe('FileThreadStore recovery', () => {
  it('rebuilds a missing index from thread directories', async () => {
    const dataDir = await tempDir('kun-file-thread-rebuild-')
    const first = createThreadRecord({ id: 'thr_first', title: 'First', workspace: '/tmp/a', model: 'test' })
    const second = createThreadRecord({ id: 'thr_second', title: 'Second', workspace: '/tmp/b', model: 'test' })
    await Promise.all([writeThread(dataDir, first), writeThread(dataDir, second)])

    const store = new FileThreadStore({ dataDir })
    await expect(store.list({ includeArchived: true, includeSide: true })).resolves.toHaveLength(2)
    const index = JSON.parse(await readFile(join(dataDir, 'threads', 'index.json'), 'utf8')) as { order: string[] }
    expect(index.order).toEqual(expect.arrayContaining([first.id, second.id]))
  })

  it('recovers a corrupt index from backup and reconciles newer disk threads', async () => {
    const dataDir = await tempDir('kun-file-thread-backup-')
    const first = createThreadRecord({ id: 'thr_backup', title: 'Backup', workspace: '/tmp/a', model: 'test' })
    const second = createThreadRecord({ id: 'thr_newer', title: 'Newer', workspace: '/tmp/a', model: 'test' })
    await Promise.all([writeThread(dataDir, first), writeThread(dataDir, second)])
    await writeFile(join(dataDir, 'threads', 'index.json'), '{"order":', 'utf8')
    await writeFile(join(dataDir, 'threads', 'index.json.bak'), JSON.stringify({
      order: [first.id], updatedAt: first.updatedAt
    }), 'utf8')
    const warning = vi.spyOn(console, 'warn').mockImplementation(() => undefined)

    const store = new FileThreadStore({ dataDir })
    const listed = await store.list({ includeArchived: true, includeSide: true })

    expect(listed.map((thread) => thread.id)).toEqual(expect.arrayContaining([first.id, second.id]))
    expect(warning).toHaveBeenCalled()
    expect(await readFile(join(dataDir, 'threads', 'index.json.bak'), 'utf8')).toContain(first.id)
  })

  it('does not hide a thread when the index write fails after its document was saved', async () => {
    const dataDir = await tempDir('kun-file-thread-fault-')
    let writes = 0
    const store = new FileThreadStore({
      dataDir,
      writeFile: async (path, contents) => {
        writes += 1
        if (writes === 2) throw Object.assign(new Error('injected index failure'), { code: 'EIO' })
        await atomicWriteFile(path, contents)
      }
    })
    const thread = createThreadRecord({ id: 'thr_interrupted', title: 'Interrupted', workspace: '/tmp/a', model: 'test' })

    await expect(store.upsert(thread)).rejects.toThrow('injected index failure')
    await expect(readFile(join(dataDir, 'threads', thread.id, 'thread.json'), 'utf8')).resolves.toContain(thread.id)
    await expect(store.list({ includeArchived: true })).resolves.toEqual([
      expect.objectContaining({ id: thread.id })
    ])
    await expect(new FileThreadStore({ dataDir }).list({ includeArchived: true })).resolves.toEqual([
      expect.objectContaining({ id: thread.id })
    ])
  })

  it('returns null only for a missing thread and rejects corrupt data', async () => {
    const dataDir = await tempDir('kun-file-thread-get-')
    const store = new FileThreadStore({ dataDir })
    await expect(store.get('thr_missing')).resolves.toBeNull()
    await mkdir(join(dataDir, 'threads', 'thr_corrupt'), { recursive: true })
    await writeFile(join(dataDir, 'threads', 'thr_corrupt', 'thread.json'), '{broken', 'utf8')
    await expect(store.get('thr_corrupt')).rejects.toThrow('parse thread thr_corrupt')
  })
})

describe('FileThreadStore pagination', () => {
  it('filters by workspace and returns stable cursor pages', async () => {
    const dataDir = await tempDir('kun-file-thread-page-')
    const createdAt = '2026-08-01T00:00:00.000Z'
    const records = [
      createThreadRecord({ id: 'thr_c', title: 'Alpha c', workspace: '/tmp/a', model: 'test', createdAt }),
      createThreadRecord({ id: 'thr_b', title: 'Alpha b', workspace: '/tmp/a', model: 'test', createdAt }),
      createThreadRecord({ id: 'thr_other', title: 'Alpha other', workspace: '/tmp/b', model: 'test', createdAt })
    ]
    const store = new FileThreadStore({ dataDir })
    for (const record of records) await store.upsert(record)

    const first = await store.listPage({ workspace: '/tmp/a', search: 'alpha', includeArchived: true, limit: 1 })
    expect(first).toMatchObject({ total: 2, hasMore: true })
    expect(first.nextCursor).toEqual(expect.any(String))
    const second = await store.listPage({
      workspace: '/tmp/a', search: 'alpha', includeArchived: true, limit: 1, cursor: first.nextCursor
    })
    expect(second).toMatchObject({ hasMore: false })
    expect(second).not.toHaveProperty('total')
    expect([...first.threads, ...second.threads].map((thread) => thread.id)).toEqual(['thr_c', 'thr_b'])
  })
})

describe('FileThreadStore permission migration', () => {
  it('normalizes a legacy thread without a reviewer to user without widening its policy', async () => {
    const dataDir = await tempDir('kun-file-thread-reviewer-')
    const thread = createThreadRecord({
      id: 'thr_legacy_reviewer', title: 'Legacy reviewer', workspace: '/tmp/project', model: 'deepseek-chat',
      approvalPolicy: 'never', sandboxMode: 'read-only', createdAt: '2026-07-29T00:00:00.000Z'
    })
    const { approvalReviewer: _reviewer, ...legacy } = thread
    await writeThread(dataDir, legacy as typeof thread)
    await writeFile(join(dataDir, 'threads', 'index.json'), JSON.stringify({
      order: [thread.id], updatedAt: thread.updatedAt
    }), 'utf8')

    const store = new FileThreadStore({ dataDir })
    await expect(store.get(thread.id)).resolves.toMatchObject({
      approvalPolicy: 'never', sandboxMode: 'read-only', approvalReviewer: 'user'
    })
  })
})
