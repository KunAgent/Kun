import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { createThreadRecord } from '../src/domain/thread.js'
import { createTurnRecord } from '../src/domain/turn.js'
import { scanThreadStore } from '../src/services/thread-store-doctor.js'

const roots: string[] = []

describe('scanThreadStore', () => {
  afterEach(async () => {
    await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })))
  })

  it('reports healthy JSONL and does not mutate the store', async () => {
    const root = await makeRoot()
    const thread = createThreadRecord({
      id: 'thr_healthy',
      title: 'Healthy',
      workspace: root,
      model: 'deepseek-chat',
      createdAt: '2026-01-01T00:00:00.000Z'
    })
    const threadRoot = join(root, 'threads', thread.id)
    await mkdir(threadRoot, { recursive: true })
    const metadataPath = join(threadRoot, 'metadata.jsonl')
    const eventsPath = join(threadRoot, 'events.jsonl')
    await writeFile(metadataPath, `${JSON.stringify({ kind: 'thread_metadata', version: 1, timestamp: thread.createdAt, thread })}\n`)
    await writeFile(eventsPath, `${JSON.stringify({
      kind: 'heartbeat', seq: 1, timestamp: thread.createdAt, threadId: thread.id
    })}\n`)
    const before = await Promise.all([metadataPath, eventsPath].map(async (path) => ({ path, text: await readFileText(path) })))

    const report = await scanThreadStore({ dataDir: root, nowIso: () => '2026-07-14T00:00:00.000Z' })
    expect(report.threads[0]).toMatchObject({
      threadId: thread.id,
      metadata: 'ok',
      events: 'ok',
      sqliteIndex: 'missing',
      attachments: 'ok',
      recoverable: true
    })
    expect(await Promise.all(before.map(async ({ path }) => readFileText(path)))).toEqual(before.map(({ text }) => text))
  })

  it('classifies an incomplete final JSONL record as truncated', async () => {
    const root = await makeRoot()
    const thread = createThreadRecord({
      id: 'thr_truncated',
      title: 'Truncated',
      workspace: root,
      model: 'deepseek-chat',
      createdAt: '2026-01-01T00:00:00.000Z'
    })
    const threadRoot = join(root, 'threads', thread.id)
    await mkdir(threadRoot, { recursive: true })
    await writeFile(join(threadRoot, 'metadata.jsonl'), `${JSON.stringify({ kind: 'thread_metadata', version: 1, timestamp: thread.createdAt, thread })}\n`)
    await writeFile(join(threadRoot, 'events.jsonl'), '{"kind":"heartbeat"')

    const report = await scanThreadStore({ dataDir: root })
    expect(report.threads[0]).toMatchObject({ events: 'truncated', recoverable: true })
  })

  it('fails closed for invalid metadata', async () => {
    const root = await makeRoot()
    const threadRoot = join(root, 'threads', 'thr_invalid')
    await mkdir(threadRoot, { recursive: true })
    await writeFile(join(threadRoot, 'metadata.jsonl'), '{"kind":"thread_metadata","thread":{"id":"thr_invalid"}}\n')

    const report = await scanThreadStore({ dataDir: root })
    expect(report.threads[0]).toMatchObject({ metadata: 'invalid', recoverable: false })
    expect(report.threads[0]?.issues.some((item) => item.code === 'invalid_metadata')).toBe(true)
  })

  it('checks a real read-only SQLite index and attachment content', async () => {
    const root = await makeRoot()
    const thread = createThreadRecord({
      id: 'thr_indexed',
      title: 'Indexed',
      workspace: root,
      model: 'deepseek-chat',
      createdAt: '2026-01-01T00:00:00.000Z'
    })
    const attachmentId = 'att_0123456789abcdef01234567'
    const threadWithAttachment = {
      ...thread,
      turns: [createTurnRecord({ id: 'turn_1', threadId: thread.id, prompt: 'attached', attachmentIds: [attachmentId] })]
    }
    const threadRoot = join(root, 'threads', thread.id)
    const attachmentRoot = join(root, 'attachments')
    await mkdir(threadRoot, { recursive: true })
    await mkdir(attachmentRoot, { recursive: true })
    await writeFile(join(threadRoot, 'metadata.jsonl'), `${JSON.stringify({ kind: 'thread_metadata', version: 1, timestamp: thread.createdAt, thread: threadWithAttachment })}\n`)
    await writeFile(join(threadRoot, 'events.jsonl'), `${JSON.stringify({
      kind: 'heartbeat', seq: 1, timestamp: thread.createdAt, threadId: thread.id
    })}\n`)
    await writeFile(join(attachmentRoot, `${attachmentId}.json`), JSON.stringify({
      id: attachmentId,
      name: 'missing.bin',
      kind: 'document',
      mimeType: 'text/plain',
      byteSize: 3,
      hash: 'a'.repeat(64),
      threadIds: [thread.id],
      workspaces: [],
      createdAt: thread.createdAt,
      updatedAt: thread.createdAt
    }))

    const sqlitePath = join(root, 'index.sqlite3')
    const sqlite = await import('better-sqlite3')
    const db = new sqlite.default(sqlitePath)
    db.exec('CREATE TABLE threads (id TEXT PRIMARY KEY, metadata_path TEXT, messages_path TEXT, events_path TEXT)')
    db.prepare('INSERT INTO threads VALUES (?, ?, ?, ?)').run(
      thread.id,
      join(threadRoot, 'metadata.jsonl'),
      join(threadRoot, 'messages.jsonl'),
      join(threadRoot, 'events.jsonl')
    )
    db.close()

    const report = await scanThreadStore({ dataDir: root, attachmentRootDir: attachmentRoot })
    expect(report.threads[0]).toMatchObject({
      sqliteIndex: 'ok',
      attachments: 'mismatch',
      recoverable: false
    })
  })

  it('does not treat an interior malformed JSONL record as truncation', async () => {
    const root = await makeRoot()
    const thread = createThreadRecord({
      id: 'thr_interior_bad',
      title: 'Interior bad',
      workspace: root,
      model: 'deepseek-chat',
      createdAt: '2026-01-01T00:00:00.000Z'
    })
    const threadRoot = join(root, 'threads', thread.id)
    await mkdir(threadRoot, { recursive: true })
    await writeFile(join(threadRoot, 'metadata.jsonl'), `${JSON.stringify({ kind: 'thread_metadata', version: 1, timestamp: thread.createdAt, thread })}\n`)
    await writeFile(join(threadRoot, 'events.jsonl'), '{bad}\n{"kind":"heartbeat","seq":1,"timestamp":"2026-01-01T00:00:00.000Z","threadId":"thr_interior_bad"}\n')

    const report = await scanThreadStore({ dataDir: root })
    expect(report.threads[0]?.events).toBe('invalid')
  })
})

async function makeRoot(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), 'kun-doctor-'))
  roots.push(root)
  return root
}

async function readFileText(path: string): Promise<string> {
  const { readFile } = await import('node:fs/promises')
  return readFile(path, 'utf8')
}
