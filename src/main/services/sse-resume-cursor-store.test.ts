import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { describe, expect, it } from 'vitest'
import { SseResumeCursorStore } from './sse-resume-cursor-store'

const cursor = (scopeId: string, lastSequence: number, updatedAt: string, runtimeGeneration = 'g1') => ({
  scopeId,
  streamId: 'stream-1',
  lastSequence,
  runtimeGeneration,
  updatedAt
})

describe('SseResumeCursorStore', () => {
  it('persists acknowledged cursors atomically and restores them', async () => {
    const root = await mkdtemp(join(tmpdir(), 'kun-sse-cursor-'))
    const path = join(root, 'nested', 'cursors.json')
    try {
      const store = new SseResumeCursorStore(path)
      expect(await store.save(cursor('thread-1', 4, '2026-07-14T00:00:00.000Z'))).toBe(true)
      expect(await store.get('thread-1')).toEqual(cursor('thread-1', 4, '2026-07-14T00:00:00.000Z'))
      const restored = new SseResumeCursorStore(path)
      expect(await restored.get('thread-1')).toEqual(cursor('thread-1', 4, '2026-07-14T00:00:00.000Z'))
      expect(JSON.parse(await readFile(path, 'utf8')).version).toBe(1)
    } finally {
      await rm(root, { recursive: true, force: true })
    }
  })

  it('does not move a cursor backwards within the same runtime generation', async () => {
    const root = await mkdtemp(join(tmpdir(), 'kun-sse-cursor-'))
    try {
      const store = new SseResumeCursorStore(join(root, 'cursors.json'))
      expect(await store.save(cursor('thread-1', 10, '2026-07-14T00:00:01.000Z'))).toBe(true)
      expect(await store.save(cursor('thread-1', 9, '2026-07-14T00:00:02.000Z'))).toBe(false)
      expect(await store.get('thread-1')).toEqual(cursor('thread-1', 10, '2026-07-14T00:00:01.000Z'))
      expect(await store.save(cursor('thread-1', 1, '2026-07-14T00:00:03.000Z', 'g2'))).toBe(true)
      expect(await store.get('thread-1')).toEqual(cursor('thread-1', 1, '2026-07-14T00:00:03.000Z', 'g2'))
    } finally {
      await rm(root, { recursive: true, force: true })
    }
  })

  it('serializes concurrent writes and trims oldest scopes', async () => {
    const root = await mkdtemp(join(tmpdir(), 'kun-sse-cursor-'))
    try {
      const store = new SseResumeCursorStore(join(root, 'cursors.json'), { maxEntries: 2 })
      await Promise.all([
        store.save(cursor('old', 1, '2026-07-14T00:00:00.000Z')),
        store.save(cursor('newer', 2, '2026-07-14T00:00:02.000Z')),
        store.save(cursor('newest', 3, '2026-07-14T00:00:03.000Z'))
      ])
      expect(await store.get('old')).toBeNull()
      expect(await store.list()).toHaveLength(2)
    } finally {
      await rm(root, { recursive: true, force: true })
    }
  })

  it('trims by timestamp when cursors use different UTC offsets', async () => {
    const root = await mkdtemp(join(tmpdir(), 'kun-sse-cursor-'))
    try {
      const store = new SseResumeCursorStore(join(root, 'cursors.json'), { maxEntries: 2 })
      await store.save(cursor('old', 1, '2026-07-14T02:00:00+02:00'))
      await store.save(cursor('newer', 2, '2026-07-14T00:30:00Z'))
      await store.save(cursor('newest', 3, '2026-07-14T01:00:00Z'))
      expect(await store.get('old')).toBeNull()
      expect(await store.list()).toEqual(expect.arrayContaining([
        expect.objectContaining({ scopeId: 'newer' }),
        expect.objectContaining({ scopeId: 'newest' })
      ]))
    } finally {
      await rm(root, { recursive: true, force: true })
    }
  })

  it('fails open on malformed data without overwriting the evidence', async () => {
    const root = await mkdtemp(join(tmpdir(), 'kun-sse-cursor-'))
    const path = join(root, 'cursors.json')
    try {
      await writeFile(path, '{not-json', 'utf8')
      const store = new SseResumeCursorStore(path)
      expect(await store.get('thread-1')).toBeNull()
      expect(await readFile(path, 'utf8')).toBe('{not-json')
    } finally {
      await rm(root, { recursive: true, force: true })
    }
  })

  it('does not permanently cache a transient read failure', async () => {
    const root = await mkdtemp(join(tmpdir(), 'kun-sse-cursor-'))
    const path = join(root, 'cursors.json')
    try {
      const store = new SseResumeCursorStore(path)
      await mkdir(path)
      await expect(store.get('thread-1')).rejects.toBeDefined()
      await rm(path, { recursive: true, force: true })
      await writeFile(path, JSON.stringify({ version: 1, cursors: {} }), 'utf8')
      await expect(store.get('thread-1')).resolves.toBeNull()
    } finally {
      await rm(root, { recursive: true, force: true })
    }
  })

  it('fails open for oversized cursor files without replacing evidence', async () => {
    const root = await mkdtemp(join(tmpdir(), 'kun-sse-cursor-'))
    const path = join(root, 'cursors.json')
    try {
      const oversized = '{' + 'x'.repeat(4 * 1024 * 1024) + '}'
      await writeFile(path, oversized, 'utf8')
      const store = new SseResumeCursorStore(path)
      expect(await store.get('thread-1')).toBeNull()
      expect((await readFile(path, 'utf8')).length).toBe(4 * 1024 * 1024 + 2)
    } finally {
      await rm(root, { recursive: true, force: true })
    }
  })

  it('ignores entries whose storage key does not match the cursor scope', async () => {
    const root = await mkdtemp(join(tmpdir(), 'kun-sse-cursor-'))
    const path = join(root, 'cursors.json')
    try {
      await writeFile(path, JSON.stringify({
        version: 1,
        cursors: {
          'wrong-key': cursor('thread-1', 7, '2026-07-14T00:00:00.000Z')
        }
      }), 'utf8')
      const store = new SseResumeCursorStore(path)
      expect(await store.get('thread-1')).toBeNull()
      expect(await store.list()).toEqual([])
    } finally {
      await rm(root, { recursive: true, force: true })
    }
  })
})
