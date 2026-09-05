import { mkdtemp, rm, stat, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { updateHighestSeqCache, type HighestSeqCacheEntry } from './file-session-cursor-checkpoint'
import { loadFileSessionHighestSeq } from './file-session-highest-seq'
import type { JsonlFileAccessCoordinator } from './jsonl-file-access'

let root: string

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), 'kun-highest-seq-'))
})

afterEach(async () => {
  await rm(root, { recursive: true, force: true })
})

describe('updateHighestSeqCache', () => {
  it('stores a size-only entry with mtimeMs null', () => {
    const cache = new Map<string, HighestSeqCacheEntry>()
    updateHighestSeqCache({
      cache,
      threadId: 't1',
      seq: 9,
      info: { size: 123, mtimeMs: null },
      maxThreads: 4
    })
    expect(cache.get('t1')).toEqual({ seq: 9, size: 123, mtimeMs: null })
  })
})

describe('loadFileSessionHighestSeq', () => {
  const fileAccess = {
    withRead: <T>(_path: string, operation: () => Promise<T>): Promise<T> => operation()
  } as unknown as JsonlFileAccessCoordinator

  it('hits on a size-only entry whose size matches and upgrades to a real mtimeMs', async () => {
    const path = join(root, 'events.jsonl')
    await writeFile(path, '{"seq":7,"timestamp":"t","threadId":"thr","kind":"heartbeat"}\n')
    const info = await stat(path)

    const cache = new Map<string, HighestSeqCacheEntry>()
    cache.set('thr', { seq: 7, size: info.size, mtimeMs: null })
    const iterate = vi.fn<() => AsyncIterable<never>>()

    const result = await loadFileSessionHighestSeq({
      path,
      fileAccess,
      cached: () => cache.get('thr'),
      clearCached: () => { cache.delete('thr') },
      cache: (seq, nextInfo) => {
        cache.set('thr', { seq, size: nextInfo.size, mtimeMs: nextInfo.mtimeMs })
      },
      iterate
    })

    expect(result).toBe(7)
    expect(iterate).not.toHaveBeenCalled()
    expect(cache.get('thr')?.mtimeMs).toBe(info.mtimeMs)
  })

  it('re-scans when the cached size no longer matches the on-disk size', async () => {
    const path = join(root, 'events.jsonl')
    await writeFile(path, '{"seq":7,"timestamp":"t","threadId":"thr","kind":"heartbeat"}\n')

    const cache = new Map<string, HighestSeqCacheEntry>()
    cache.set('thr', { seq: 99, size: 0, mtimeMs: null })
    const iterate = vi.fn<() => AsyncIterable<never>>()

    const result = await loadFileSessionHighestSeq({
      path,
      fileAccess,
      cached: () => cache.get('thr'),
      clearCached: () => { cache.delete('thr') },
      cache: (seq, nextInfo) => {
        cache.set('thr', { seq, size: nextInfo.size, mtimeMs: nextInfo.mtimeMs })
      },
      iterate
    })

    expect(result).toBe(7)
    expect(iterate).not.toHaveBeenCalled()
    expect(cache.get('thr')?.mtimeMs).toBeTypeOf('number')
  })
})
