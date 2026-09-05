import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { FileSessionEventsSizeTracker } from './file-session-events-size-tracker'

let root: string

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), 'kun-size-tracker-'))
})

afterEach(async () => {
  await rm(root, { recursive: true, force: true })
})

describe('FileSessionEventsSizeTracker', () => {
  it('adds record bytes to a tracked size without stat-ing again', async () => {
    const path = join(root, 'events.jsonl')
    await writeFile(path, 'a\n')
    const tracker = new FileSessionEventsSizeTracker(() => path)
    const first = await tracker.observeAfterAppend('t1', 2)
    expect(first.size).toBe(2)
    // Subsequent appends accumulate; dev/ino stay pinned to the first seed.
    const second = await tracker.observeAfterAppend('t1', 3)
    expect(second.size).toBe(5)
    expect(second.dev).toBe(first.dev)
    expect(second.ino).toBe(first.ino)
  })

  it('re-stats authoritative bytes after invalidate (trim/compaction)', async () => {
    const path = join(root, 'events.jsonl')
    await writeFile(path, 'aaaa\n')
    const tracker = new FileSessionEventsSizeTracker(() => path)
    expect((await tracker.observeAfterAppend('t1', 1)).size).toBe(5)
    // Simulate an event-retention trim: the file shrinks behind our back and
    // the store invalidates the tracked entry.
    await writeFile(path, 'aa\n')
    tracker.invalidate('t1')
    expect((await tracker.observeAfterAppend('t1', 1)).size).toBe(3)
  })

  it('clear drops every tracked entry', async () => {
    const path = join(root, 'events.jsonl')
    await writeFile(path, 'x\n')
    const tracker = new FileSessionEventsSizeTracker(() => path)
    await tracker.observeAfterAppend('t1', 1)
    tracker.clear()
    // 'x\n' is 2 bytes on disk; the refreshed stat must see exactly that.
    expect((await tracker.observeAfterAppend('t2', 0)).size).toBe(2)
  })

  it('stats a fresh thread without double-counting the appended record', async () => {
    const path = join(root, 'events.jsonl')
    await writeFile(path, 'record-1\n')
    const tracker = new FileSessionEventsSizeTracker(() => path)
    // First observation: stat runs after the append, so recordBytes must not
    // be added on top of the on-disk size.
    expect((await tracker.observeAfterAppend('fresh', 9)).size).toBe(9)
  })

  it('throws for a missing file instead of inventing a size', async () => {
    const tracker = new FileSessionEventsSizeTracker(() => join(root, 'missing.jsonl'))
    await expect(tracker.observeAfterAppend('t1', 1)).rejects.toThrow()
  })

  it('evicts the oldest entry once the thread cap is reached', async () => {
    const path = join(root, 'events.jsonl')
    await writeFile(path, 'z\n')
    const tracker = new FileSessionEventsSizeTracker(() => path, 2)
    await tracker.observeAfterAppend('t1', 0)
    await tracker.observeAfterAppend('t2', 0)
    await tracker.observeAfterAppend('t3', 0)
    // t1 was evicted, so observing it again re-stats from disk ('z\n' = 2).
    expect((await tracker.observeAfterAppend('t1', 0)).size).toBe(2)
  })
})
