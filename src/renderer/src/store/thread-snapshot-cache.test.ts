import { afterEach, describe, expect, it, vi } from 'vitest'
import type { NormalizedThread } from '../agent/types'
import type { ChatState } from './chat-store-types'
import {
  buildPrefetchedThreadSnapshot,
  cacheThreadSnapshot,
  captureThreadSnapshotCacheToken,
  clearThreadSnapshotCache,
  getThreadSnapshot,
  getThreadSnapshotForSelection,
  hydratedTurnTimingPatch,
  invalidateThreadSnapshot,
  snapshotThreadProjection,
  THREAD_SNAPSHOT_CACHE_MAX_BYTES,
  threadSnapshotFingerprint,
  threadSnapshotCacheStats
} from './thread-snapshot-cache'

function thread(id: string, overrides: Partial<NormalizedThread> = {}): NormalizedThread {
  return {
    id,
    title: id,
    updatedAt: '2026-08-23T00:00:00.000Z',
    model: 'deepseek-chat',
    mode: 'agent',
    status: 'idle',
    ...overrides
  }
}

function stateFor(threadId: string): ChatState {
  return {
    activeThreadId: threadId,
    threads: [thread(threadId)],
    threadLoadingId: null,
    blocks: [{ kind: 'assistant', id: `${threadId}-answer`, text: threadId }],
    lastSeq: 1,
    liveDeltaSeqFloor: 1,
    liveReasoning: '',
    liveAssistant: '',
    busy: false,
    busyUnconfirmed: false,
    currentTurnId: null,
    currentTurnOrchestration: null,
    currentTurnUserId: null,
    turnStartedAtByUserId: {},
    turnDurationByUserId: {},
    turnReasoningFirstAtByUserId: {},
    turnReasoningLastAtByUserId: {},
    activeThreadRelation: 'primary',
    activeThreadParentId: null,
    activeThreadGoal: null,
    activeThreadTodos: null,
    queuedMessages: [],
  } as unknown as ChatState
}

