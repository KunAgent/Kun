import { mkdir, mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { makeToolResultItem } from '../../domain/item.js'
import { createThreadRecord } from '../../domain/thread.js'
import { HybridThreadStore } from '../hybrid/hybrid-thread-store.js'
import { stripThreadItemBodies } from '../hybrid/hybrid-thread-projection.js'
import { FileSessionStore } from './file-session-store.js'
import { FileSessionItemIndex } from './file-session-item-index.js'
import { JsonlFileAccessCoordinator } from './jsonl-file-access.js'

const roots: string[] = []

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })))
})

class ObservableCoordinator extends JsonlFileAccessCoordinator {
  readonly replacementRequested: Promise<string>
  private markReplacementRequested!: (path: string) => void

  constructor() {
    super()
    this.replacementRequested = new Promise((resolve) => {
      this.markReplacementRequested = resolve
    })
  }

  override async withReplacement<T>(path: string, operation: () => Promise<T>): Promise<T> {
    this.markReplacementRequested(path)
    return super.withReplacement(path, operation)
  }
}

async function holdRead(
  coordinator: JsonlFileAccessCoordinator,
  path: string
): Promise<() => Promise<void>> {
  let unblock!: () => void
  let started!: () => void
  const didStart = new Promise<void>((resolve) => { started = resolve })
  const blocked = new Promise<void>((resolve) => { unblock = resolve })
  const read = coordinator.withRead(path, async () => {
    started()
    await blocked
  })
  await didStart
  return async () => {
    unblock()
    await read
  }
}

