import { appendFile, mkdir, mkdtemp, readFile, rename, rm, stat, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { FileSessionEventIndex, eventIndexPaths, eventIndexPublishConflict } from './file-session-event-index.js'
import { FileSessionEventIndexRebuild } from './file-session-event-index-rebuild.js'
import { EVENT_INDEX_REBUILD_TORN_TAIL_STABLE_MS, readEventIndexRebuildDiagnostic } from './file-session-event-index-diagnostic.js'
import { iterateRuntimeEventsJsonl } from './file-session-jsonl.js'
import { JsonlFileAccessCoordinator } from './jsonl-file-access.js'

const roots: string[] = []

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })))
})

function record(threadId: string, seq: number): string {
  return `${JSON.stringify({
    kind: 'heartbeat', seq, threadId, timestamp: '2026-09-03T00:00:00.000Z'
  })}\n`
}

async function writeEvents(threadDir: string, threadId: string, count: number): Promise<string> {
  const path = join(threadDir, 'events.jsonl')
  await mkdir(threadDir, { recursive: true, mode: 0o700 })
  await writeFile(path, '')
  for (let seq = 1; seq <= count; seq += 1) {
    await appendFile(path, record(threadId, seq))
  }
  return path
}

async function newRebuild(
  threadsDir: string,
  index: FileSessionEventIndex,
  limits: { maxBytes?: number; maxEvents?: number; maxMs?: number } = {},
  options: { maxRecordBytes?: number; now?: () => number } = {}
): Promise<FileSessionEventIndexRebuild> {
  return new FileSessionEventIndexRebuild({
    threadsDir,
    eventsPathFor: (threadId) => join(threadsDir, threadId, 'events.jsonl'),
    fileAccess: new JsonlFileAccessCoordinator(),
    index,
    maxRecordBytes: options.maxRecordBytes ?? 4 * 1024 * 1024,
    limits,
    now: options.now
  })
}

async function runToCompletion(rebuild: FileSessionEventIndexRebuild): Promise<void> {
  for (let index = 0; index < 2000; index += 1) {
    if (await rebuild.runSlice()) return
  }
  throw new Error('rebuild did not complete within slice budget')
}

