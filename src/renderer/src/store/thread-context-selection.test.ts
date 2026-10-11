import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { RequestContextSnapshot, ThreadDetail } from '../agent/types'
import type { ChatState, ChatStoreGet, ChatStoreSet } from './chat-store-types'
import { createInitialChatStoreState } from './chat-store-initial-state'
import { clearThreadSnapshotCache, buildPrefetchedThreadSnapshot } from './thread-snapshot-cache'
import { restoredThreadContextSnapshot } from './thread-context-snapshot'

const provider = vi.hoisted(() => ({ getThreadDetail: vi.fn(), subscribeThreadEvents: vi.fn(async () => undefined) }))
vi.mock('../agent/registry', () => ({ getProvider: () => provider }))
import { createThreadActions } from './chat-store-thread-actions'

const context = (threadId: string, tokens: number): RequestContextSnapshot => ({ threadId, model: 'codex',
  stepIndex: 0, contextWindowTokens: 100_000, softThresholdTokens: 95_000, hardThresholdTokens: 99_000,
  estimatedInputTokens: tokens, breakdown: { tools: 0, system: 0, skills: 0, messages: tokens, other: 0 },
  toolCount: 0, activeSkillIds: [], occupancySource: 'agent', contextManagement: 'sdk-managed' })
function detail(id: string, snapshot: RequestContextSnapshot | null): ThreadDetail {
  return { blocks: [{ kind: 'assistant', id: `${id}-answer`, text: id }], latestSeq: 10,
    activeTurn: null, threadStatus: 'idle', contextSnapshot: snapshot }
}
function setup() {
  let state = { ...createInitialChatStoreState('workspace'), activeThreadId: 'a', runtimeConnection: 'ready',
    threads: ['a', 'b', 'c'].map(id => ({ id, title: id, model: 'codex', mode: 'agent', workspace: '/workspace',
      updatedAt: '2026-10-11T00:00:00Z', status: 'idle', latestSeq: 10 })),
    blocks: detail('a', null).blocks, lastSeq: 10, lastContextSnapshot: context('a', 19_000),
    recoverActiveTurn: vi.fn(async () => false), refreshThreads: vi.fn(async () => undefined)
  } as unknown as ChatState
  const set: ChatStoreSet = patch => { state = { ...state, ...(typeof patch === 'function' ? patch(state) : patch) } }
  const get: ChatStoreGet = () => state
  const actions = createThreadActions({ set, get, sseAbortRef: { current: null } })
  state = { ...state, ...actions }
  return { get, actions }
}
beforeEach(() => {
  vi.useFakeTimers(); clearThreadSnapshotCache(); provider.getThreadDetail.mockReset()
  vi.stubGlobal('localStorage', { getItem: () => null, setItem: vi.fn(), removeItem: vi.fn() })
  provider.getThreadDetail.mockImplementation(async id => detail(id, id === 'c' ? null : context(id, id === 'a' ? 19_000 : 7_000)))
})
afterEach(() => { clearThreadSnapshotCache(); vi.unstubAllGlobals(); vi.useRealTimers() })

describe('context occupancy across conversation selection', () => {
  it('restores A after B reports a different context, without a new model request or detail fetch', async () => {
    const h = setup()
    await h.actions.selectThread('b')
    expect(h.get().lastContextSnapshot).toEqual(context('b', 7_000))
    await h.actions.selectThread('a')
    expect(h.get().lastContextSnapshot).toEqual(context('a', 19_000))
    expect(provider.getThreadDetail).toHaveBeenCalledTimes(1)
  })
  it('restores telemetry after cache eviction and clears it for a conversation without data', async () => {
    const h = setup()
    await h.actions.selectThread('b'); clearThreadSnapshotCache()
    await h.actions.selectThread('a')
    expect(h.get().lastContextSnapshot).toEqual(context('a', 19_000))
    await h.actions.selectThread('c')
    expect(h.get().lastContextSnapshot).toBeNull()
  })
  it('does not let a slow previous selection replace the active conversation context', async () => {
    let resolve!: (value: ThreadDetail) => void
    provider.getThreadDetail.mockImplementationOnce(() => new Promise<ThreadDetail>(done => { resolve = done }))
    const h = setup()
    const pending = h.actions.selectThread('b')
    expect(h.get().lastContextSnapshot).toBeNull()
    await h.actions.selectThread('c')
    resolve(detail('b', context('b', 7_000))); await pending
    expect(h.get().activeThreadId).toBe('c')
    expect(h.get().lastContextSnapshot).toBeNull()
  })
  it('keeps telemetry in a background prewarm and refuses cross-thread legacy fallbacks', () => {
    const h = setup()
    expect(buildPrefetchedThreadSnapshot(h.get().threads[1], detail('b', context('b', 7_000)))?.contextSnapshot).toEqual(context('b', 7_000))
    expect(restoredThreadContextSnapshot('b', undefined, context('a', 19_000))).toBeNull()
    expect(restoredThreadContextSnapshot('a', undefined, context('a', 19_000))).toEqual(context('a', 19_000))
    expect(restoredThreadContextSnapshot('a', null, context('a', 19_000))).toBeNull()
  })
})
