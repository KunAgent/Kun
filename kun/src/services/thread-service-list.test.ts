import { describe, expect, it } from 'vitest'
import { InMemoryEventBus } from '../adapters/in-memory-event-bus.js'
import { InMemorySessionStore } from '../adapters/in-memory-session-store.js'
import type { ThreadRecord, ThreadSummary } from '../contracts/threads.js'
import { SequentialIdGenerator } from '../ports/id-generator.js'
import type {
  ThreadStore,
  ThreadStoreListOptions,
  ThreadStoreListPage
} from '../ports/thread-store.js'
import { ThreadService } from './thread-service.js'
import {
  LifecycleFencedThreadStore,
  ThreadLifecycleFence
} from './thread-lifecycle-fence.js'
import { RuntimeEventRecorder } from './runtime-event-recorder.js'

class CapturingThreadStore implements ThreadStore {
  listOptions?: ThreadStoreListOptions
  pageOptions?: ThreadStoreListOptions

  async list(options?: ThreadStoreListOptions): Promise<ThreadSummary[]> {
    this.listOptions = options
    return []
  }

  async listPage(options?: ThreadStoreListOptions): Promise<ThreadStoreListPage> {
    this.pageOptions = options
    return { threads: [], hasMore: false, total: 0 }
  }

  async get(_threadId: string): Promise<ThreadRecord | null> {
    return null
  }

  async upsert(thread: ThreadRecord): Promise<ThreadRecord> {
    return thread
  }

  async delete(_threadId: string): Promise<boolean> {
    return false
  }
}

function serviceWith(store: ThreadStore): ThreadService {
  const sessionStore = new InMemorySessionStore()
  const eventBus = new InMemoryEventBus()
  const nowIso = () => '2026-08-14T00:00:00.000Z'
  return new ThreadService({
    threadStore: store,
    sessionStore,
    events: new RuntimeEventRecorder({
      eventBus,
      sessionStore,
      allocateSeq: (threadId) => eventBus.allocateSeq(threadId),
      nowIso
    }),
    ids: new SequentialIdGenerator(),
    nowIso
  })
}

describe('ThreadService sidebar listing', () => {
  it('keeps lean as an HTTP projection option for the initial inventory', async () => {
    const raw = new CapturingThreadStore()

    await serviceWith(raw).list({
      lean: true,
      includeArchived: true,
      includeSide: true
    })

    expect(raw.listOptions).toEqual({ includeArchived: true, includeSide: true })
  })

  it('keeps lean out of a bound workspace page call through the lifecycle wrapper', async () => {
    const raw = new CapturingThreadStore()
    const wrapped = new LifecycleFencedThreadStore(raw, new ThreadLifecycleFence())

    await serviceWith(wrapped).listPage({
      lean: true,
      workspace: '/tmp/sidebar-page',
      limit: 25,
      cursor: 'opaque-cursor',
      includeArchived: true,
      includeSide: true
    })

    expect(raw.pageOptions).toEqual({
      workspace: '/tmp/sidebar-page',
      limit: 25,
      cursor: 'opaque-cursor',
      includeArchived: true,
      includeSide: true
    })
  })

  it('defaults paginated listings to 100 items', async () => {
    const raw = new CapturingThreadStore()

    await serviceWith(raw).listPage()

    expect(raw.pageOptions).toEqual({ limit: 100 })
  })
})