describe('thread snapshot cache', () => {
  afterEach(() => clearThreadSnapshotCache())

  it('keeps an LRU of six renderer projections', () => {
    for (let index = 0; index < 7; index += 1) {
      snapshotThreadProjection(stateFor(`thr_${index}`), 1)
    }

    const stats = threadSnapshotCacheStats()
    expect(stats.entries).toBe(6)
    expect(stats.bytes).toBeGreaterThan(6)
    expect(stats.bytes).toBeLessThan(THREAD_SNAPSHOT_CACHE_MAX_BYTES)
    expect(getThreadSnapshot('thr_0')).toBeNull()
    expect(getThreadSnapshot('thr_6')?.lastSeq).toBe(1)
  })

  it('does not retain one snapshot larger than the shared byte budget', () => {
    snapshotThreadProjection(stateFor('thr_large'), THREAD_SNAPSHOT_CACHE_MAX_BYTES + 1)

    expect(getThreadSnapshot('thr_large')).toBeNull()
    expect(threadSnapshotCacheStats()).toEqual({ entries: 0, bytes: 0 })
  })

  it('evicts a snapshot that grows beyond the budget after hydration', () => {
    const state = stateFor('thr_growing')
    snapshotThreadProjection(state, 1 * 1024 * 1024)
    expect(getThreadSnapshot('thr_growing')).not.toBeNull()

    state.blocks = [{
      kind: 'assistant',
      id: 'large-answer',
      text: 'x'.repeat(40 * 1024 * 1024)
    }]
    snapshotThreadProjection(state)

    expect(getThreadSnapshot('thr_growing')).toBeNull()
    expect(threadSnapshotCacheStats()).toEqual({ entries: 0, bytes: 0 })
  })

  it('accounts for budget-safe projection growth during LRU eviction', () => {
    const growing = stateFor('thr_growing')
    snapshotThreadProjection(growing, 1 * 1024 * 1024)
    const initialBytes = threadSnapshotCacheStats().bytes
    growing.blocks = [{
      kind: 'assistant',
      id: 'grown-answer',
      text: 'x'.repeat(12 * 1024 * 1024)
    }]
    snapshotThreadProjection(growing)
    expect(threadSnapshotCacheStats().bytes).toBeGreaterThan(initialBytes)

    for (const threadId of ['thr_second', 'thr_third']) {
      const state = stateFor(threadId)
      state.blocks = [{
        kind: 'assistant',
        id: `${threadId}-answer`,
        text: 'x'.repeat(11 * 1024 * 1024)
      }]
      snapshotThreadProjection(state, 1)
    }

    expect(getThreadSnapshot('thr_growing')).toBeNull()
    expect(threadSnapshotCacheStats().bytes).toBeLessThanOrEqual(THREAD_SNAPSHOT_CACHE_MAX_BYTES)
  })

  it('walks structured metadata without materializing object entry arrays', () => {
    const state = stateFor('thr_wide_meta')
    const meta = Object.fromEntries(
      Array.from({ length: 2_000 }, (_, index) => [`field_${index}`, index])
    )
    state.blocks = [{
      kind: 'tool',
      id: 'wide-tool',
      summary: 'wide metadata',
      status: 'success',
      meta
    }]
    const entries = vi.spyOn(Object, 'entries').mockImplementation(() => {
      throw new Error('Object.entries must not be used by snapshot estimation')
    })

    snapshotThreadProjection(state, 1)
    entries.mockRestore()

    expect(getThreadSnapshot('thr_wide_meta')).not.toBeNull()
  })

  it('rejects a snapshot when the authoritative thread fingerprint changes', () => {
    const state = stateFor('thr_changed')
    snapshotThreadProjection(state, 10)
    const changed = thread('thr_changed', {
      updatedAt: '2026-08-23T00:01:00.000Z',
      latestSeq: 2
    })

    expect(getThreadSnapshot('thr_changed', threadSnapshotFingerprint(changed))).toBeNull()
    expect(threadSnapshotCacheStats()).toEqual({ entries: 0, bytes: 0 })
  })

  it('resumes a live-confirmed running snapshot when the same turn advances', () => {
    const initial = thread('thr_running', {
      status: 'running',
      latestSeq: 10,
      latestTurnId: 'turn_running',
      latestTurnStatus: 'running'
    })
    const state = stateFor(initial.id)
    state.threads = [initial]
    state.lastSeq = 10
    state.liveDeltaSeqFloor = 10
    state.busy = true
    state.busyUnconfirmed = false
    state.currentTurnId = 'turn_running'
    snapshotThreadProjection(state, 10)

    const advanced = {
      ...initial,
      updatedAt: '2026-08-23T00:01:00.000Z',
      latestSeq: 14
    }
    const resumed = getThreadSnapshotForSelection(advanced)

    expect(resumed).toMatchObject({
      threadId: initial.id,
      lastSeq: 10,
      busy: true,
      busyUnconfirmed: false,
      currentTurnId: 'turn_running',
      fingerprint: threadSnapshotFingerprint(advanced)
    })
  })

  it('round-trips live buffers together with their runtime identity', () => {
    const state = stateFor('thr_live_identity')
    Object.assign(state, {
      busy: true,
      currentTurnId: 'turn_live',
      liveDeltaSeqFloor: 7,
      liveReasoning: 'Inspecting files',
      liveReasoningItemId: 'reasoning_live',
      liveReasoningTurnId: 'turn_live',
      liveReasoningCreatedAt: '2026-08-23T00:00:01.000Z',
      liveAssistant: 'Preparing the answer',
      liveAssistantItemId: 'assistant_live',
      liveAssistantTurnId: 'turn_live',
      liveAssistantCreatedAt: '2026-08-23T00:00:02.000Z'
    })

    snapshotThreadProjection(state, 10)

    expect(getThreadSnapshot(state.activeThreadId!)).toMatchObject({
      liveDeltaSeqFloor: 7,
      liveReasoning: 'Inspecting files',
      liveReasoningItemId: 'reasoning_live',
      liveReasoningTurnId: 'turn_live',
      liveReasoningCreatedAt: '2026-08-23T00:00:01.000Z',
      liveAssistant: 'Preparing the answer',
      liveAssistantItemId: 'assistant_live',
      liveAssistantTurnId: 'turn_live',
      liveAssistantCreatedAt: '2026-08-23T00:00:02.000Z'
    })
  })

  it('rejects a parked running projection with live text but no matching identity', () => {
    const state = stateFor('thr_incomplete_live')
    Object.assign(state, {
      busy: true,
      currentTurnId: 'turn_live',
      liveReasoning: 'Orphaned live text'
    })

    snapshotThreadProjection(state, 10)

    expect(getThreadSnapshot(state.activeThreadId!)).toBeNull()
    expect(threadSnapshotCacheStats()).toEqual({ entries: 0, bytes: 0 })
  })

  it('rejects drifted running snapshots without matching live evidence', () => {
    const initial = thread('thr_guarded', {
      status: 'running',
      latestSeq: 10,
      latestTurnId: 'turn_guarded',
      latestTurnStatus: 'running'
    })
    const cases: Array<{
      name: string
      state?: Partial<ChatState>
      target: NormalizedThread
    }> = [
      {
        name: 'unconfirmed',
        state: { busyUnconfirmed: true },
        target: { ...initial, updatedAt: '2026-08-23T00:01:00.000Z', latestSeq: 11 }
      },
      {
        name: 'changed turn',
        target: {
          ...initial,
          updatedAt: '2026-08-23T00:01:00.000Z',
          latestSeq: 11,
          latestTurnId: 'turn_new'
        }
      },
      {
        name: 'settled',
        target: {
          ...initial,
          updatedAt: '2026-08-23T00:01:00.000Z',
          status: 'idle',
          latestSeq: 11,
          latestTurnStatus: 'completed'
        }
      },
      {
        name: 'archived',
        target: {
          ...initial,
          updatedAt: '2026-08-23T00:01:00.000Z',
          status: 'archived',
          archived: true,
          latestSeq: 11
        }
      },
      {
        name: 'cursor regression',
        target: { ...initial, updatedAt: '2026-08-23T00:01:00.000Z', latestSeq: 9 }
      }
    ]

    for (const scenario of cases) {
      clearThreadSnapshotCache()
      const state = stateFor(initial.id)
      Object.assign(state, {
        threads: [initial],
        lastSeq: 10,
        liveDeltaSeqFloor: 10,
        busy: true,
        busyUnconfirmed: false,
        currentTurnId: 'turn_guarded'
      }, scenario.state)
      snapshotThreadProjection(state, 10)

      expect(getThreadSnapshotForSelection(scenario.target), scenario.name).toBeNull()
      expect(threadSnapshotCacheStats(), scenario.name).toEqual({ entries: 0, bytes: 0 })
    }
  })

  it('fences a late prewarm write after thread invalidation', () => {
    const target = thread('thr_late')
    const snapshot = buildPrefetchedThreadSnapshot(target, {
      blocks: [{ kind: 'assistant', id: 'answer', text: 'fresh' }],
      latestSeq: 1,
      threadStatus: 'idle',
      payloadBytes: 10
    })
    const token = captureThreadSnapshotCacheToken(target.id)
    invalidateThreadSnapshot(target.id)

    expect(snapshot).not.toBeNull()
    expect(cacheThreadSnapshot(snapshot!, token)).toBe(false)
    expect(getThreadSnapshot(target.id)).toBeNull()
  })

  it('builds click-ready settled snapshots but skips running details', () => {
    const target = thread('thr_ready')
    const settled = buildPrefetchedThreadSnapshot(target, {
      blocks: [{ kind: 'assistant', id: 'answer', text: 'ready' }],
      latestSeq: 3,
      threadStatus: 'idle',
      historyCursor: 'cursor-1',
      hasMoreHistory: true,
      payloadBytes: 42
    })
    const running = buildPrefetchedThreadSnapshot(target, {
      blocks: [{ kind: 'assistant', id: 'answer-running', text: '' }],
      latestSeq: 4,
      threadStatus: 'running',
      latestTurnStatus: 'running'
    })

    expect(settled).toMatchObject({
      threadId: target.id,
      lastSeq: 3,
      threadHistoryCursor: 'cursor-1',
      threadHasMoreHistory: true,
      busy: false,
      payloadBytes: 42
    })
    expect(running).toBeNull()
  })

  it('does not revive summary goal state when detail explicitly clears it', () => {
    const goal = {
      threadId: 'thr_canonical_null', objective: 'Old goal', status: 'active' as const,
      tokensUsed: 0, timeUsedSeconds: 1,
      createdAt: '2026-08-30T00:00:00.000Z', updatedAt: '2026-08-30T00:00:01.000Z'
    }
    const todos = {
      threadId: 'thr_canonical_null', items: [], updatedAt: '2026-08-30T00:00:01.000Z'
    }
    const target = thread('thr_canonical_null', { goal, todos })
    const snapshot = buildPrefetchedThreadSnapshot(target, {
      blocks: [], latestSeq: 2, threadStatus: 'idle', goal: null, todos: null
    })

    expect(snapshot?.activeThreadGoal).toBeNull()
    expect(snapshot?.activeThreadTodos).toBeNull()
  })

  it('falls back to summary goal state only when detail omits it', () => {
    const goal = {
      threadId: 'thr_legacy_omission', objective: 'Legacy goal', status: 'active' as const,
      tokensUsed: 0, timeUsedSeconds: 1,
      createdAt: '2026-08-30T00:00:00.000Z', updatedAt: '2026-08-30T00:00:01.000Z'
    }
    const todos = {
      threadId: 'thr_legacy_omission', items: [], updatedAt: '2026-08-30T00:00:01.000Z'
    }
    const target = thread('thr_legacy_omission', { goal, todos })
    const snapshot = buildPrefetchedThreadSnapshot(target, {
      blocks: [], latestSeq: 2, threadStatus: 'idle'
    })

    expect(snapshot?.activeThreadGoal).toBe(goal)
    expect(snapshot?.activeThreadTodos).toBe(todos)
  })
})

