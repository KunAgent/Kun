import { mkdtemp, rm, stat } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { FileSessionStore } from '../adapters/file/file-session-store.js'
import { FileThreadStore } from '../adapters/file/file-thread-store.js'
import { InMemoryEventBus } from '../adapters/in-memory-event-bus.js'
import { InMemorySessionStore } from '../adapters/in-memory-session-store.js'
import { InMemoryThreadStore } from '../adapters/in-memory-thread-store.js'
import type { RuntimeEvent } from '../contracts/events.js'
import type { TurnItem } from '../contracts/items.js'
import type { SessionUsageAggregateResponse } from '../contracts/usage-query.js'
import { createThreadRecord } from '../domain/thread.js'
import { makeUserItem } from '../domain/item.js'
import type { AgentSession } from '../domain/session.js'
import { ContextCompactor } from '../loop/context-compactor.js'
import { InflightTracker } from '../loop/inflight-tracker.js'
import { SteeringQueue } from '../loop/steering-queue.js'
import { SequentialIdGenerator } from '../ports/id-generator.js'
import type { ItemHistoryCommit, ItemHistorySnapshot, SessionStore } from '../ports/session-store.js'
import { RuntimeEventRecorder } from './runtime-event-recorder.js'
import { ThreadService } from './thread-service.js'
import { TurnConflictError, TurnService } from './turn-service.js'
import {
  LifecycleFencedSessionStore,
  LifecycleFencedThreadStore,
  ThreadLifecycleFence
} from './thread-lifecycle-fence.js'

const cleanup: string[] = []

afterEach(async () => {
  await Promise.all(cleanup.splice(0).map((path) => rm(path, { recursive: true, force: true })))
})

type Deferred = {
  promise: Promise<void>
  resolve(): void
}

function deferred(): Deferred {
  let resolvePromise!: () => void
  return {
    promise: new Promise<void>((resolve) => {
      resolvePromise = resolve
    }),
    resolve: () => resolvePromise()
  }
}

/** Holds exactly one chosen write just before it reaches the real file store. */
class GatedSessionStore implements SessionStore {
  readonly entered = deferred()
  readonly release = deferred()

  constructor(
    private readonly raw: SessionStore,
    private readonly gatedKind: 'item' | 'event'
  ) {}

  async appendEvent(threadId: string, event: RuntimeEvent): Promise<void> {
    if (this.gatedKind === 'event') {
      this.entered.resolve()
      await this.release.promise
    }
    await this.raw.appendEvent(threadId, event)
  }

  async appendItem(threadId: string, item: TurnItem): Promise<void> {
    if (this.gatedKind === 'item') {
      this.entered.resolve()
      await this.release.promise
    }
    await this.raw.appendItem(threadId, item)
  }

  rewriteItems(threadId: string, items: TurnItem[]): Promise<void> {
    return this.raw.rewriteItems(threadId, items)
  }

  loadItemSnapshot(threadId: string): Promise<ItemHistorySnapshot> {
    return this.raw.loadItemSnapshot(threadId)
  }

  rewriteItemsIfRevision(
    threadId: string,
    expectedRevision: number,
    items: TurnItem[]
  ): Promise<ItemHistoryCommit> {
    return this.raw.rewriteItemsIfRevision(threadId, expectedRevision, items)
  }

  updateItem(threadId: string, itemId: string, patch: Partial<TurnItem>): Promise<TurnItem | null> {
    return this.raw.updateItem(threadId, itemId, patch)
  }

  loadEventsSince(threadId: string, sinceSeq: number): Promise<RuntimeEvent[]> {
    return this.raw.loadEventsSince(threadId, sinceSeq)
  }

  loadItems(threadId: string): Promise<TurnItem[]> {
    return this.raw.loadItems(threadId)
  }

  loadSession(threadId: string): Promise<AgentSession | null> {
    return this.raw.loadSession(threadId)
  }

  upsertSession(session: AgentSession): Promise<void> {
    return this.raw.upsertSession(session)
  }

  highestSeq(threadId: string): Promise<number> {
    return this.raw.highestSeq(threadId)
  }

  resetMemory(): Promise<void> {
    return this.raw.resetMemory()
  }

  clearThreadMemory(threadId: string): void {
    this.raw.clearThreadMemory(threadId)
  }
}

