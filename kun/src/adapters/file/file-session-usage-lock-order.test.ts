import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { RuntimeEvent, UsageEvent } from '../../contracts/events.js'
import { FileSessionStore } from './file-session-store.js'
import { FileSessionUsageIndex } from './file-session-usage-index.js'

const roots: string[] = []
const threadId = 'thread_usage_lock'

function deferred() {
  let resolve!: () => void
  const promise = new Promise<void>((done) => { resolve = done })
  return { promise, resolve }
}

function usageEvent(seq: number): UsageEvent {
  return {
    kind: 'usage', seq, threadId, timestamp: '2026-09-21T00:00:00.000Z', model: 'test',
    usage: { promptTokens: seq, completionTokens: 0, totalTokens: seq, cacheHitRate: null, turns: 1 }
  }
}

class ColdUsageStore extends FileSessionStore {
  readonly replayStarted = deferred()
  readonly resumeReplay = deferred()
  replaySinceSeq?: number

  override async *iterateEventsSince(
    id: string,
    sinceSeq: number,
    options?: { maxRecordBytes?: number }
  ): AsyncIterable<RuntimeEvent> {
    if (id === threadId && this.replaySinceSeq === undefined) {
      this.replaySinceSeq = sinceSeq
      this.replayStarted.resolve()
      await this.resumeReplay.promise
    }
    yield* super.iterateEventsSince(id, sinceSeq, options)
  }
}

afterEach(async () => {
  vi.restoreAllMocks()
  await Promise.all(roots.splice(0).map((root) => rm(root, {
    recursive: true, force: true, maxRetries: 5, retryDelay: 50
  })))
})

describe('FileSessionStore usage lock ordering', () => {
  for (const reader of ['records', 'snapshot'] as const) {
    it(`finishes cold usage ${reader} and a concurrent usage append without duplicate accounting`, async () => {
      const root = await mkdtemp(join(tmpdir(), 'kun-usage-lock-order-'))
      roots.push(root)
      const seed = new FileSessionStore({ dataDir: root })
      await seed.appendEvent(threadId, usageEvent(1))
      await seed.close()

      const store = new ColdUsageStore({ dataDir: root })
      const reading = reader === 'records'
        ? store.loadUsageRecords({ threadId })
        : store.loadLatestUsageSnapshots({ threadIds: [threadId] })
      await store.replayStarted.promise
      expect(store.replaySinceSeq).toBe(1)

      // Keep the real usage queue: observe when the append reaches it while
      // the cold query owns that queue and is about to read the event index.
      const recordingStarted = deferred()
      const recordUsage = FileSessionUsageIndex.prototype.recordUsage
      const recording = vi.spyOn(FileSessionUsageIndex.prototype, 'recordUsage')
        .mockImplementation(function (this: FileSessionUsageIndex, ...args) {
          recordingStarted.resolve()
          return recordUsage.apply(this, args)
        })
      const appending = store.appendEvent(threadId, usageEvent(2))
      await recordingStarted.promise
      const items = store.loadItems(threadId)
      await expect(store.loadItems('thread_other')).resolves.toEqual([])
      store.resumeReplay.resolve()
      await Promise.all([reading, appending, items])
      recording.mockRestore()

      await expect(store.loadUsageRecords({ threadId })).resolves.toMatchObject([
        { usage: { promptTokens: 1 } }, { usage: { promptTokens: 1 } }
      ])
      await expect(store.loadLatestUsageSnapshots({ threadIds: [threadId] }))
        .resolves.toMatchObject([{ seq: 2, usage: { promptTokens: 2 } }])
      await store.appendEvent(threadId, usageEvent(3))
      await store.close()

      // A fresh reader must see each usage delta exactly once after restart.
      const reopened = new FileSessionStore({ dataDir: root })
      const records = await reopened.loadUsageRecords({ threadId })
      expect(records.map((record) => record.usage.promptTokens)).toEqual([1, 1, 1])
      expect((await reopened.loadEventsSince(threadId, 0)).map((event) => event.seq)).toEqual([1, 2, 3])
      expect(await reopened.highestSeq(threadId)).toBe(3)
      await reopened.close()
    })
  }
})
