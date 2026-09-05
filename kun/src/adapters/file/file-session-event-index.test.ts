import { appendFile, mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { atomicWriteFile } from './atomic-write.js'
import {
  EVENT_INDEX_RECORD_BYTES,
  FileSessionEventIndex
} from './file-session-event-index.js'
import { iterateRuntimeEventsJsonl } from './file-session-jsonl.js'

vi.mock('./atomic-write.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('./atomic-write.js')>()
  return { ...actual, atomicWriteFile: vi.fn(actual.atomicWriteFile) }
})

const roots: string[] = []

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })))
})

function encodeEntry(seq: number, offset: number): Buffer {
  const entry = Buffer.allocUnsafe(EVENT_INDEX_RECORD_BYTES)
  entry.writeBigUInt64LE(BigInt(seq), 0)
  entry.writeBigUInt64LE(BigInt(offset), 8)
  return entry
}

type SourceFixture = {
  sourcePath: string
  offsets: number[]
  size: number
  dev: number
  ino: number
}

async function buildSource(root: string, threadId: string, count: number): Promise<SourceFixture> {
  const sourcePath = join(root, 'events.jsonl')
  const records: string[] = []
  for (let seq = 1; seq <= count; seq += 1) {
    records.push(JSON.stringify({
      kind: 'heartbeat', seq, threadId, timestamp: '2026-09-03T00:00:00.000Z'
    }))
  }
  await writeFile(sourcePath, records.map((record) => `${record}\n`).join(''))
  const info = await stat(sourcePath)
  const offsets: number[] = []
  let position = 0
  for (const record of records) {
    offsets.push(position)
    position += Buffer.byteLength(`${record}\n`)
  }
  return { sourcePath, offsets, size: info.size, dev: info.dev, ino: info.ino }
}

type V2StateInput = {
  dev: number
  ino: number
  entryCount: number
  lastIndexedSeq: number
  lastIndexedOffset: number
  generation?: number
  indexedBytes?: number
}

function v2State(input: V2StateInput): Record<string, unknown> {
  return {
    version: 2,
    generation: input.generation ?? 0,
    dev: input.dev,
    ino: input.ino,
    indexedBytes: input.indexedBytes ?? 0,
    entryCount: input.entryCount,
    lastIndexedSeq: input.lastIndexedSeq,
    lastIndexedOffset: input.lastIndexedOffset
  }
}

async function writeBin(root: string, buffer: Buffer): Promise<void> {
  await writeFile(join(root, 'events-index.bin'), buffer)
}

async function writeState(root: string, state: Record<string, unknown>): Promise<void> {
  await writeFile(join(root, 'events-index.state.json'), JSON.stringify(state))
}

async function readEntries(root: string): Promise<Array<{ seq: number; offset: number }>> {
  const buffer = await readFile(join(root, 'events-index.bin'))
  const entries: Array<{ seq: number; offset: number }> = []
  for (let index = 0; index + EVENT_INDEX_RECORD_BYTES <= buffer.length; index += EVENT_INDEX_RECORD_BYTES) {
    entries.push({
      seq: Number(buffer.readBigUInt64LE(index)),
      offset: Number(buffer.readBigUInt64LE(index + 8))
    })
  }
  return entries
}

async function readStateJson(root: string): Promise<Record<string, unknown>> {
  return JSON.parse(await readFile(join(root, 'events-index.state.json'), 'utf8'))
}