async function makeRuntime(gatedKind: 'item' | 'event') {
  const root = await mkdtemp(join(tmpdir(), 'kun-thread-fence-'))
  cleanup.push(root)
  const threadId = 'thr_lifecycle_fence'
  const rawThreadStore = new FileThreadStore({ dataDir: root })
  const rawSessionStore = new FileSessionStore({ dataDir: root })
  const gatedSessionStore = new GatedSessionStore(rawSessionStore, gatedKind)
  const fence = new ThreadLifecycleFence()
  const threadStore = new LifecycleFencedThreadStore(rawThreadStore, fence)
  const sessionStore = new LifecycleFencedSessionStore(gatedSessionStore, fence)
  const eventBus = new InMemoryEventBus()
  const nowIso = () => '2026-07-10T00:00:00.000Z'
  const events = new RuntimeEventRecorder({
    eventBus,
    sessionStore,
    allocateSeq: (id) => eventBus.allocateSeq(id),
    nowIso,
    lifecycleFence: fence
  })
  const threads = new ThreadService({
    threadStore,
    deleteThreadStore: rawThreadStore,
    sessionStore,
    events,
    ids: new SequentialIdGenerator(),
    nowIso,
    lifecycleFence: fence
  })
  await rawThreadStore.upsert(createThreadRecord({
    id: threadId,
    title: 'Before deletion',
    workspace: root,
    model: 'model'
  }))
  return {
    root,
    threadId,
    rawThreadStore,
    rawSessionStore,
    gatedSessionStore,
    fence,
    threadStore,
    sessionStore,
    eventBus,
    events,
    threads
  }
}

function item(threadId: string, id = 'item_late'): TurnItem {
  return makeUserItem({
    id,
    threadId,
    turnId: 'turn_late',
    text: 'late write'
  })
}

async function threadDirectoryExists(root: string, threadId: string): Promise<boolean> {
  try {
    await stat(join(root, 'threads', threadId))
    return true
  } catch {
    return false
  }
}

async function waitForClosing(fence: ThreadLifecycleFence, threadId: string): Promise<void> {
  for (let attempt = 0; attempt < 20; attempt += 1) {
    if (fence.isClosing(threadId)) return
    await Promise.resolve()
  }
  throw new Error(`thread did not enter closing state: ${threadId}`)
}

