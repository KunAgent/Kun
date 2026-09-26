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
import { createThreadRecord, toThreadSummary } from '../domain/thread.js'

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

/** A store without `listPage`: the service falls back to list + in-memory
 * filtering, which must see every thread regardless of workspace options. */
class ListOnlyThreadStore implements ThreadStore {
  listOptions?: ThreadStoreListOptions

  constructor(private readonly summaries: ThreadSummary[]) {}

  async list(options?: ThreadStoreListOptions): Promise<ThreadSummary[]> {
    this.listOptions = options
    return this.summaries
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

describe('ThreadService multi-workspace paging', () => {
  it('forwards project worktree roots alongside the workspace filter', async () => {
    const raw = new CapturingThreadStore()

    await serviceWith(raw).listPage({
      workspace: '/repo',
      workspaces: ['/repo-wt-a', '/repo-wt-b'],
      limit: 50
    })

    expect(raw.pageOptions).toEqual({
      workspace: '/repo',
      workspaces: ['/repo-wt-a', '/repo-wt-b'],
      limit: 50
    })
  })

  it('clears both workspace filters before a no-listPage store lists everything', async () => {
    const summaries = [
      toThreadSummary(createThreadRecord({ id: 'thr-repo', title: 'Repo', workspace: '/repo', model: 'm' })),
      toThreadSummary(createThreadRecord({ id: 'thr-wt', title: 'Worktree', workspace: '/wt', model: 'm' })),
      toThreadSummary(createThreadRecord({ id: 'thr-other', title: 'Other', workspace: '/other', model: 'm' }))
    ]
    const store = new ListOnlyThreadStore(summaries)

    const page = await serviceWith(store).listPage({
      workspace: '/repo',
      workspaces: ['/wt'],
      limit: 50
    })

    expect(store.listOptions).toMatchObject({ workspace: undefined, workspaces: undefined })
    expect(page.threads.map((thread) => thread.id).sort()).toEqual(['thr-repo', 'thr-wt'])
    expect(page.total).toBe(2)
  })

  it('filters list() on the union of workspace and workspaces', async () => {
    const summaries = [
      toThreadSummary(createThreadRecord({ id: 'thr-repo', title: 'Repo', workspace: '/repo', model: 'm' })),
      toThreadSummary(createThreadRecord({ id: 'thr-wt', title: 'Worktree', workspace: '/wt', model: 'm' })),
      toThreadSummary(createThreadRecord({ id: 'thr-other', title: 'Other', workspace: '/other', model: 'm' }))
    ]
    const store = new ListOnlyThreadStore(summaries)

    const threads = await serviceWith(store).list({
      workspace: '/repo',
      workspaces: ['/wt'],
      includeArchived: true,
      includeSide: true
    })

    expect(threads.map((thread) => thread.id).sort()).toEqual(['thr-repo', 'thr-wt'])
  })
})