describe('JSONL replacement coordination', () => {
  it('makes an index rebuild source lease wait before replacement', async () => {
    const root = await mkdtemp(join(tmpdir(), 'kun-jsonl-index-gate-'))
    roots.push(root)
    const sourcePath = join(root, 'messages.jsonl')
    const indexPath = join(root, 'messages-index.jsonl')
    const statePath = join(root, 'messages-index.state.json')
    const item = makeToolResultItem({
      id: 'result_1', threadId: 'thread_1', turnId: 'turn_1', callId: 'call_1',
      toolName: 'bash', output: { text: 'done' }, status: 'completed'
    })
    await writeFile(sourcePath, `${JSON.stringify(item)}\n`)
    const fileAccess = new ObservableCoordinator()
    let releaseLease!: () => void
    let markLeaseStarted!: () => void
    const leaseStarted = new Promise<void>((resolve) => { markLeaseStarted = resolve })
    const gate = new Promise<void>((resolve) => { releaseLease = resolve })
    const rebuilding = new FileSessionItemIndex().rebuild({
      sourcePath,
      indexPath,
      statePath,
      threadId: 'thread_1',
      evidencePath: join(root, 'messages-tail.evidence.json'),
      withSourceRead: (operation) => fileAccess.withRead(sourcePath, async () => {
        markLeaseStarted()
        await gate
        return operation()
      })
    })
    await leaseStarted
    let replacementRan = false
    const replacement = fileAccess.withReplacement(sourcePath, async () => { replacementRan = true })
    await fileAccess.replacementRequested
    await Promise.resolve()
    expect(replacementRan).toBe(false)

    releaseLease()
    await rebuilding
    await replacement
    expect(replacementRan).toBe(true)
    const source = await stat(sourcePath)
    expect(JSON.parse(await readFile(statePath, 'utf8'))).toMatchObject({
      sourceBytes: source.size,
      sourceMtimeMs: source.mtimeMs,
      sourceDev: source.dev,
      sourceIno: source.ino
    })
  })

  it('lets an active read scope finish nested reads after a replacement queues', async () => {
    const fileAccess = new ObservableCoordinator()
    const path = join(tmpdir(), 'kun-jsonl-reentrant-read.jsonl')
    let startNested!: () => void
    let markOuterStarted!: () => void
    const continueOuter = new Promise<void>((resolve) => { startNested = resolve })
    const outerStarted = new Promise<void>((resolve) => { markOuterStarted = resolve })
    let nestedRan = false
    let replacementRan = false
    const outer = fileAccess.withRead(path, async () => {
      markOuterStarted()
      await continueOuter
      await fileAccess.withRead(path, async () => { nestedRan = true })
    })
    await outerStarted
    const replacement = fileAccess.withReplacement(path, async () => { replacementRan = true })
    await fileAccess.replacementRequested

    startNested()
    await outer
    expect(nestedRan).toBe(true)
    await replacement
    expect(replacementRan).toBe(true)
  })

  it('lets message compaction wait for an active reader and blocks later appends', async () => {
    const root = await mkdtemp(join(tmpdir(), 'kun-jsonl-message-gate-'))
    roots.push(root)
    const fileAccess = new ObservableCoordinator()
    const store = new FileSessionStore({
      dataDir: root,
      fileAccess,
      itemHistoryCompactionMinBytes: 1
    })
    const threadId = 'thread_message_gate'
    for (let index = 0; index < 4; index += 1) {
      await store.appendItem(threadId, makeToolResultItem({
        id: 'result_1',
        threadId,
        turnId: 'turn_1',
        callId: 'call_1',
        toolName: 'bash',
        output: { text: `snapshot-${index}` },
        status: index === 3 ? 'completed' : 'running'
      }))
    }
    const path = join(root, 'threads', threadId, 'messages.jsonl')
    const releaseRead = await holdRead(fileAccess, path)
    let compacted = false
    const compaction = store.compactItems(threadId, { force: true }).then((result) => {
      compacted = true
      return result
    })
    await fileAccess.replacementRequested

    let laterAppendRan = false
    const laterAppend = store.appendItem(threadId, makeToolResultItem({
      id: 'result_2',
      threadId,
      turnId: 'turn_2',
      callId: 'call_2',
      toolName: 'bash',
      output: { text: 'after-compaction' },
      status: 'completed'
    })).then(() => { laterAppendRan = true })
    await Promise.resolve()
    expect(compacted).toBe(false)
    expect(laterAppendRan).toBe(false)

    await releaseRead()
    await expect(compaction).resolves.toMatchObject({ compacted: true, itemCount: 1 })
    await laterAppend
    expect(laterAppendRan).toBe(true)
    expect((await readFile(path, 'utf8')).trim().split('\n')).toHaveLength(2)
  })

  it('lets event trimming replace the log after an active SSE replay reader closes', async () => {
    const root = await mkdtemp(join(tmpdir(), 'kun-jsonl-event-gate-'))
    roots.push(root)
    const fileAccess = new ObservableCoordinator()
    const store = new FileSessionStore({ dataDir: root, fileAccess })
    const threadId = 'thread_event_gate'
    await store.appendEvent(threadId, {
      kind: 'heartbeat', threadId, seq: 1, timestamp: '2026-08-28T00:00:00.000Z'
    })
    await store.appendEvent(threadId, {
      kind: 'heartbeat', threadId, seq: 2, timestamp: '2026-08-28T00:00:01.000Z'
    })
    const path = join(root, 'threads', threadId, 'events.jsonl')
    const releaseRead = await holdRead(fileAccess, path)
    const trimming = store.trimEventsFromSeq(threadId, 2)
    await fileAccess.replacementRequested
    const append = store.appendEvent(threadId, {
      kind: 'heartbeat', threadId, seq: 3, timestamp: '2026-08-28T00:00:02.000Z'
    })

    await releaseRead()
    await expect(trimming).resolves.toMatchObject({ afterBytes: expect.any(Number) })
    await append
    expect((await store.loadEventsSince(threadId, 0)).map((event) => event.seq)).toEqual([2, 3])
  })

  it('lets metadata compaction replace its log after an active timeline reader closes', async () => {
    const root = await mkdtemp(join(tmpdir(), 'kun-jsonl-metadata-gate-'))
    roots.push(root)
    const thread = createThreadRecord({
      id: 'thread_metadata_gate',
      title: 'Before compaction',
      workspace: '/tmp/workspace',
      model: 'test-model'
    })
    const dir = join(root, 'threads', thread.id)
    await mkdir(dir, { recursive: true })
    const line = JSON.stringify({
      kind: 'thread_metadata', version: 1, timestamp: thread.updatedAt,
      thread: stripThreadItemBodies(thread)
    })
    const repetitions = Math.ceil(1_100_000 / Buffer.byteLength(`${line}\n`))
    const path = join(dir, 'metadata.jsonl')
    await Promise.all([
      writeFile(path, `${line}\n`.repeat(repetitions)),
      writeFile(join(dir, 'messages.jsonl'), ''),
      writeFile(join(dir, 'events.jsonl'), '')
    ])
    const fileAccess = new ObservableCoordinator()
    const store = new HybridThreadStore({ dataDir: root, fileAccess })
    await store.ready()
    const releaseRead = await holdRead(fileAccess, path)
    const upsert = store.upsert({ ...thread, title: 'After compaction' })
    await fileAccess.replacementRequested

    await releaseRead()
    await expect(upsert).resolves.toMatchObject({ title: 'After compaction' })
    const records = (await readFile(path, 'utf8')).trim().split('\n')
    expect(records).toHaveLength(1)
    expect(JSON.parse(records[0]!).thread.title).toBe('After compaction')
    store.close()
  })
})
