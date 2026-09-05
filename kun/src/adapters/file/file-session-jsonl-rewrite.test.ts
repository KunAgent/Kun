import { mkdtemp, readdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Writable } from 'node:stream'
import { afterEach, describe, expect, it } from 'vitest'
import { compactUsageEventsJsonlFile, trimEventsJsonlFromSeq } from './file-session-jsonl.js'

const roots: string[] = []

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })))
})

function failingWriter(error: Error): Writable {
  const writer = new Writable({
    write(_chunk, _encoding, callback) {
      callback()
      queueMicrotask(() => writer.emit('error', error))
    }
  })
  return writer
}

async function eventPath(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), 'kun-jsonl-rewrite-error-'))
  roots.push(root)
  const path = join(root, 'events.jsonl')
  await writeFile(path, `${JSON.stringify({
    kind: 'usage', seq: 1, timestamp: '2024-01-01T00:00:00.000Z', threadId: 'thr',
    usage: { promptTokens: 1, completionTokens: 0, totalTokens: 1, cacheHitRate: null, turns: 1 }
  })}\n${JSON.stringify({
    kind: 'usage', seq: 2, timestamp: '2024-01-02T00:00:00.000Z', threadId: 'thr',
    usage: { promptTokens: 2, completionTokens: 0, totalTokens: 2, cacheHitRate: null, turns: 2 }
  })}\n${JSON.stringify({
    kind: 'heartbeat', seq: 3, timestamp: '2026-01-01T00:00:00.000Z', threadId: 'thr'
  })}\n`)
  return path
}

describe('JSONL rewrite writer failures', () => {
  it('rejects usage compaction and removes its temporary rewrite', async () => {
    const path = await eventPath()
    const error = Object.assign(new Error('no space'), { code: 'ENOSPC' })

    await expect(compactUsageEventsJsonlFile(path, {
      nowIso: '2026-06-03T00:00:00.000Z',
      retentionDays: 30,
      maxRecordBytes: 1024,
      createWriteStream: () => failingWriter(error)
    })).rejects.toBe(error)
    await expect(readdir(join(path, '..'))).resolves.not.toContain(expect.stringMatching(/\.tmp$/))
  })

  it('rejects event trimming and removes its temporary rewrite', async () => {
    const path = await eventPath()
    const error = Object.assign(new Error('I/O error'), { code: 'EIO' })

    await expect(trimEventsJsonlFromSeq(path, 2, {
      maxRecordBytes: 1024,
      createWriteStream: () => failingWriter(error)
    })).rejects.toBe(error)
    await expect(readdir(join(path, '..'))).resolves.not.toContain(expect.stringMatching(/\.tmp$/))
  })
})