describe('FileSessionEventIndexRebuild', () => {
  it('rebuilds a sparse index across slices and publishes atomically', async () => {
    const root = await mkdtemp(join(tmpdir(), 'kun-event-rebuild-'))
    roots.push(root)
    const threadsDir = join(root, 'threads')
    const threadId = 'thread-rebuild'
    const threadDir = join(threadsDir, threadId)
    const eventsPath = await writeEvents(threadDir, threadId, 600)

    const index = new FileSessionEventIndex()
    const rebuild = await newRebuild(threadsDir, index, { maxEvents: 100 })

    // Midway, the foreground read must still fall back safely.
    await rebuild.runSlice()
    expect(await index.startOffset(threadId, eventsPath, 590)).toBe(0)
    const fallbackEvents: number[] = []
    for await (const event of iterateRuntimeEventsJsonl(eventsPath, 590, 1024 * 1024, 0)) {
      fallbackEvents.push(event.seq)
    }
    expect(fallbackEvents).toEqual([591, 592, 593, 594, 595, 596, 597, 598, 599, 600])

    await runToCompletion(rebuild)

    const offset = await index.startOffset(threadId, eventsPath, 590)
    expect(offset).toBeGreaterThan(0)
    const events: number[] = []
    for await (const event of iterateRuntimeEventsJsonl(eventsPath, 590, 1024 * 1024, offset)) {
      events.push(event.seq)
    }
    expect(events).toEqual([591, 592, 593, 594, 595, 596, 597, 598, 599, 600])

    // Staging files are removed; the source log is untouched.
    const paths = eventIndexPaths(eventsPath)
    await expect(stat(paths.rebuildBin)).rejects.toThrow()
    await expect(stat(paths.rebuildState)).rejects.toThrow()
    await expect(stat(paths.bin)).resolves.toBeTruthy()
    await expect(stat(paths.state)).resolves.toBeTruthy()
    expect(await stat(eventsPath)).toBeTruthy()
  })

  it('resumes a partial rebuild after restart from the persisted cursor', async () => {
    const root = await mkdtemp(join(tmpdir(), 'kun-event-rebuild-resume-'))
    roots.push(root)
    const threadsDir = join(root, 'threads')
    const threadId = 'thread-resume'
    const threadDir = join(threadsDir, threadId)
    const eventsPath = await writeEvents(threadDir, threadId, 600)

    const index = new FileSessionEventIndex()
    const first = await newRebuild(threadsDir, index, { maxEvents: 100 })
    await first.runSlice()

    const paths = eventIndexPaths(eventsPath)
    const persisted = JSON.parse(await readFile(paths.rebuildState, 'utf8')) as { byteCursor: number }
    expect(persisted.byteCursor).toBeGreaterThan(0)

    // Simulate a runtime restart with a fresh coordinator over the same files.
    const resumed = await newRebuild(threadsDir, index, { maxEvents: 100 })
    await runToCompletion(resumed)

    expect(await index.startOffset(threadId, eventsPath, 590)).toBeGreaterThan(0)
  })

  it('discards staging and rebuilds when the source file identity changes', async () => {
    const root = await mkdtemp(join(tmpdir(), 'kun-event-rebuild-identity-'))
    roots.push(root)
    const threadsDir = join(root, 'threads')
    const threadId = 'thread-identity'
    const threadDir = join(threadsDir, threadId)
    const eventsPath = await writeEvents(threadDir, threadId, 600)

    const index = new FileSessionEventIndex()
    const rebuild = await newRebuild(threadsDir, index, { maxEvents: 100 })
    await rebuild.runSlice()

    // Replace events.jsonl with a shorter file (new inode).
    const replaced = join(threadDir, 'events.replacement.jsonl')
    await writeFile(replaced, '')
    for (let seq = 1; seq <= 40; seq += 1) await appendFile(replaced, record(threadId, seq))
    await rename(replaced, eventsPath)

    await runToCompletion(rebuild)

    // The new 40-event file must be indexed, not the replaced 600-event one.
    const offset = await index.startOffset(threadId, eventsPath, 30)
    const events: number[] = []
    for await (const event of iterateRuntimeEventsJsonl(eventsPath, 30, 1024 * 1024, offset)) {
      events.push(event.seq)
    }
    expect(events).toEqual([31, 32, 33, 34, 35, 36, 37, 38, 39, 40])
  })

  it('keeps extending the index after a rebuild-time append', async () => {
    const root = await mkdtemp(join(tmpdir(), 'kun-event-rebuild-append-'))
    roots.push(root)
    const threadsDir = join(root, 'threads')
    const threadId = 'thread-append'
    const threadDir = join(threadsDir, threadId)
    const eventsPath = await writeEvents(threadDir, threadId, 600)

    const index = new FileSessionEventIndex()
    const rebuild = await newRebuild(threadsDir, index, { maxEvents: 100 })
    await runToCompletion(rebuild)

    // Append one more event through the normal recordAppend path.
    await appendFile(eventsPath, record(threadId, 601))
    const info = await stat(eventsPath)
    await index.recordAppend({
      threadId,
      sourcePath: eventsPath,
      seq: 601,
      recordOffset: info.size - Buffer.byteLength(record(threadId, 601)),
      sourceSize: info.size,
      dev: info.dev,
      ino: info.ino
    })

    expect(await index.startOffset(threadId, eventsPath, 600)).toBeGreaterThan(0)
  })

  it('skips a thread that already has a valid index', async () => {
    const root = await mkdtemp(join(tmpdir(), 'kun-event-rebuild-skip-'))
    roots.push(root)
    const threadsDir = join(root, 'threads')
    const threadId = 'thread-skip'
    const threadDir = join(threadsDir, threadId)
    const eventsPath = await writeEvents(threadDir, threadId, 40)

    const index = new FileSessionEventIndex()
    // Build a valid index the normal way.
    for (let seq = 1; seq <= 40; seq += 1) {
      const recordBytes = Buffer.byteLength(record(threadId, seq))
      const info = await stat(eventsPath)
      await index.recordAppend({
        threadId,
        sourcePath: eventsPath,
        seq,
        recordOffset: info.size - recordBytes,
        sourceSize: info.size,
        dev: info.dev,
        ino: info.ino
      })
    }
    const binBefore = (await stat(eventIndexPaths(eventsPath).bin)).mtimeMs

    const rebuild = await newRebuild(threadsDir, index, { maxEvents: 100 })
    await runToCompletion(rebuild)

    expect((await stat(eventIndexPaths(eventsPath).bin)).mtimeMs).toBe(binBefore)
    expect(rebuild.stats()).toMatchObject({ skippedValid: 1, published: 0 })
  })

  it('invalidating the index also removes in-progress staging files', async () => {
    const root = await mkdtemp(join(tmpdir(), 'kun-event-rebuild-invalidate-'))
    roots.push(root)
    const threadsDir = join(root, 'threads')
    const threadId = 'thread-invalidate'
    const threadDir = join(threadsDir, threadId)
    const eventsPath = await writeEvents(threadDir, threadId, 600)

    const index = new FileSessionEventIndex()
    const rebuild = await newRebuild(threadsDir, index, { maxEvents: 100 })
    await rebuild.runSlice()

    await index.invalidate(threadId, eventsPath)
    const paths = eventIndexPaths(eventsPath)
    await expect(stat(paths.rebuildBin)).rejects.toThrow()
    await expect(stat(paths.rebuildState)).rejects.toThrow()
  })

  it('priority rebuild does not advance the sequential sweep cursor or skip threads', async () => {
    const root = await mkdtemp(join(tmpdir(), 'kun-event-rebuild-priority-'))
    roots.push(root)
    const threadsDir = join(root, 'threads')
    const ids = ['thread-a', 'thread-b', 'thread-c', 'thread-d']
    const paths = new Map<string, string>()
    for (const id of ids) {
      paths.set(id, await writeEvents(join(threadsDir, id), id, 300))
    }

    const index = new FileSessionEventIndex()
    const rebuild = await newRebuild(threadsDir, index, {})
    rebuild.request('thread-d')
    await runToCompletion(rebuild)

    // Priority thread `thread-d` must not move the cursor past b/c.
    for (const id of ids) {
      expect(await index.startOffset(id, paths.get(id)!, 290)).toBeGreaterThan(0)
    }
    expect(rebuild.stats()).toMatchObject({ published: 4, skippedValid: 1 })
  }, 30000)

  it('persists the priority source across slices and restarts', async () => {
    const root = await mkdtemp(join(tmpdir(), 'kun-event-rebuild-source-'))
    roots.push(root)
    const threadsDir = join(root, 'threads')
    const threadId = 'thread-d'
    const threadDir = join(threadsDir, threadId)
    const eventsPath = await writeEvents(threadDir, threadId, 600)

    const index = new FileSessionEventIndex()
    const rebuild = await newRebuild(threadsDir, index, { maxEvents: 100 })
    rebuild.request(threadId)
    await rebuild.runSlice()
    await rebuild.runSlice()

    const sweep = JSON.parse(await readFile(join(threadsDir, 'event-index-rebuild.sweep.json'), 'utf8'))
    expect(sweep.inProgress.threadId).toBe(threadId)
    expect(sweep.inProgressSource).toBe('priority')
    expect(sweep.cursor).toBeUndefined()

    await runToCompletion(rebuild)
    expect(await index.startOffset(threadId, eventsPath, 590)).toBeGreaterThan(0)

    // A fresh instance over the same files must resume without losing source.
    const resumed = await newRebuild(threadsDir, index, { maxEvents: 100 })
    await runToCompletion(resumed)
    expect(await index.startOffset(threadId, eventsPath, 590)).toBeGreaterThan(0)
  })

  it('recovers a legacy sweep file without inProgressSource', async () => {
    const root = await mkdtemp(join(tmpdir(), 'kun-event-rebuild-legacy-'))
    roots.push(root)
    const threadsDir = join(root, 'threads')
    const threadB = 'thread-b'
    const threadC = 'thread-c'
    const pathB = await writeEvents(join(threadsDir, threadB), threadB, 300)
    const pathC = await writeEvents(join(threadsDir, threadC), threadC, 300)

    // Old schema: no inProgressSource field.
    await writeFile(join(threadsDir, 'event-index-rebuild.sweep.json'), JSON.stringify({
      version: 1,
      generation: 0,
      cursor: 'thread-a',
      inProgress: threadC
    }))

    const index = new FileSessionEventIndex()
    const rebuild = await newRebuild(threadsDir, index, {})
    await runToCompletion(rebuild)

    // Defaulting the missing source to 'priority' keeps the cursor at
    // 'thread-a', so thread-b is still visited by the sequential sweep.
    expect(await index.startOffset(threadB, pathB, 290)).toBeGreaterThan(0)
    expect(await index.startOffset(threadC, pathC, 290)).toBeGreaterThan(0)
    expect(rebuild.stats()).toMatchObject({ published: 2, skippedValid: 1 })
  }, 30000)

  it('quarantines a stable torn tail and keeps the index over complete records', async () => {
    const root = await mkdtemp(join(tmpdir(), 'kun-event-rebuild-torntail-'))
    roots.push(root)
    const threadsDir = join(root, 'threads')
    const threadId = 'thread-torntail'
    const threadDir = join(threadsDir, threadId)
    await mkdir(threadDir, { recursive: true, mode: 0o700 })
    const eventsPath = join(threadDir, 'events.jsonl')
    await writeFile(eventsPath, '')
    for (let seq = 1; seq <= 300; seq += 1) await appendFile(eventsPath, record(threadId, seq))
    // Unterminated final record with no trailing newline.
    await appendFile(eventsPath, '{"kind":"heartbeat","seq":301,"threadId":"thread-torntail","timestamp":"2026-09-03T00:00:00.000Z"}')

    const index = new FileSessionEventIndex()
    let now = 1_000_000
    const rebuild = await newRebuild(threadsDir, index, {}, { now: () => now })

    // First slice scans complete records and stalls on the torn tail.
    expect(await rebuild.runSlice()).toBe(false)
    expect(rebuild.stats().published).toBe(0)
    expect(await index.startOffset(threadId, eventsPath, 290)).toBe(0)

    // Advancing the clock past the stability window quarantines the tail.
    now += EVENT_INDEX_REBUILD_TORN_TAIL_STABLE_MS + 1
    expect(await rebuild.runSlice()).toBe(true)

    expect(await index.startOffset(threadId, eventsPath, 290)).toBeGreaterThan(0)
    const state = JSON.parse(await readFile(eventIndexPaths(eventsPath).state, 'utf8'))
    expect(state.entryCount).toBeGreaterThan(0)
    expect(state.indexedBytes).toBe((await stat(eventsPath)).size)
    const diagnostic = await readEventIndexRebuildDiagnostic(eventIndexPaths(eventsPath).diagnostic)
    expect(diagnostic).toMatchObject({ reason: 'torn_tail' })
  })

  it('publishes a zero-entry index when every line is invalid', async () => {
    const root = await mkdtemp(join(tmpdir(), 'kun-event-rebuild-all-invalid-'))
    roots.push(root)
    const threadsDir = join(root, 'threads')
    const threadId = 'thread-all-invalid'
    const threadDir = join(threadsDir, threadId)
    const eventsPath = join(threadDir, 'events.jsonl')
    await mkdir(threadDir, { recursive: true, mode: 0o700 })
    await writeFile(eventsPath, '')
    for (let i = 0; i < 5; i += 1) await appendFile(eventsPath, 'not-json\n')

    const index = new FileSessionEventIndex()
    const rebuild = await newRebuild(threadsDir, index, {})
    await runToCompletion(rebuild)

    const paths = eventIndexPaths(eventsPath)
    expect((await stat(paths.bin)).size).toBe(0)
    const state = JSON.parse(await readFile(paths.state, 'utf8'))
    expect(state.entryCount).toBe(0)
    expect(state.indexedBytes).toBe((await stat(eventsPath)).size)
    expect(rebuild.stats().published).toBe(1)

    // The next sweep recognizes the zero-entry index and does not re-publish.
    const again = await newRebuild(threadsDir, index, {})
    await runToCompletion(again)
    expect(again.stats()).toMatchObject({ published: 0, skippedValid: 1 })

    const diagnostic = await readEventIndexRebuildDiagnostic(paths.diagnostic)
    expect(diagnostic).toMatchObject({ reason: 'invalid_record' })
    expect(typeof diagnostic?.byteOffset).toBe('number')
  })

  it('publishes a zero-entry index when every line is oversized', async () => {
    const root = await mkdtemp(join(tmpdir(), 'kun-event-rebuild-all-oversized-'))
    roots.push(root)
    const threadsDir = join(root, 'threads')
    const threadId = 'thread-all-oversized'
    const threadDir = join(threadsDir, threadId)
    const eventsPath = join(threadDir, 'events.jsonl')
    await mkdir(threadDir, { recursive: true, mode: 0o700 })
    const big = 'x'.repeat(256)
    await writeFile(eventsPath, '')
    for (let i = 0; i < 5; i += 1) await appendFile(eventsPath, `${big}\n`)

    const index = new FileSessionEventIndex()
    const rebuild = await newRebuild(threadsDir, index, {}, { maxRecordBytes: 64 })
    await runToCompletion(rebuild)

    const paths = eventIndexPaths(eventsPath)
    expect((await stat(paths.bin)).size).toBe(0)
    const state = JSON.parse(await readFile(paths.state, 'utf8'))
    expect(state.entryCount).toBe(0)
    const diagnostic = await readEventIndexRebuildDiagnostic(paths.diagnostic)
    expect(diagnostic).toMatchObject({ reason: 'oversized_record' })
  })

  it('detects publish conflicts from source or generation drift', () => {
    const snapshot = { dev: 1, ino: 2, size: 100, mtimeMs: 5, generation: undefined }
    expect(eventIndexPublishConflict(snapshot, { dev: 1, ino: 2, size: 100, mtimeMs: 5 }, undefined)).toBe(false)
    expect(eventIndexPublishConflict(snapshot, { dev: 1, ino: 2, size: 101, mtimeMs: 5 }, undefined)).toBe(true)
    expect(eventIndexPublishConflict(snapshot, { dev: 1, ino: 2, size: 100, mtimeMs: 6 }, undefined)).toBe(true)
    expect(eventIndexPublishConflict(snapshot, { dev: 1, ino: 2, size: 100, mtimeMs: 5 }, 3)).toBe(true)
  })

  it('keeps replay lossless when an append lands mid-rebuild', async () => {
    const root = await mkdtemp(join(tmpdir(), 'kun-event-rebuild-race-'))
    roots.push(root)
    const threadsDir = join(root, 'threads')
    const threadId = 'thread-race'
    const threadDir = join(threadsDir, threadId)
    const eventsPath = await writeEvents(threadDir, threadId, 600)

    const index = new FileSessionEventIndex()
    const rebuild = await newRebuild(threadsDir, index, { maxEvents: 50 })
    await rebuild.runSlice() // partial scan

    // A live append commits a fresh formal index during the scan.
    await appendFile(eventsPath, record(threadId, 601))
    const info = await stat(eventsPath)
    await index.recordAppend({
      threadId,
      sourcePath: eventsPath,
      seq: 601,
      recordOffset: info.size - Buffer.byteLength(record(threadId, 601)),
      sourceSize: info.size,
      dev: info.dev,
      ino: info.ino
    })

    await runToCompletion(rebuild)

    // The canonical log is authoritative regardless of index state.
    const events: number[] = []
    for await (const event of iterateRuntimeEventsJsonl(eventsPath, 0, 1024 * 1024, 0)) {
      events.push(event.seq)
    }
    expect(events).toEqual(Array.from({ length: 601 }, (_, i) => i + 1))
  })

  it('quarantines a persistently failing source and continues the sweep', async () => {
    const root = await mkdtemp(join(tmpdir(), 'kun-event-rebuild-blocked-'))
    roots.push(root)
    const threadsDir = join(root, 'threads')
    const failingPath = join(threadsDir, 'thread-a', 'events.jsonl')
    await writeEvents(join(threadsDir, 'thread-a'), 'thread-a', 40)
    await writeEvents(join(threadsDir, 'thread-b'), 'thread-b', 40)

    const index = {
      withIndexMutation: async (sourcePath: string, operation: () => Promise<unknown>) => {
        if (sourcePath === failingPath) throw new Error('injected publish failure')
        return operation()
      },
      clearMemory: () => undefined
    } as unknown as FileSessionEventIndex
    const rebuild = await newRebuild(threadsDir, index, {})

    expect(await rebuild.runSlice()).toBe(false) // failure 1
    expect(await rebuild.runSlice()).toBe(false) // failure 2
    expect(await rebuild.runSlice()).toBe(true)  // failure 3 -> quarantine, then thread-b

    const sweep = JSON.parse(await readFile(join(threadsDir, 'event-index-rebuild.sweep.json'), 'utf8'))
    expect(sweep.blocked['thread-a']).toBeTruthy()
    expect(sweep.blocked['thread-a'].sourceFingerprint).toBeTruthy()
    expect(rebuild.stats()).toMatchObject({ blocked: 1 })
  })
})
