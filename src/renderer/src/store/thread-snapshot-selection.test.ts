import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { NormalizedThread, ThreadDetail, ThreadEventSink } from '../agent/types'
import type { ChatState, ChatStoreGet, ChatStoreSet } from './chat-store-types'
import { buildPrefetchedThreadSnapshot, cacheThreadSnapshot, clearThreadSnapshotCache } from './thread-snapshot-cache'
import { createInitialChatStoreState } from './chat-store-initial-state'

const registry = vi.hoisted(() => ({ getProvider: vi.fn() }))
vi.mock('../agent/registry', () => ({ getProvider: registry.getProvider }))
import { createThreadActions } from './chat-store-thread-actions'

function deferred<T>() {
  let resolve!: (value: T) => void
  let reject!: (error: Error) => void
  const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no })
  return { promise, resolve, reject }
}
function thread(id: string, seq = 1): NormalizedThread {
  return { id, title: id, workspace: '/workspace', mode: 'agent', model: 'model',
    updatedAt: '2026-10-11T00:00:00Z', status: 'running', latestSeq: seq,
    latestTurnId: `${id}-turn`, latestTurnStatus: 'running' }
}
function detail(id: string, seq: number, text = 'Fresh cumulative text'): ThreadDetail {
  return { blocks: [{ kind: 'user', id: `${id}-user`, text: 'Continue' }], latestSeq: seq,
    activeTurn: { id: `${id}-turn`, status: 'running', orchestration: 'direct' },
    latestTurnId: `${id}-turn`, latestTurnStatus: 'running', threadStatus: 'running',
    liveProjection: { assistant: { text, itemId: `${id}-answer`, turnId: `${id}-turn` } } }
}
function setup(seq = 1, cachedSeq = 1, capturedAt = Date.now()) {
  let state = { ...createInitialChatStoreState('workspace'), activeThreadId: 'a',
    runtimeConnection: 'ready', threads: [thread('a'), thread('b', seq), thread('c')],
    recoverActiveTurn: vi.fn(async () => false), refreshThreads: vi.fn(async () => undefined)
  } as unknown as ChatState
  const set: ChatStoreSet = (patch) => { state = { ...state, ...(typeof patch === 'function' ? patch(state) : patch) } }
  const get: ChatStoreGet = () => state
  const sseAbortRef = { current: null as AbortController | null }
  const actions = createThreadActions({ set, get, sseAbortRef })
  state = { ...state, ...actions }
  cacheThreadSnapshot({ ...buildPrefetchedThreadSnapshot(state.threads[1], detail('b', cachedSeq, 'Old visible text'),
    { allowRunning: true })!, backgroundSyncedAt: capturedAt, capturedAt })
  return { get, set, actions, sseAbortRef }
}

