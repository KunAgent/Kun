import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { makeAssistantReasoningItem, makeUserItem } from '../../domain/item.js'
import { FileSessionStore } from './file-session-store.js'
import {
  FileSessionLiveCheckpointCoordinator,
  LIVE_ITEM_CHECKPOINT_MAX_AGE_MS,
  LIVE_ITEM_CHECKPOINT_MAX_EVENTS,
  type FileSessionLiveCheckpointHost
} from './file-session-live-checkpoint-coordinator.js'
import { FileSessionLiveItems, readLiveItems } from './file-session-live-items.js'

const roots: string[] = []

afterEach(async () => {
  vi.useRealTimers()
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })))
})

function representedSeq(text: string): number {
  return JSON.parse(text).entries[0].representedSeq as number
}

/**
 * Deterministic coordinator host whose `withThreadWrite` gates each write
 * behind an explicit release so tests can interleave checkpoints exactly.
 */
function makeGatedHost(root: string, threadId: string) {
  const liveItems = new FileSessionLiveItems()
  const threadDir = join(root, 'threads', threadId)
  const liveItemsPath = join(threadDir, 'live-items.json')
  const releases: Array<() => void> = []
  let completedWrites = 0
  let revision = 0

  const host: FileSessionLiveCheckpointHost = {
    liveItems,
    threadDir: () => threadDir,
    liveItemsPath: () => liveItemsPath,
    bumpItemsVersion: () => {},
    applyItemToCache: () => {},
    bumpItemHistoryRevision: () => {
      revision += 1
      return revision
    },
    withThreadWrite<T>(_threadId: string, operation: () => Promise<T>): Promise<T> {
      return new Promise<T>((resolve, reject) => {
        releases.push(() => {
          void operation().then(
            (value) => {
              completedWrites += 1
              resolve(value)
            },
            (error: unknown) => reject(error)
          )
        })
      })
    }
  }

  return {
    host,
    liveItemsPath,
    release: () => {
      const next = releases.shift()
      if (!next) throw new Error('no gated write to release')
      next()
    },
    get pendingWrites() {
      return releases.length
    },
    get completedWrites() {
      return completedWrites
    }
  }
}

describe('FileSession live checkpoint coordination', () => {
  it('flushes by event count without entering the durable path for every delta', async () => {
    const root = await mkdtemp(join(tmpdir(), 'kun-live-checkpoint-events-'))
    roots.push(root)
    const store = new FileSessionStore({ dataDir: root })
    const path = join(root, 'threads', 'thread-live', 'live-items.json')
    const item = (seq: number) => makeAssistantReasoningItem({
      id: 'reasoning', threadId: 'thread-live', turnId: 'turn-live',
      status: 'running', text: `reasoning-${seq}`
    })
    await store.checkpointLiveItem('thread-live', item(0), 0)
    for (let seq = 1; seq < LIVE_ITEM_CHECKPOINT_MAX_EVENTS; seq += 1) {
      await store.checkpointLiveItem('thread-live', item(seq), seq)
    }
    expect(representedSeq(await readFile(path, 'utf8'))).toBe(0)
    await store.checkpointLiveItem(
      'thread-live', item(LIVE_ITEM_CHECKPOINT_MAX_EVENTS), LIVE_ITEM_CHECKPOINT_MAX_EVENTS
    )
    expect(representedSeq(await readFile(path, 'utf8'))).toBe(LIVE_ITEM_CHECKPOINT_MAX_EVENTS)
    await store.close()
  })

  it('flushes a low-volume checkpoint by age and on shutdown', async () => {
    vi.useFakeTimers()
    const root = await mkdtemp(join(tmpdir(), 'kun-live-checkpoint-age-'))
    roots.push(root)
    const store = new FileSessionStore({ dataDir: root })
    const path = join(root, 'threads', 'thread-age', 'live-items.json')
    const item = (text: string) => makeAssistantReasoningItem({
      id: 'reasoning', threadId: 'thread-age', turnId: 'turn-age', status: 'running', text
    })
    await store.checkpointLiveItem('thread-age', item('a'), 0)
    await store.checkpointLiveItem('thread-age', item('ab'), 1)
    await vi.advanceTimersByTimeAsync(LIVE_ITEM_CHECKPOINT_MAX_AGE_MS)
    await store.checkpointLiveItem('thread-age', item('ab'), 1)
    expect(representedSeq(await readFile(path, 'utf8'))).toBe(1)
    await store.checkpointLiveItem('thread-age', item('abc'), 2)
    await store.close()
    expect(representedSeq(await readFile(path, 'utf8'))).toBe(2)
  })
})

