import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { NormalizedThread, ThreadDetail } from '../agent/types'
import { createBackgroundThreadSync, BACKGROUND_THREAD_SYNC_HEARTBEAT_MS } from './thread-background-sync'
import { buildPrefetchedThreadSnapshot, cacheThreadSnapshot, clearThreadSnapshotCache, getThreadSnapshot, invalidateThreadSnapshot, threadSnapshotCacheStats } from './thread-snapshot-cache'
import { useCodexReferenceState } from '../history-reference/codex-reference-state'
import type { ChatState } from './chat-store-types'

function thread(id: string, running = true): NormalizedThread {
  return { id, title: id, mode: 'agent', model: 'model', updatedAt: '2026-10-11T00:00:00Z',
    status: running ? 'running' : 'idle', latestTurnId: `${id}-turn`,
    latestTurnStatus: running ? 'running' : 'completed', latestSeq: 10 }
}

function detail(id: string, running = true): ThreadDetail {
  return { blocks: [{ kind: 'user', id: `${id}-user`, text: id }], latestSeq: 8,
    activeTurn: running ? { id: `${id}-turn`, status: 'running', orchestration: 'direct' } : null,
    latestTurnId: `${id}-turn`, latestTurnStatus: running ? 'running' : 'completed',
    threadStatus: running ? 'running' : 'idle',
    ...(running ? { liveProjection: { assistant: { text: 'Already accumulated',
      itemId: `${id}-answer`, turnId: `${id}-turn` } } } : {}) }
}

function deferred<T>() {
  let resolve!: (value: T) => void
  let reject!: (error: Error) => void
  const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no })
  return { promise, resolve, reject }
}

let stop: (() => void) | undefined
function setup(threads = [thread('active'), thread('background')], read = vi.fn(async (id: string) => detail(id))) {
  let changed = () => undefined as void
  const state: Pick<ChatState, 'activeThreadId' | 'threads' | 'adeThreads' | 'runtimeConnection'> = {
    activeThreadId: 'active', threads, adeThreads: [], runtimeConnection: 'ready'
  }
  const provider = { getThreadDetail: read }
  stop = createBackgroundThreadSync({ getState: () => state, getProvider: () => provider,
    subscribe: (listener) => { changed = listener; return () => { changed = () => undefined } } })
  return { state, read, changed: () => changed() }
}

const flush = () => vi.advanceTimersByTimeAsync(0)

