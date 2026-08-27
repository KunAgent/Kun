import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { scanHighestSeqFromTail } from './file-session-seq-tail-scan.js'

let dir: string

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'kun-seq-tail-'))
})

afterEach(async () => {
  await rm(dir, { recursive: true, force: true })
})

function eventLine(seq: number): string {
  return JSON.stringify({
    kind: 'heartbeat',
    threadId: 'thr_test',
    seq,
    timestamp: '2026-01-01T00:00:00Z'
  })
}

describe('scanHighestSeqFromTail', () => {
  it('returns the highest seq from a small single-chunk file', async () => {
    const path = join(dir, 'events.jsonl')
    const contents = [eventLine(1), eventLine(2), eventLine(3)].join('\n') + '\n'
    await writeFile(path, contents)
    const result = await scanHighestSeqFromTail({ path, fileSize: Buffer.byteLength(contents) })
    expect(result).toEqual({ ok: true, highestSeq: 3 })
  })

  it('scans across multiple chunks without re-counting shared lines', async () => {
    const path = join(dir, 'events.jsonl')
    const lines: string[] = []
    for (let seq = 1; seq <= 400; seq += 1) lines.push(eventLine(seq))
    const contents = lines.join('\n') + '\n'
    await writeFile(path, contents)
    const result = await scanHighestSeqFromTail({
      path,
      fileSize: Buffer.byteLength(contents),
      chunkBytes: 1_024
    })
    expect(result).toEqual({ ok: true, highestSeq: 400 })
  })

  it('ignores a trailing partial line from a concurrent append', async () => {
    const path = join(dir, 'events.jsonl')
    const complete = [eventLine(10), eventLine(11)].join('\n') + '\n'
    const torn = '{"kind":"heartbeat","threadId":"thr_test","seq":12'
    await writeFile(path, complete + torn)
    const result = await scanHighestSeqFromTail({
      path,
      fileSize: Buffer.byteLength(complete + torn)
    })
    expect(result).toEqual({ ok: true, highestSeq: 11 })
  })

  it('degrades to malformed-tail for corrupt lines', async () => {
    const path = join(dir, 'events.jsonl')
    const contents = eventLine(1) + '\nnot-json\n'
    await writeFile(path, contents)
    const result = await scanHighestSeqFromTail({ path, fileSize: Buffer.byteLength(contents) })
    expect(result).toEqual({ ok: false, reason: 'malformed-tail' })
  })

  it('returns zero for an empty file without opening it', async () => {
    const result = await scanHighestSeqFromTail({ path: join(dir, 'absent.jsonl'), fileSize: 0 })
    expect(result).toEqual({ ok: true, highestSeq: 0 })
  })

  it('does not commit a complete JSON record before its trailing newline', async () => {
    const path = join(dir, 'events.jsonl')
    const contents = eventLine(1) + '\n' + eventLine(2)
    await writeFile(path, contents)
    const result = await scanHighestSeqFromTail({ path, fileSize: Buffer.byteLength(contents) })
    expect(result).toEqual({ ok: true, highestSeq: 1 })
  })

  it('treats the only unterminated record as uncommitted', async () => {
    const path = join(dir, 'events.jsonl')
    const contents = eventLine(2)
    await writeFile(path, contents)
    const result = await scanHighestSeqFromTail({ path, fileSize: Buffer.byteLength(contents) })
    expect(result).toEqual({ ok: true, highestSeq: 0 })
  })

  it('does not count a complete JSON object that fails event schema validation', async () => {
    const path = join(dir, 'events.jsonl')
    const contents = `${eventLine(1)}\n${JSON.stringify({ kind: 'item_created', seq: 9 })}\n`
    await writeFile(path, contents)
    const result = await scanHighestSeqFromTail({ path, fileSize: Buffer.byteLength(contents) })
    expect(result).toEqual({ ok: false, reason: 'malformed-tail' })
  })

  it('stops early once the line budget is reached', async () => {
    const path = join(dir, 'events.jsonl')
    const lines: string[] = []
    for (let seq = 1; seq <= 100; seq += 1) lines.push(eventLine(seq))
    const contents = lines.join('\n') + '\n'
    await writeFile(path, contents)
    const result = await scanHighestSeqFromTail({
      path,
      fileSize: Buffer.byteLength(contents),
      maxLines: 10
    })
    expect(result).toEqual({ ok: true, highestSeq: 100 })
  })
})