describe('FileSession live checkpoint generation barrier', () => {
  it('keeps a post-barrier checkpoint alive when clearThread follows a drain', async () => {
    const root = await mkdtemp(join(tmpdir(), 'kun-live-checkpoint-barrier-'))
    roots.push(root)
    const threadId = 'thread_barrier'
    const gate = makeGatedHost(root, threadId)
    const coordinator = new FileSessionLiveCheckpointCoordinator(gate.host)
    const item = (seq: number) => makeAssistantReasoningItem({
      id: 'reasoning', threadId, turnId: 'turn', status: 'running', text: `reasoning-${seq}`
    })

    // First checkpoint holds write #1; the second takes the skip path while
    // that write is still in flight.
    const first = coordinator.checkpoint(threadId, item(0), 0)
    await coordinator.checkpoint(threadId, item(1), 1)

    gate.release()
    await first

    // Drain the now-dirty state (item 1) through the barrier loop; write #2
    // is gated until released.
    const flush = coordinator.flushThread(threadId)
    gate.release()
    const generation = await flush

    // A checkpoint arriving after the barrier dirties the same state again and
    // must survive the immediately-following clearThread.
    await coordinator.checkpoint(threadId, item(2), 2)
    coordinator.clearThread(threadId, generation)
    expect(coordinator.stats().pending).toBe(1)

    const closing = coordinator.close()
    gate.release() // flush the surviving item(2) state
    await closing
    const entries = await readLiveItems(gate.liveItemsPath)
    expect(entries).toHaveLength(1)
    expect(entries[0]).toMatchObject({ representedSeq: 2, item: { id: 'reasoning', text: 'reasoning-2' } })
  })

  it('drains a state created during the flush barrier before resolving', async () => {
    const root = await mkdtemp(join(tmpdir(), 'kun-live-checkpoint-loop-'))
    roots.push(root)
    const threadId = 'thread_loop'
    const gate = makeGatedHost(root, threadId)
    const coordinator = new FileSessionLiveCheckpointCoordinator(gate.host)
    const item = (id: string, seq: number) => makeAssistantReasoningItem({
      id, threadId, turnId: 'turn', status: 'running', text: `${id}-${seq}`
    })

    // Hold write #1 for item A, then start the barrier flush.
    const first = coordinator.checkpoint(threadId, item('a', 0), 0)
    const flush = coordinator.flushThread(threadId)
    // A second item arrives while flushThread is awaiting write #1.
    const second = coordinator.checkpoint(threadId, item('b', 5), 5)

    gate.release()
    await first
    gate.release()
    await second
    const generation = await flush

    // Both writes completed before the barrier resolved, so nothing is left
    // in flight or dirty.
    expect(gate.completedWrites).toBe(2)
    expect(generation).toBe(1)

    await coordinator.close()
    const entries = await readLiveItems(gate.liveItemsPath)
    expect(entries.map((entry) => entry.representedSeq).sort((a, b) => a - b)).toEqual([0, 5])
  })

  it('clears pre-barrier states after a clean flush', async () => {
    const root = await mkdtemp(join(tmpdir(), 'kun-live-checkpoint-clear-'))
    roots.push(root)
    const threadId = 'thread_clear'
    const gate = makeGatedHost(root, threadId)
    const coordinator = new FileSessionLiveCheckpointCoordinator(gate.host)
    const item = (seq: number) => makeAssistantReasoningItem({
      id: 'reasoning', threadId, turnId: 'turn', status: 'running', text: `r-${seq}`
    })

    const first = coordinator.checkpoint(threadId, item(0), 0)
    gate.release()
    await first

    const generation = await coordinator.flushThread(threadId)
    coordinator.clearThread(threadId, generation)
    expect(coordinator.stats().pending).toBe(0)

    const second = coordinator.checkpoint(threadId, item(1), 1)
    gate.release()
    await second
    await coordinator.close()
    const entries = await readLiveItems(gate.liveItemsPath)
    expect(entries).toMatchObject([{ representedSeq: 1 }])
  })

  it('overlays the drained latest live text after a revisioned rewrite', async () => {
    const root = await mkdtemp(join(tmpdir(), 'kun-live-checkpoint-wiring-'))
    roots.push(root)
    const threadId = 'thread_wiring'
    const store = new FileSessionStore({ dataDir: root })
    const runningItem = (text: string) => makeAssistantReasoningItem({
      id: 'reasoning', threadId, turnId: 'turn', status: 'running', text
    })
    const userMsg = makeUserItem({ id: 'user', threadId, turnId: 'turn', text: 'hi' })

    // Fire the first checkpoint without awaiting; the second dirties the same
    // state while the first write is still in flight.
    const first = store.checkpointLiveItem(threadId, runningItem('a'), 0)
    await store.checkpointLiveItem(threadId, runningItem('ab'), 1)

    // Two durable writes (one for 'a', one drained 'ab') bump the history
    // revision to 2 before the rewrite reads it.
    const commit = await store.rewriteItemsIfRevision(
      threadId, 2, [userMsg, runningItem('a')]
    )
    expect(commit).toMatchObject({ applied: true })
    await first
    await store.close()

    // Cold reload overlays the drained live checkpoint ('ab') onto the
    // rewritten canonical ('a'); a warm store would serve its cached canonical.
    const recovered = new FileSessionStore({ dataDir: root })
    const snapshot = await recovered.loadItemSnapshot(threadId)
    expect(snapshot.items).toMatchObject([
      { id: 'user', kind: 'user_message' },
      { id: 'reasoning', text: 'ab', status: 'running' }
    ])
    await recovered.close()
  })
})