describe('FileSessionEventIndex', () => {
  it('seeks near the tail while JSONL remains authoritative', async () => {
    const root = await mkdtemp(join(tmpdir(), 'kun-event-index-'))
    roots.push(root)
    const threadId = 'thread-indexed'
    const sourcePath = join(root, 'events.jsonl')
    const index = new FileSessionEventIndex()
    await writeFile(sourcePath, '')
    for (let seq = 1; seq <= 600; seq += 1) {
      const record = `${JSON.stringify({
        kind: 'heartbeat', seq, threadId, timestamp: '2026-09-03T00:00:00.000Z'
      })}\n`
      await appendFile(sourcePath, record)
      const info = await stat(sourcePath)
      await index.recordAppend({
        threadId,
        sourcePath,
        seq,
        recordOffset: info.size - Buffer.byteLength(record),
        sourceSize: info.size,
        dev: info.dev,
        ino: info.ino
      })
    }

    const offset = await index.startOffset(threadId, sourcePath, 590)
    expect(offset).toBeGreaterThan(0)
    const events = []
    for await (const event of iterateRuntimeEventsJsonl(sourcePath, 590, 1024 * 1024, offset)) {
      events.push(event.seq)
    }
    expect(events).toEqual([591, 592, 593, 594, 595, 596, 597, 598, 599, 600])
  })

  it('falls back safely for corrupt state and removes only sidecars on invalidation', async () => {
    const root = await mkdtemp(join(tmpdir(), 'kun-event-index-corrupt-'))
    roots.push(root)
    const threadId = 'thread-corrupt'
    const sourcePath = join(root, 'events.jsonl')
    const record = `${JSON.stringify({
      kind: 'heartbeat', seq: 1, threadId, timestamp: '2026-09-03T00:00:00.000Z'
    })}\n`
    await writeFile(sourcePath, record)
    const info = await stat(sourcePath)
    const index = new FileSessionEventIndex()
    await index.recordAppend({
      threadId, sourcePath, seq: 1, recordOffset: 0,
      sourceSize: info.size, dev: info.dev, ino: info.ino
    })
    await writeFile(join(root, 'events-index.state.json'), '{broken')
    index.clearMemory(threadId)

    await expect(index.startOffset(threadId, sourcePath, 1)).resolves.toBe(0)
    await index.invalidate(threadId, sourcePath)
    expect(await readFile(sourcePath, 'utf8')).toBe(record)
    await expect(stat(join(root, 'events-index.bin'))).rejects.toThrow()
  })

  it('truncates a full residual tail before the next append', async () => {
    const root = await mkdtemp(join(tmpdir(), 'kun-event-index-a-'))
    roots.push(root)
    const threadId = 'thread-a'
    const { sourcePath, offsets, size, dev, ino } = await buildSource(root, threadId, 5)
    const index = new FileSessionEventIndex()
    await writeState(root, v2State({
      dev, ino, entryCount: 1, lastIndexedSeq: 1, lastIndexedOffset: 0, generation: 3
    }))
    await writeBin(root, Buffer.concat([encodeEntry(1, offsets[0]), encodeEntry(2, offsets[1])]))

    await index.recordAppend({
      threadId, sourcePath, seq: 300, recordOffset: offsets[4], sourceSize: size, dev, ino
    })

    expect(await readEntries(root)).toEqual([
      { seq: 1, offset: offsets[0] },
      { seq: 300, offset: offsets[4] }
    ])
    const state = await readStateJson(root)
    expect(state.entryCount).toBe(2)
    expect(state.generation).toBe(3)
    expect(state.lastIndexedSeq).toBe(300)
  })

  it('truncates a partial residual tail before the next append', async () => {
    const root = await mkdtemp(join(tmpdir(), 'kun-event-index-b-'))
    roots.push(root)
    const threadId = 'thread-b'
    const { sourcePath, offsets, size, dev, ino } = await buildSource(root, threadId, 5)
    const index = new FileSessionEventIndex()
    await writeState(root, v2State({ dev, ino, entryCount: 1, lastIndexedSeq: 1, lastIndexedOffset: 0 }))
    await writeBin(root, Buffer.concat([
      encodeEntry(1, offsets[0]),
      encodeEntry(2, offsets[1]).subarray(0, 10)
    ]))

    await index.recordAppend({
      threadId, sourcePath, seq: 300, recordOffset: offsets[4], sourceSize: size, dev, ino
    })

    expect(await readEntries(root)).toEqual([
      { seq: 1, offset: offsets[0] },
      { seq: 300, offset: offsets[4] }
    ])
  })

  it('rebuilds from scratch when the binary is missing or shorter than committed', async () => {
    const root = await mkdtemp(join(tmpdir(), 'kun-event-index-c-'))
    roots.push(root)
    const threadId = 'thread-c'
    const { sourcePath, offsets, size, dev, ino } = await buildSource(root, threadId, 5)
    const index = new FileSessionEventIndex()

    await writeState(root, v2State({
      dev, ino, entryCount: 2, lastIndexedSeq: 2, lastIndexedOffset: offsets[1], generation: 4
    }))
    await index.recordAppend({
      threadId, sourcePath, seq: 300, recordOffset: offsets[4], sourceSize: size, dev, ino
    })
    expect(await readEntries(root)).toEqual([{ seq: 300, offset: offsets[4] }])
    let state = await readStateJson(root)
    expect(state.entryCount).toBe(1)
    expect(state.generation).toBe(5)

    await writeBin(root, encodeEntry(1, offsets[0]))
    await writeState(root, v2State({
      dev, ino, entryCount: 3, lastIndexedSeq: 3, lastIndexedOffset: offsets[2], generation: 6
    }))
    index.clearMemory(threadId)
    await index.recordAppend({
      threadId, sourcePath, seq: 301, recordOffset: offsets[4], sourceSize: size, dev, ino
    })
    expect(await readEntries(root)).toEqual([{ seq: 301, offset: offsets[4] }])
    state = await readStateJson(root)
    expect(state.entryCount).toBe(1)
    expect(state.generation).toBe(7)
  })

  it('returns 0 when a partial residual shifts records into a fake aligned entry', async () => {
    const root = await mkdtemp(join(tmpdir(), 'kun-event-index-d-'))
    roots.push(root)
    const threadId = 'thread-d'
    const { sourcePath, offsets, size, dev, ino } = await buildSource(root, threadId, 5)
    const index = new FileSessionEventIndex()
    // Committed entry + 6-byte partial residual + a subsequent full entry = 38 bytes,
    // but the state declares 2 entries (32 bytes). The old reader sliced the first
    // 32 bytes and treated the final 16 as a legal record assembled from the shim.
    await writeState(root, v2State({
      dev, ino, entryCount: 2, lastIndexedSeq: 4, lastIndexedOffset: offsets[3]
    }))
    await writeBin(root, Buffer.concat([
      encodeEntry(1, offsets[0]),
      encodeEntry(4, offsets[3]).subarray(0, 6),
      encodeEntry(5, offsets[4])
    ]))

    await expect(index.startOffset(threadId, sourcePath, 2)).resolves.toBe(0)
    expect(index.stats().repairs).toBe(1)
  })

  it('returns 0 when the tail entry disagrees with the state', async () => {
    const root = await mkdtemp(join(tmpdir(), 'kun-event-index-e-'))
    roots.push(root)
    const threadId = 'thread-e'
    const { sourcePath, offsets, size, dev, ino } = await buildSource(root, threadId, 5)
    const index = new FileSessionEventIndex()
    await writeState(root, v2State({
      dev, ino, entryCount: 2, lastIndexedSeq: 2, lastIndexedOffset: offsets[1]
    }))
    const tail = encodeEntry(2, offsets[1])
    tail[0] ^= 0x01 // seq 2 -> 3, breaking the agreement with lastIndexedSeq
    await writeBin(root, Buffer.concat([encodeEntry(1, offsets[0]), tail]))

    await expect(index.startOffset(threadId, sourcePath, 1)).resolves.toBe(0)
    expect(index.stats().repairs).toBe(1)
  })

  it('returns 0 when entries are not monotonically increasing by seq', async () => {
    const root = await mkdtemp(join(tmpdir(), 'kun-event-index-f-'))
    roots.push(root)
    const threadId = 'thread-f'
    const { sourcePath, offsets, size, dev, ino } = await buildSource(root, threadId, 5)
    const index = new FileSessionEventIndex()
    await writeState(root, v2State({
      dev, ino, entryCount: 2, lastIndexedSeq: 1, lastIndexedOffset: offsets[0]
    }))
    await writeBin(root, Buffer.concat([encodeEntry(2, offsets[1]), encodeEntry(1, offsets[0])]))

    await expect(index.startOffset(threadId, sourcePath, 1)).resolves.toBe(0)
  })

  it('returns 0 when the indexed offset does not point at a JSONL line start', async () => {
    const root = await mkdtemp(join(tmpdir(), 'kun-event-index-g-'))
    roots.push(root)
    const threadId = 'thread-g'
    const { sourcePath, offsets, size, dev, ino } = await buildSource(root, threadId, 5)
    const index = new FileSessionEventIndex()
    const midLine = offsets[1] + 3
    await writeState(root, v2State({
      dev, ino, entryCount: 2, lastIndexedSeq: 2, lastIndexedOffset: midLine
    }))
    await writeBin(root, Buffer.concat([encodeEntry(1, offsets[0]), encodeEntry(2, midLine)]))

    await expect(index.startOffset(threadId, sourcePath, 2)).resolves.toBe(0)
  })

  it('returns 0 when the line at the indexed offset has a different seq', async () => {
    const root = await mkdtemp(join(tmpdir(), 'kun-event-index-h-'))
    roots.push(root)
    const threadId = 'thread-h'
    const { sourcePath, offsets, size, dev, ino } = await buildSource(root, threadId, 5)
    const index = new FileSessionEventIndex()
    await writeState(root, v2State({
      dev, ino, entryCount: 2, lastIndexedSeq: 999, lastIndexedOffset: offsets[1]
    }))
    await writeBin(root, Buffer.concat([encodeEntry(1, offsets[0]), encodeEntry(999, offsets[1])]))

    await expect(index.startOffset(threadId, sourcePath, 999)).resolves.toBe(0)
  })

  it('rejects v1 state and rebuilds a v2 state on the next append', async () => {
    const root = await mkdtemp(join(tmpdir(), 'kun-event-index-i-'))
    roots.push(root)
    const threadId = 'thread-i'
    const { sourcePath, offsets, size, dev, ino } = await buildSource(root, threadId, 5)
    const index = new FileSessionEventIndex()
    await writeState(root, {
      version: 1, dev, ino, indexedBytes: size, entryCount: 1,
      lastIndexedSeq: 1, lastIndexedOffset: 0
    })
    await writeBin(root, encodeEntry(1, offsets[0]))

    await expect(index.startOffset(threadId, sourcePath, 1)).resolves.toBe(0)

    await index.recordAppend({
      threadId, sourcePath, seq: 300, recordOffset: offsets[4], sourceSize: size, dev, ino
    })
    const state = await readStateJson(root)
    expect(state.version).toBe(2)
    expect(state.generation).toBe(1)
    expect(state.entryCount).toBe(1)
    expect(state.lastIndexedSeq).toBe(300)
  })

  it('deletes sidecars after a validation failure and rebuilds cleanly', async () => {
    const root = await mkdtemp(join(tmpdir(), 'kun-event-index-j-'))
    roots.push(root)
    const threadId = 'thread-j'
    const { sourcePath, offsets, size, dev, ino } = await buildSource(root, threadId, 3)
    const index = new FileSessionEventIndex()

    await writeState(root, v2State({
      dev, ino, entryCount: 2, lastIndexedSeq: 2, lastIndexedOffset: offsets[1]
    }))
    await writeBin(root, Buffer.concat([encodeEntry(1, offsets[0]), encodeEntry(3, offsets[2])]))

    await expect(index.startOffset(threadId, sourcePath, 1)).resolves.toBe(0)
    expect(index.stats().repairs).toBe(1)
    await expect(stat(join(root, 'events-index.bin'))).rejects.toThrow()
    await expect(stat(join(root, 'events-index.state.json'))).rejects.toThrow()

    await index.recordAppend({
      threadId, sourcePath, seq: 2, recordOffset: offsets[1], sourceSize: size, dev, ino
    })
    await expect(index.startOffset(threadId, sourcePath, 1)).resolves.toBe(0)
    expect(index.stats().repairs).toBe(1)
    expect(index.stats().seeks).toBe(1)
  })

  it('keeps the prior index when the state atomic write fails, then self-heals', async () => {
    const root = await mkdtemp(join(tmpdir(), 'kun-event-index-k-'))
    roots.push(root)
    const threadId = 'thread-k'
    const { sourcePath, offsets, size, dev, ino } = await buildSource(root, threadId, 5)
    const index = new FileSessionEventIndex()

    await writeState(root, v2State({
      dev, ino, entryCount: 1, lastIndexedSeq: 1, lastIndexedOffset: 0, generation: 2
    }))
    await writeBin(root, encodeEntry(1, offsets[0]))

    vi.mocked(atomicWriteFile).mockRejectedValueOnce(new Error('simulated crash before rename'))
    await expect(index.recordAppend({
      threadId, sourcePath, seq: 300, recordOffset: offsets[4], sourceSize: size, dev, ino
    })).rejects.toThrow('simulated crash before rename')

    expect(await readEntries(root)).toEqual([
      { seq: 1, offset: offsets[0] },
      { seq: 300, offset: offsets[4] }
    ])
    const stateAfterCrash = await readStateJson(root)
    expect(stateAfterCrash.entryCount).toBe(1)
    expect(stateAfterCrash.lastIndexedSeq).toBe(1)

    expect((await readFile(sourcePath, 'utf8')).split('\n').filter(Boolean)).toHaveLength(5)

    await index.recordAppend({
      threadId, sourcePath, seq: 301, recordOffset: offsets[4], sourceSize: size, dev, ino
    })
    expect(await readEntries(root)).toEqual([
      { seq: 1, offset: offsets[0] },
      { seq: 301, offset: offsets[4] }
    ])
    const stateAfterHeal = await readStateJson(root)
    expect(stateAfterHeal.entryCount).toBe(2)
    expect(stateAfterHeal.lastIndexedSeq).toBe(301)
    expect(stateAfterHeal.generation).toBe(2)
  })

  it('accepts a zero-entry fully-scanned index and seeds it on the next append', async () => {
    const root = await mkdtemp(join(tmpdir(), 'kun-event-index-zero-'))
    roots.push(root)
    const threadId = 'thread-zero'
    const { sourcePath, size, dev, ino } = await buildSource(root, threadId, 5)
    const index = new FileSessionEventIndex()
    await writeState(root, v2State({
      dev, ino, entryCount: 0, lastIndexedSeq: 0, lastIndexedOffset: 0, generation: 5, indexedBytes: size
    }))
    await writeBin(root, Buffer.alloc(0))

    // startOffset treats a zero-entry state as a valid degradation and keeps sidecars.
    expect(await index.startOffset(threadId, sourcePath, 1)).toBe(0)
    await expect(stat(join(root, 'events-index.bin'))).resolves.toBeTruthy()
    await expect(stat(join(root, 'events-index.state.json'))).resolves.toBeTruthy()

    // The first subsequent append seeds the sparse index without losing monotonicity.
    const extra = `${JSON.stringify({
      kind: 'heartbeat', seq: 300, threadId, timestamp: '2026-09-03T00:00:00.000Z'
    })}\n`
    await appendFile(sourcePath, extra)
    const info = await stat(sourcePath)
    await index.recordAppend({
      threadId, sourcePath, seq: 300, recordOffset: size, sourceSize: info.size, dev, ino
    })
    expect(await readEntries(root)).toEqual([{ seq: 300, offset: size }])
    const state = await readStateJson(root)
    expect(state.entryCount).toBe(1)
    expect(state.generation).toBe(5)
    expect(state.lastIndexedSeq).toBe(300)
  })
})
