import { mkdir, mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { RuntimeEvent } from '../../contracts/events.js'
import { FileSessionStore } from './file-session-store.js'
import { scanHighestSeqFromTail } from './file-session-seq-tail-scan.js'

const roots: string[] = []

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })))
})

function heartbeat(threadId: string, seq: number, extra: Record<string, unknown> = {}): RuntimeEvent {
  return { kind: 'heartbeat', seq, timestamp: '2026-09-01T00:00:00.000Z', threadId, ...extra } as RuntimeEvent
}

describe('events.jsonl torn tails', () => {
  it('commits a valid final event missing only its newline before append', async () => {
    const root = await mkdtemp(join(tmpdir(), 'kun-event-tail-valid-'))
    roots.push(root)
    const threadId = 'thread_event_tail_valid'
    const directory = join(root, 'threads', threadId)
    const path = join(directory, 'events.jsonl')
    await mkdir(directory, { recursive: true })
    await writeFile(path, `${JSON.stringify(heartbeat(threadId, 1))}\n${JSON.stringify(heartbeat(threadId, 2))}`)

    const store = new FileSessionStore({ dataDir: root })
    await store.appendEvent(threadId, heartbeat(threadId, 3))

    const content = await readFile(path, 'utf8')
    expect(content.endsWith('\n')).toBe(true)
    expect(content.split('\n').filter(Boolean)).toHaveLength(3)
    expect((await store.loadEventsSince(threadId, 0)).map((event) => event.seq)).toEqual([1, 2, 3])
    await expect(stat(join(directory, 'events.torn-tail.json'))).rejects.toThrow()
  })

  it('records and removes a partial tail before append', async () => {
    const root = await mkdtemp(join(tmpdir(), 'kun-event-tail-partial-'))
    roots.push(root)
    const threadId = 'thread_event_tail_partial'
    const directory = join(root, 'threads', threadId)
    const path = join(directory, 'events.jsonl')
    await mkdir(directory, { recursive: true })
    await writeFile(path, `${JSON.stringify(heartbeat(threadId, 1))}\n{"seq":`)

    const store = new FileSessionStore({ dataDir: root })
    await store.appendEvent(threadId, heartbeat(threadId, 2))

    const content = await readFile(path, 'utf8')
    expect(content.split('\n').filter(Boolean)).toHaveLength(2)
    expect(content.endsWith('\n')).toBe(true)
    const evidence = JSON.parse(await readFile(join(directory, 'events.torn-tail.json'), 'utf8')) as {
      truncatedBytes: number
      sampleBase64: string
    }
    expect(evidence.truncatedBytes).toBeGreaterThan(0)
    expect(Buffer.from(evidence.sampleBase64, 'base64').toString('utf8')).toContain('"seq"')
    expect((await store.loadEventsSince(threadId, 0)).map((event) => event.seq)).toEqual([1, 2])
  })

  it('records and removes a tail cut mid UTF-8 multibyte character', async () => {
    const root = await mkdtemp(join(tmpdir(), 'kun-event-tail-utf8-'))
    roots.push(root)
    const threadId = 'thread_event_tail_utf8'
    const directory = join(root, 'threads', threadId)
    const path = join(directory, 'events.jsonl')
    const torn = Buffer.from(JSON.stringify(heartbeat(threadId, 2, { turnId: 'turn_你好世界' })), 'utf8')
    // End the file inside the 3-byte sequence of 世 so the tail holds an
    // incomplete UTF-8 code point, like a crash between character bytes.
    const cutAt = torn.indexOf(Buffer.from('世', 'utf8')) + 1
    await mkdir(directory, { recursive: true })
    await writeFile(path, Buffer.concat([
      Buffer.from(`${JSON.stringify(heartbeat(threadId, 1))}\n`, 'utf8'),
      torn.subarray(0, cutAt)
    ]))

    const store = new FileSessionStore({ dataDir: root })
    await store.appendEvent(threadId, heartbeat(threadId, 3))

    const content = await readFile(path, 'utf8')
    expect(content.split('\n').filter(Boolean)).toHaveLength(2)
    expect(content.endsWith('\n')).toBe(true)
    const evidence = JSON.parse(await readFile(join(directory, 'events.torn-tail.json'), 'utf8')) as {
      truncatedBytes: number
    }
    expect(evidence.truncatedBytes).toBeGreaterThan(0)
    expect((await store.loadEventsSince(threadId, 0)).map((event) => event.seq)).toEqual([1, 3])
  })

  it('serves consecutive highestSeq reads from the append stat cache', async () => {
    const root = await mkdtemp(join(tmpdir(), 'kun-highest-seq-cache-'))
    roots.push(root)
    const threadId = 'thread_highest_seq_cache'
    const store = new FileSessionStore({ dataDir: root })
    await store.appendEvent(threadId, heartbeat(threadId, 1))

    await expect(store.highestSeq(threadId)).resolves.toBe(1)
    const firstScan = vi.spyOn(
      await import('./file-session-seq-tail-scan.js'),
      'scanHighestSeqFromTail'
    )
    await expect(store.highestSeq(threadId)).resolves.toBe(1)
    expect(firstScan).not.toHaveBeenCalled()
    firstScan.mockRestore()

    await store.appendEvent(threadId, heartbeat(threadId, 2))
    await expect(store.highestSeq(threadId)).resolves.toBe(2)
    const secondScan = vi.spyOn(
      await import('./file-session-seq-tail-scan.js'),
      'scanHighestSeqFromTail'
    )
    await expect(store.highestSeq(threadId)).resolves.toBe(2)
    expect(secondScan).not.toHaveBeenCalled()
    secondScan.mockRestore()
  })
})