describe('hydratedTurnTimingPatch', () => {
  const base = {
    latestTurnId: 'turn_1',
    latestTurnOrchestration: 'direct' as const,
    currentTurnUserId: 'user_1',
    latestTurnStartedAtMs: 42_000,
    turnDurationByUserId: { user_old: 1_000 }
  }

  it('re-seeds the running turn start from the persisted record', () => {
    const patch = hydratedTurnTimingPatch({ ...base, busy: true })

    expect(patch.currentTurnUserId).toBe('user_1')
    expect(patch.currentTurnStartedAtMs).toBe(42_000)
    expect(patch.turnStartedAtByUserId).toEqual({ user_1: 42_000 })
    expect(patch.turnDurationByUserId).toEqual({ user_old: 1_000 })
  })

  it('keeps per-user starts empty for settled threads', () => {
    const patch = hydratedTurnTimingPatch({ ...base, busy: false })

    expect(patch.currentTurnStartedAtMs).toBeNull()
    expect(patch.turnStartedAtByUserId).toEqual({})
  })

  it('keeps per-user starts empty when the persisted turn start is unknown', () => {
    const patch = hydratedTurnTimingPatch({
      ...base,
      busy: true,
      latestTurnStartedAtMs: undefined
    })

    expect(patch.currentTurnStartedAtMs).toBeNull()
    expect(patch.turnStartedAtByUserId).toEqual({})
  })
})