describe('ThreadLifecycleFence persistence guard', () => {
  it('preserves indexed usage aggregation through the lifecycle wrapper', () => {
    const raw = new InMemorySessionStore() as SessionStore
    raw.aggregateUsage = async () => ({}) as SessionUsageAggregateResponse
    const wrapped = new LifecycleFencedSessionStore(raw, new ThreadLifecycleFence())
    expect(wrapped.aggregateUsage).toBeTypeOf('function')
  })

  it('rejects a conditional history rewrite once deletion closes the thread', async () => {
    const runtime = await makeRuntime('item')
    await runtime.rawSessionStore.appendItem(runtime.threadId, item(runtime.threadId, 'item_before_delete'))
    const snapshot = await runtime.sessionStore.loadItemSnapshot(runtime.threadId)

    const deleting = runtime.threads.delete(runtime.threadId)
    await waitForClosing(runtime.fence, runtime.threadId)

    await expect(runtime.sessionStore.rewriteItemsIfRevision(
      runtime.threadId,
      snapshot.revision,
      snapshot.items
    )).resolves.toEqual({ applied: false, reason: 'closed' })
    await expect(deleting).resolves.toBe(true)
    expect(await threadDirectoryExists(runtime.root, runtime.threadId)).toBe(false)
  })

  it('drains a deferred item append before raw delete and blocks post-delete recreation', async () => {
    const runtime = await makeRuntime('item')
    const append = runtime.sessionStore.appendItem(runtime.threadId, item(runtime.threadId))
    await runtime.gatedSessionStore.entered.promise

    const deleting = runtime.threads.delete(runtime.threadId)
    await waitForClosing(runtime.fence, runtime.threadId)

    runtime.gatedSessionStore.release.resolve()
    await append
    await expect(deleting).resolves.toBe(true)

    expect(await threadDirectoryExists(runtime.root, runtime.threadId)).toBe(false)
    await runtime.sessionStore.appendItem(runtime.threadId, item(runtime.threadId, 'item_after_delete'))
    expect(await threadDirectoryExists(runtime.root, runtime.threadId)).toBe(false)
    expect(await runtime.rawSessionStore.loadItems(runtime.threadId)).toEqual([])
  })

  it('does not publish or preserve an event whose deferred commit expires during deletion', async () => {
    const runtime = await makeRuntime('event')
    const recording = runtime.events.record({
      kind: 'error',
      threadId: runtime.threadId,
      message: 'late event'
    })
    await runtime.gatedSessionStore.entered.promise

    const deleting = runtime.threads.delete(runtime.threadId)
    await waitForClosing(runtime.fence, runtime.threadId)
    runtime.gatedSessionStore.release.resolve()
    await recording
    await expect(deleting).resolves.toBe(true)

    expect(runtime.eventBus.snapshotSince(runtime.threadId, 0)).toEqual([])
    expect(await threadDirectoryExists(runtime.root, runtime.threadId)).toBe(false)
  })

  it('serializes a same-id create behind deletion and reopens a fresh generation', async () => {
    const runtime = await makeRuntime('item')
    const append = runtime.sessionStore.appendItem(runtime.threadId, item(runtime.threadId))
    await runtime.gatedSessionStore.entered.promise

    const deleting = runtime.threads.delete(runtime.threadId)
    await waitForClosing(runtime.fence, runtime.threadId)
    const recreating = runtime.threads.create({
      workspace: runtime.root,
      model: 'model',
      mode: 'agent'
    }, {
      id: runtime.threadId,
      title: 'After deletion'
    })

    runtime.gatedSessionStore.release.resolve()
    await append
    await expect(deleting).resolves.toBe(true)
    await expect(recreating).resolves.toMatchObject({ id: runtime.threadId, title: 'After deletion' })

    expect(runtime.fence.isClosing(runtime.threadId)).toBe(false)
    expect(runtime.fence.isDeleted(runtime.threadId)).toBe(false)
    expect((await runtime.rawThreadStore.get(runtime.threadId))?.title).toBe('After deletion')
    await runtime.sessionStore.appendItem(runtime.threadId, item(runtime.threadId, 'item_new_generation'))
    expect(await runtime.rawSessionStore.loadItems(runtime.threadId)).toHaveLength(1)
  })

  it('rejects starts while closing and aborts only that thread execution', async () => {
    const rawThreadStore = new InMemoryThreadStore()
    const rawSessionStore = new InMemorySessionStore()
    const fence = new ThreadLifecycleFence()
    const threadStore = new LifecycleFencedThreadStore(rawThreadStore, fence)
    const sessionStore = new LifecycleFencedSessionStore(rawSessionStore, fence)
    const eventBus = new InMemoryEventBus()
    const nowIso = () => '2026-07-10T00:00:00.000Z'
    const events = new RuntimeEventRecorder({
      eventBus,
      sessionStore,
      allocateSeq: (id) => eventBus.allocateSeq(id),
      nowIso,
      lifecycleFence: fence
    })
    const firstThreadId = 'thr_fence_first'
    const secondThreadId = 'thr_fence_second'
    await Promise.all([firstThreadId, secondThreadId].map((id) => rawThreadStore.upsert(createThreadRecord({
      id,
      title: id,
      workspace: '/tmp/workspace',
      model: 'model'
    }))))
    const turns = new TurnService({
      threadStore,
      sessionStore,
      events,
      inflight: new InflightTracker(),
      steering: new SteeringQueue(),
      compactor: new ContextCompactor(),
      maxConcurrentTurns: 2,
      lifecycleFence: fence,
      ids: new SequentialIdGenerator(),
      nowIso
    })

    fence.beginClose(firstThreadId)
    await expect(turns.startTurn({
      threadId: firstThreadId,
      request: { prompt: 'must not start', model: 'model' }
    })).rejects.toBeInstanceOf(TurnConflictError)
    fence.reopen(firstThreadId)

    const first = await turns.startTurn({
      threadId: firstThreadId,
      request: { prompt: 'first', model: 'model' }
    })
    const second = await turns.startTurn({
      threadId: secondThreadId,
      request: { prompt: 'second', model: 'model' }
    })
    expect(turns.abortThreadExecution(firstThreadId)).toBe(1)
    expect(turns.getAbortController(first.turnId)?.aborted).toBe(true)
    expect(turns.getAbortController(second.turnId)?.aborted).toBe(false)

    await turns.interruptTurn({ threadId: firstThreadId, turnId: first.turnId })
    await turns.interruptTurn({ threadId: secondThreadId, turnId: second.turnId })
  })
})