describe('background thread checkpoints', () => {
  beforeEach(() => { vi.useFakeTimers(); vi.setSystemTime(new Date('2026-10-11T00:00:00Z')); clearThreadSnapshotCache() })
  afterEach(() => { stop?.(); stop = undefined; clearThreadSnapshotCache(); vi.useRealTimers() })

  it('maintains an inactive running projection without selecting it or invoking a live sink', async () => {
    const h = setup()
    await flush()
    expect(h.read).toHaveBeenCalledTimes(1)
    expect(h.read).toHaveBeenCalledWith('background', { priority: 'background', signal: expect.any(AbortSignal) })
    expect(h.state.activeThreadId).toBe('active')
    expect(getThreadSnapshot('background')).toMatchObject({ lastSeq: 8, liveDeltaSeqFloor: 8,
      liveAssistant: 'Already accumulated', liveAssistantItemId: 'background-answer',
      currentTurnId: 'background-turn', busy: true, busyUnconfirmed: true })
    expect(getThreadSnapshot('active')).toBeNull()
  })

  it('refreshes dirty running checkpoints but does not repeatedly fetch an unchanged timeline', async () => {
    const h = setup()
    await flush()
    await vi.advanceTimersByTimeAsync(6_000)
    expect(h.read).toHaveBeenCalledTimes(1)
    h.state.threads[1] = { ...h.state.threads[1], latestSeq: 40 }
    h.changed()
    await flush()
    expect(h.read).toHaveBeenCalledTimes(2)
    await vi.advanceTimersByTimeAsync(BACKGROUND_THREAD_SYNC_HEARTBEAT_MS + 2_000)
    expect(h.read).toHaveBeenCalledTimes(3)
  })

  it('refreshes completed background turns immediately and repairs a later completion invalidation', async () => {
    const read = vi.fn(async (id: string) => detail(id))
    const h = setup(undefined, read)
    await flush()
    read.mockImplementation(async (id) => detail(id, false))
    h.state.threads[1] = { ...thread('background', false), latestSeq: 20 }
    h.changed()
    await flush()
    expect(read).toHaveBeenCalledTimes(2)
    expect(getThreadSnapshot('background')).toMatchObject({ busy: false, liveAssistant: '', currentTurnId: null })
    invalidateThreadSnapshot('background')
    await vi.advanceTimersByTimeAsync(2_000)
    expect(read).toHaveBeenCalledTimes(3)
    expect(getThreadSnapshot('background')).not.toBeNull()
    await vi.advanceTimersByTimeAsync(30_000)
    expect(read).toHaveBeenCalledTimes(3)
  })

  it('does not refetch an unchanged idle page merely because the LRU evicted it', async () => {
    const read = vi.fn(async (id: string) => detail(id))
    const h = setup(undefined, read); await flush()
    read.mockImplementation(async (id) => detail(id, false))
    h.state.threads[1] = thread('background', false); h.changed(); await flush()
    for (let index = 0; index < 6; index += 1) {
      const id = `other-${index}`
      cacheThreadSnapshot(buildPrefetchedThreadSnapshot(thread(id, false), detail(id, false))!)
    }
    expect(getThreadSnapshot('background')).toBeNull()
    await vi.advanceTimersByTimeAsync(30_000)
    expect(read).toHaveBeenCalledTimes(2)
  })

  it('keeps recently opened idle conversations prepared when their metadata changes', async () => {
    const read = vi.fn(async (id: string) => detail(id, false))
    const h = setup([thread('active', false), thread('other', false)], read)
    await flush()
    expect(read).not.toHaveBeenCalled()
    h.state.activeThreadId = 'other'
    h.changed()
    await flush()
    expect(getThreadSnapshot('active')?.busy).toBe(false)
    h.state.threads[0] = { ...h.state.threads[0], latestSeq: 11 }
    h.changed()
    await vi.advanceTimersByTimeAsync(2_000)
    expect(read).toHaveBeenCalledTimes(2)
  })

  it('remembers an active conversation whose metadata arrives after initial selection', async () => {
    const read = vi.fn(async (id: string) => detail(id, false))
    const h = setup([], read); await flush()
    h.state.threads = [thread('active', false), thread('other', false)]
    h.changed(); await flush()
    h.state.activeThreadId = 'other'; h.changed(); await flush()
    expect(read).toHaveBeenCalledWith('active', expect.objectContaining({ priority: 'background' }))
    expect(getThreadSnapshot('active')?.busy).toBe(false)
  })

  it('forgets an explicitly removed active conversation instead of warming its stale recent metadata', async () => {
    const h = setup([thread('active', false), thread('other', false)])
    await flush()
    invalidateThreadSnapshot('active')
    h.state.threads = [thread('other', false)]
    h.state.activeThreadId = 'other'
    h.changed(); await flush()
    expect(h.read).not.toHaveBeenCalled()
  })

  it('bounds retained owners and shares the two request slots fairly', async () => {
    const pending = new Map<string, ReturnType<typeof deferred<ThreadDetail>>>()
    const read = vi.fn((id: string) => {
      const request = deferred<ThreadDetail>(); pending.set(id, request); return request.promise
    })
    setup([thread('active'), ...Array.from({ length: 9 }, (_, index) => thread(`b${index}`))], read)
    await flush()
    expect(read.mock.calls.map(([id]) => id)).toEqual(['b0', 'b1'])
    for (let index = 0; index < 6; index += 2) {
      pending.get(`b${index}`)!.resolve(detail(`b${index}`))
      pending.get(`b${index + 1}`)!.resolve(detail(`b${index + 1}`))
      await flush()
    }
    expect(read.mock.calls.map(([id]) => id)).toEqual(['b0', 'b1', 'b2', 'b3', 'b4', 'b5'])
    expect(threadSnapshotCacheStats().entries).toBe(6)
  })

  it('cancels a read on selection and rejects late results even if transport ignores abort', async () => {
    const request = deferred<ThreadDetail>()
    const read = vi.fn(() => request.promise)
    const h = setup([thread('active', false), thread('background')], read)
    await flush()
    const signal = (read.mock.calls[0] as unknown as [string, { signal: AbortSignal }])[1].signal
    h.state.activeThreadId = 'background'; h.changed(); await flush()
    expect(signal.aborted).toBe(true)
    request.resolve(detail('background'))
    await flush()
    expect(getThreadSnapshot('background')).toBeNull()
    expect(h.state.activeThreadId).toBe('background')
  })

  it.each(['delete', 'archive', 'disconnect'] as const)('rejects in-flight snapshots after %s', async (operation) => {
    const request = deferred<ThreadDetail>()
    const h = setup(undefined, vi.fn(() => request.promise))
    await flush()
    if (operation === 'delete') {
      invalidateThreadSnapshot('background')
      h.state.threads = [h.state.threads[0]]
    }
    if (operation === 'archive') h.state.threads[1] = { ...h.state.threads[1], archived: true }
    if (operation === 'disconnect') h.state.runtimeConnection = 'offline'
    h.changed(); await flush(); request.resolve(detail('background')); await flush()
    expect(getThreadSnapshot('background')).toBeNull()
  })

  it('reloads the current generation after disconnect and ignores the old response', async () => {
    const old = deferred<ThreadDetail>()
    const read = vi.fn(async (id: string) => detail(id)).mockImplementationOnce(() => old.promise)
    const h = setup(undefined, read)
    await flush()
    h.state.runtimeConnection = 'offline'; h.changed(); await flush()
    h.state.runtimeConnection = 'ready'; h.changed(); await flush()
    old.resolve({ ...detail('background'), latestSeq: 1 }); await flush()
    expect(getThreadSnapshot('background')?.lastSeq).toBe(8)
    expect(read).toHaveBeenCalledTimes(2)
  })

  it('accepts progress in the same running turn without claiming newer metadata was synchronized', async () => {
    const first = deferred<ThreadDetail>()
    const read = vi.fn(async (id: string) => detail(id)).mockImplementationOnce(() => first.promise)
    const h = setup(undefined, read); await flush()
    h.state.threads[1] = { ...h.state.threads[1], latestSeq: 30 }
    h.changed(); await flush()
    first.resolve(detail('background')); await flush()
    expect(getThreadSnapshot('background')?.lastSeq).toBe(8)
    await vi.advanceTimersByTimeAsync(2_000)
    expect(read).toHaveBeenCalledTimes(2)
  })

  it.each(['completed', 'new-turn'] as const)('rejects old-turn data when metadata becomes %s', async (change) => {
    const first = deferred<ThreadDetail>()
    const h = setup(undefined, vi.fn(() => first.promise)); await flush()
    h.state.threads[1] = change === 'completed' ? thread('background', false)
      : { ...thread('background'), latestTurnId: 'another-turn' }
    h.changed(); await flush(); first.resolve(detail('background')); await flush()
    expect(getThreadSnapshot('background')).toBeNull()
  })

  it('does not mistake sidebar pagination for deletion of a recent running owner', async () => {
    const request = deferred<ThreadDetail>()
    const h = setup(undefined, vi.fn(() => request.promise)); await flush()
    h.state.threads = [h.state.threads[0]]; h.changed(); await flush()
    request.resolve(detail('background')); await flush()
    expect(getThreadSnapshot('background')?.liveAssistant).toBe('Already accumulated')
  })

  it('retains a paged-out owner when another writer commits a newer cache snapshot', async () => {
    const h = setup(); await flush()
    h.state.threads = [h.state.threads[0]]
    cacheThreadSnapshot(buildPrefetchedThreadSnapshot(thread('background'),
      { ...detail('background'), latestSeq: 100 }, { allowRunning: true })!)
    h.changed(); await vi.advanceTimersByTimeAsync(BACKGROUND_THREAD_SYNC_HEARTBEAT_MS + 2_000)
    expect(h.read).toHaveBeenCalledTimes(2)
  })

  it('does not replace a newly parked projection after selecting away and back in one tick', async () => {
    const request = deferred<ThreadDetail>()
    const h = setup(undefined, vi.fn(() => request.promise)); await flush()
    h.state.activeThreadId = 'background'; h.changed()
    h.state.activeThreadId = 'active'; h.changed()
    cacheThreadSnapshot(buildPrefetchedThreadSnapshot(h.state.threads[1],
      { ...detail('background'), latestSeq: 100 }, { allowRunning: true })!)
    request.resolve(detail('background')); await flush()
    expect(getThreadSnapshot('background')?.lastSeq).toBe(100)
  })

  it('cannot overwrite another coordinator\'s newer commit with a slower response', async () => {
    const old = deferred<ThreadDetail>()
    const h = setup(undefined, vi.fn(() => old.promise)); await flush()
    const stopSecond = createBackgroundThreadSync({ getState: () => h.state, subscribe: () => () => undefined,
      getProvider: () => ({ getThreadDetail: async (id) => ({ ...detail(id), latestSeq: 100 }) }) })
    try {
      await flush(); old.resolve(detail('background')); await flush()
      expect(getThreadSnapshot('background')?.lastSeq).toBe(100)
    } finally { stopSecond() }
  })

  it('fences history-setting changes before an old response can be cached', async () => {
    const request = deferred<ThreadDetail>()
    const read = vi.fn(async (id: string) => detail(id)).mockImplementationOnce(() => request.promise)
    const h = setup(undefined, read); await flush()
    useCodexReferenceState.setState((state) => ({ revision: state.revision + 1 }))
    h.changed(); await flush()
    request.resolve({ ...detail('background'), latestSeq: 1 }); await flush()
    expect(getThreadSnapshot('background')?.lastSeq).toBe(8)
  })

  it('retires an unavailable server thread without retrying on every heartbeat', async () => {
    const read = vi.fn(async (): Promise<ThreadDetail> => { throw new Error('{"code":"not_found","message":"thread missing"}') })
    setup(undefined, read); await flush()
    await vi.advanceTimersByTimeAsync(60_000)
    expect(read).toHaveBeenCalledTimes(1)
    expect(getThreadSnapshot('background')).toBeNull()
  })

  it('preserves a zero replay floor and pending user interactions in cached data', async () => {
    const read = vi.fn(async (id: string): Promise<ThreadDetail> => ({ ...detail(id), latestSeq: 0,
      blocks: [{ kind: 'user_input', id: 'ask', requestId: 'ask', questions: [], status: 'pending', live: true }] }))
    setup(undefined, read); await flush()
    expect(getThreadSnapshot('background')).toMatchObject({ lastSeq: 0, liveDeltaSeqFloor: 0,
      blocks: [expect.objectContaining({ requestId: 'ask', live: true, status: 'pending' })] })
  })

  it('backs off failures and stops every timer and in-flight commit on cleanup', async () => {
    const read = vi.fn(async (): Promise<ThreadDetail> => { throw new Error('offline') })
    setup(undefined, read); await flush()
    await vi.advanceTimersByTimeAsync(14_000)
    expect(read).toHaveBeenCalledTimes(1)
    stop!(); stop = undefined
    await vi.advanceTimersByTimeAsync(30_000)
    expect(read).toHaveBeenCalledTimes(1)
  })
})
