import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import type { RuntimeEvent } from '../../contracts/events.js'
import type { AssistantReasoningTurnItem } from '../../contracts/items.js'
import { FileSessionStore } from './file-session-store.js'
import { loadItemPageFromStore } from './file-session-page.js'
import { JsonlFileAccessCoordinator } from './jsonl-file-access.js'
import { serializeLiveItems } from './file-session-live-items.js'

const roots: string[] = []
const threadId = 'thread_lock_order'
const item: AssistantReasoningTurnItem = {
  id: 'reasoning_live', threadId, turnId: 'turn_live', text: 'before', status: 'running',
  kind: 'assistant_reasoning', role: 'assistant', createdAt: '2026-09-21T00:00:00.000Z'
}
const delta: RuntimeEvent = {
  seq: 2, timestamp: '2026-09-21T00:00:00.000Z', threadId, turnId: item.turnId,
  itemId: item.id, kind: 'assistant_reasoning_delta', deltaOffset: 6,
  item: { ...item, text: ' after' }
}

function deferred() {
  let resolve!: () => void
  const promise = new Promise<void>((done) => { resolve = done })
  return { promise, resolve }
}

/** Pause only at the recovery boundary; all locks and file operations are real. */
class RecoveryStore extends FileSessionStore {
  readonly recoveryStarted = deferred()
  readonly resumeRecovery = deferred()
  onWriteQueued?: () => void
  private pauseRecovery = true

  override async loadEventsSince(id: string, seq: number): Promise<RuntimeEvent[]> {
    if (id === threadId && this.pauseRecovery) {
      this.pauseRecovery = false
      this.recoveryStarted.resolve()
      await this.resumeRecovery.promise
    }
    return super.loadEventsSince(id, seq)
  }

  override withThreadWrite<T>(id: string, operation: () => Promise<T>): Promise<T> {
    if (id === threadId) this.onWriteQueued?.()
    return super.withThreadWrite(id, operation)
  }
}

async function recoveryStore(): Promise<RecoveryStore> {
  const root = await mkdtemp(join(tmpdir(), 'kun-session-lock-order-'))
  roots.push(root)
  const dir = join(root, 'threads', threadId)
  await mkdir(dir, { recursive: true })
  await writeFile(join(dir, 'messages.jsonl'), '')
  await writeFile(join(dir, 'live-items.json'), serializeLiveItems([{ item, representedSeq: 1 }]))
  const usageEvents: RuntimeEvent[] = [0, 1].map((seq) => ({
    kind: 'usage', seq, threadId, timestamp: delta.timestamp, model: 'test-model',
    usage: { promptTokens: seq, completionTokens: 0, totalTokens: seq, cacheHitRate: null, turns: 1 }
  }))
  await writeFile(join(dir, 'events.jsonl'), [...usageEvents, delta].map((event) => `${JSON.stringify(event)}\n`).join(''))
  return new RecoveryStore({
    dataDir: root, compactionDelayMs: 60_000,
    usageEventCompaction: { maxBytes: 1, nowIso: () => delta.timestamp }
  })
}

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, {
    recursive: true, force: true, maxRetries: 5, retryDelay: 50
  })))
})

describe('FileSessionStore lock ordering', () => {
  for (const reader of ['loadItems', 'loadItemSnapshot', 'updateItem'] as const) {
    for (const writer of ['trim', 'usage', 'append'] as const) {
      it(`finishes ${reader} live recovery while an event ${writer} queues`, async () => {
        const store = await recoveryStore()
        const reading = reader === 'updateItem'
          ? store.updateItem(threadId, item.id, { status: 'completed' })
          : store[reader](threadId)
        await store.recoveryStarted.promise

        const writerQueued = deferred()
        store.onWriteQueued = writerQueued.resolve
        if (writer === 'usage') store.scheduleUsageEventCompaction(threadId)
        const writing = writer === 'trim'
          ? store.trimEventsFromSeq(threadId, 2)
          : writer === 'usage' ? store.flushScheduledCompaction(threadId)
          : store.appendEvent(threadId, { ...delta, seq: 3, item: { ...item, text: '' } })
        await writerQueued.promise
        store.onWriteQueued = undefined

        // A blocked thread must not prevent reads of unrelated conversations.
        await expect(store.loadItems('thread_other')).resolves.toEqual([])
        store.resumeRecovery.resolve()
        await Promise.all([reading, writing])

        const items = await store.loadItems(threadId)
        expect(items).toMatchObject([{ id: item.id, text: 'before after' }])
        expect(items[0].status).toBe(reader === 'updateItem' ? 'completed' : 'running')
        await expect(store.loadItemSnapshot(threadId)).resolves.toMatchObject({ items })
        await expect(store.loadEventsSince(threadId, 1)).resolves.toHaveLength(writer === 'append' ? 2 : 1)
        await expect(store.loadEventPage(threadId, { sinceSeq: 1, maxEvents: 10, maxBytes: 4096 }))
          .resolves.toMatchObject({ hasMore: false })
        await store.close()
      })
    }
  }

  it('finishes a fallback page queued behind a message replacement', async () => {
    const store = await recoveryStore()
    const fileAccess = new JsonlFileAccessCoordinator()
    const path = join(store.threadDir(threadId), 'messages.jsonl')
    const queueHeld = deferred()
    const releaseQueue = deferred()
    const holding = store.withThreadWrite(threadId, async () => {
      queueHeld.resolve()
      await releaseQueue.promise
    })
    await queueHeld.promise

    // Simulate the same commit boundary as item compaction/rewrite. The page
    // must not hold a read lease while it waits behind this queued replacement.
    const replacing = store.withThreadWrite(threadId, () => fileAccess.withReplacement(path, () =>
      writeFile(path, `${JSON.stringify(item)}\n`)
    ))
    const pageQueued = deferred()
    const page = loadItemPageFromStore({
      path, options: { maxItems: 10, maxBytes: 4096 }, fileAccess,
      cachedItems: () => undefined, touchCache: () => undefined,
      withThreadWrite: (operation) => {
        pageQueued.resolve()
        return store.withThreadWrite(threadId, operation)
      },
      scheduleCompaction: () => undefined, compactionMinBytes: Number.MAX_SAFE_INTEGER
    })
    await pageQueued.promise
    releaseQueue.resolve()
    await Promise.all([holding, replacing])
    await expect(page).resolves.toMatchObject({ items: [{ id: item.id, text: 'before' }] })
    // The page's lease must also be released after its file handle is closed.
    await fileAccess.withReplacement(path, () => writeFile(path, ''))
    await store.close()
  })
})