describe('background checkpoint selection', () => {
  beforeEach(() => {
    vi.useFakeTimers(); vi.setSystemTime(new Date('2026-10-11T00:00:00Z')); clearThreadSnapshotCache()
    vi.stubGlobal('localStorage', { getItem: vi.fn(() => null), setItem: vi.fn(), removeItem: vi.fn() })
    registry.getProvider.mockReset()
  })
  afterEach(() => { clearThreadSnapshotCache(); vi.unstubAllGlobals(); vi.useRealTimers() })

  it('paints a stale cached projection immediately then replaces a large replay gap in one snapshot', async () => {
    const request = deferred<ThreadDetail>()
    const subscribeThreadEvents = vi.fn(async () => undefined)
    const getThreadDetail = vi.fn(() => request.promise)
    registry.getProvider.mockReturnValue({ getThreadDetail, subscribeThreadEvents })
    const h = setup(2_000, 10)
    const selecting = h.actions.selectThread('b')
    expect(h.get().activeThreadId).toBe('b')
    expect(h.get().liveAssistant).toBe('Old visible text')
    expect(h.get().threadLoadingId).toBe('b')
    expect(getThreadDetail).toHaveBeenCalledWith('b', expect.objectContaining({ priority: 'foreground' }))
    expect(subscribeThreadEvents).not.toHaveBeenCalled()
    request.resolve(detail('b', 1_995)); await selecting
    expect(h.get().liveAssistant).toBe('Fresh cumulative text')
    expect(h.get().lastSeq).toBe(1_995)
    expect(subscribeThreadEvents).toHaveBeenCalledWith('b', 1_995, expect.anything(), expect.anything())
  })

  it('refreshes an aged running projection even when sidebar metadata has not advanced', async () => {
    const getThreadDetail = vi.fn(async () => detail('b', 20))
    registry.getProvider.mockReturnValue({ getThreadDetail, subscribeThreadEvents: vi.fn(async () => undefined) })
    const h = setup(10, 10, Date.now() - 60_000)
    await h.actions.selectThread('b')
    expect(getThreadDetail).toHaveBeenCalledOnce()
    expect(h.get().liveAssistant).toBe('Fresh cumulative text')
  })

  it('uses a fresh background projection directly and preserves its safe zero replay floor', async () => {
    const getThreadDetail = vi.fn()
    const subscribeThreadEvents = vi.fn(async () => undefined)
    registry.getProvider.mockReturnValue({ getThreadDetail, subscribeThreadEvents })
    const h = setup(10, 0)
    await h.actions.selectThread('b')
    expect(getThreadDetail).not.toHaveBeenCalled()
    expect(subscribeThreadEvents).toHaveBeenCalledWith('b', 0, expect.anything(), expect.anything())
    expect(h.get().liveAssistant).toBe('Old visible text')
    expect(h.get().busyUnconfirmed).toBe(true)
  })

  it('keeps a zero server floor after replacing a large backlog', async () => {
    const subscribeThreadEvents = vi.fn(async () => undefined)
    registry.getProvider.mockReturnValue({ getThreadDetail: vi.fn(async () => detail('b', 0)), subscribeThreadEvents })
    const h = setup(1_000, 1)
    await h.actions.selectThread('b')
    expect(h.get().lastSeq).toBe(0)
    expect(subscribeThreadEvents).toHaveBeenCalledWith('b', 0, expect.anything(), expect.anything())
  })

  it('does not commit a replacement after selection moved to another conversation', async () => {
    const request = deferred<ThreadDetail>()
    const subscribeThreadEvents = vi.fn(async () => undefined)
    registry.getProvider.mockReturnValue({ getThreadDetail: vi.fn((id: string) => id === 'b' ? request.promise : Promise.resolve(detail(id, 5))), subscribeThreadEvents })
    const h = setup(1_000, 1)
    const oldSelection = h.actions.selectThread('b')
    await h.actions.selectThread('c')
    request.resolve(detail('b', 999)); await oldSelection
    expect(h.get().activeThreadId).toBe('c')
    expect(h.get().liveAssistantItemId).toBe('c-answer')
    expect(subscribeThreadEvents.mock.calls.map((call) => (call as unknown[])[0])).toEqual(['c'])
  })

  it('falls back to cursor-matched replay if snapshot refresh fails', async () => {
    let sink: ThreadEventSink | undefined
    const subscribeThreadEvents = vi.fn(async (_id, _seq, next) => { sink = next })
    registry.getProvider.mockReturnValue({ getThreadDetail: vi.fn(async () => { throw new Error('temporary failure') }), subscribeThreadEvents })
    const h = setup(1_000, 10)
    await h.actions.selectThread('b')
    expect(h.get().liveAssistant).toBe('Old visible text')
    expect(h.get().threadLoadingId).toBe('b')
    expect(subscribeThreadEvents).toHaveBeenCalledWith('b', 10, expect.anything(), expect.anything())
    sink!.onReplaySynchronized?.(1_000)
    expect(h.get().threadLoadingId).toBeNull()
  })
})
