import { describe, expect, it } from 'vitest'
import type { RuntimeProjectionAction } from '../agent/runtime-projection-actions'
import type { ChatState } from './chat-store-types'
import { reduceChatProjection } from './chat-projection-reducer'

const NOW = Date.parse('2026-07-11T00:00:00.000Z')
const context = {
  now: NOW,
  clearRecoveringError: (error: string | null) => error === 'recovering' ? null : error,
  goalTimelineText: (goal: ChatState['activeThreadGoal'], cleared?: boolean) =>
    cleared || !goal ? 'Goal cleared' : `Goal ${goal.status}: ${goal.objective}`,
  runtimeStatusText: () => 'Runtime status',
  runtimeErrorView: (event: { message: string; code?: string }) => ({
    summary: `Summary: ${event.message}`,
    message: event.message,
    ...(event.code ? { code: event.code } : {})
  }),
  upsertRuntimeError: (blocks: ChatState['blocks'], block: ChatState['blocks'][number]) => {
    const index = blocks.findIndex((candidate) => candidate.id === block.id)
    if (index < 0) return [...blocks, block]
    const next = [...blocks]
    next[index] = block
    return next
  },
  formatRuntimeError: (error: unknown) => error instanceof Error ? error.message : String(error),
  runtimeErrorDetail: () => '',
  isInterruptSettledError: () => false,
  settlePendingRuntimeWork: (blocks: ChatState['blocks']) => blocks,
  threadSnapshotLooksRunning: () => false
}

function state(): ChatState {
  return {
    activeThreadId: 'thread_1',
    blocks: [],
    liveReasoning: '',
    liveAssistant: '',
    threads: [{
      id: 'thread_1', title: 'Thread', updatedAt: '2026-07-10T00:00:00.000Z', model: 'model', mode: 'agent'
    }],
    usageRefreshKey: 0,
    error: 'recovering'
  } as unknown as ChatState
}

function project(
  initial: ChatState,
  actions: RuntimeProjectionAction[],
  reducerContext = context
): ChatState {
  return actions.reduce(
    (current, action) => ({ ...current, ...reduceChatProjection(current, action, reducerContext) }),
    initial
  )
}

describe('chat projection reducer', () => {
  it('does not reopen or duplicate an item delta already covered by the hydrated snapshot', () => {
    const assistant = {
      kind: 'assistant' as const,
      id: 'assistant_1',
      turnId: 'turn_1',
      text: 'Hydrated answer'
    }
    const initial = {
      ...state(),
      blocks: [assistant],
      busy: false,
      lastSeq: 200,
      liveDeltaSeqFloor: 200,
      liveAssistant: ''
    }

    const projected = project(initial, [{
      type: 'deltas_received',
      deltas: [{
        seq: 201,
        deltaOffset: 0,
        threadId: 'thread_1',
        turnId: 'turn_1',
        itemId: 'assistant_1',
        kind: 'agent_message',
        text: 'Hydrated answer'
      }]
    }])

    expect(projected.blocks).toBe(initial.blocks)
    expect(projected.liveAssistant).toBe('')
    expect(projected.liveAssistantItemId).toBeUndefined()
    expect(projected.busy).toBe(false)
    expect(projected.lastSeq).toBe(201)
    expect(projected.liveDeltaSeqFloor).toBe(201)
  })

  it('appends only the unseen suffix when an offset delta partially overlaps hydrated text', () => {
    const initial = {
      ...state(),
      blocks: [{
        kind: 'assistant' as const,
        id: 'assistant_1',
        turnId: 'turn_1',
        text: 'Hello '
      }],
      busy: false,
      lastSeq: 200,
      liveDeltaSeqFloor: 200,
      liveAssistant: ''
    }

    const projected = project(initial, [{
      type: 'deltas_received',
      deltas: [
        {
          seq: 201,
          deltaOffset: 4,
          threadId: 'thread_1',
          turnId: 'turn_1',
          itemId: 'assistant_1',
          kind: 'agent_message',
          text: 'o world'
        },
        {
          seq: 202,
          deltaOffset: 11,
          threadId: 'thread_1',
          turnId: 'turn_1',
          itemId: 'assistant_1',
          kind: 'agent_message',
          text: '!'
        }
      ]
    }])

    expect(projected.blocks).toEqual(initial.blocks)
    expect(projected.liveAssistant).toBe('world!')
    expect(projected.liveAssistantItemId).toBe('assistant_1')
    expect(projected.busy).toBe(true)
    expect(projected.lastSeq).toBe(202)
  })

  it('drops mismatched offset fragments instead of fail-open appending full text', () => {
    const initial = {
      ...state(),
      blocks: [{
        kind: 'assistant' as const,
        id: 'assistant_1',
        turnId: 'turn_1',
        text: 'Hello '
      }],
      busy: false,
      lastSeq: 200,
      liveDeltaSeqFloor: 200,
      liveAssistant: ''
    }

    const projected = project(initial, [{
      type: 'deltas_received',
      deltas: [{
        seq: 201,
        deltaOffset: 4,
        threadId: 'thread_1',
        turnId: 'turn_1',
        itemId: 'assistant_1',
        kind: 'agent_message',
        text: 'X world'
      }]
    }])

    expect(projected.liveAssistant).toBe('')
    expect(projected.blocks).toEqual(initial.blocks)
  })

  it('suppresses legacy no-offset full-text redelivery already present in the hydrated block', () => {
    const initial = {
      ...state(),
      blocks: [{
        kind: 'assistant' as const,
        id: 'assistant_1',
        turnId: 'turn_1',
        text: 'Hydrated answer'
      }],
      busy: false,
      lastSeq: 200,
      liveDeltaSeqFloor: 200,
      liveAssistant: ''
    }

    const projected = project(initial, [{
      type: 'deltas_received',
      deltas: [{
        seq: 201,
        threadId: 'thread_1',
        turnId: 'turn_1',
        itemId: 'assistant_1',
        kind: 'agent_message',
        text: 'Hydrated answer'
      }]
    }])

    expect(projected.liveAssistant).toBe('')
    expect(projected.blocks).toEqual(initial.blocks)
  })

  it('does not concatenate a full final reply when redelivered at the live tip offset', () => {
    const answer = '可视化辅助选项：1. 图表 2. 表格'
    const initial = {
      ...state(),
      blocks: [],
      busy: true,
      lastSeq: 200,
      liveDeltaSeqFloor: 200,
      liveAssistant: answer,
      liveAssistantItemId: 'assistant_1',
      liveAssistantTurnId: 'turn_1'
    }

    const projected = project(initial, [{
      type: 'deltas_received',
      deltas: [
        {
          seq: 201,
          deltaOffset: answer.length,
          threadId: 'thread_1',
          turnId: 'turn_1',
          itemId: 'assistant_1',
          kind: 'agent_message',
          text: answer
        },
        {
          seq: 202,
          deltaOffset: answer.length,
          threadId: 'thread_1',
          turnId: 'turn_1',
          itemId: 'assistant_1',
          kind: 'agent_message',
          text: answer
        },
        {
          seq: 203,
          deltaOffset: answer.length,
          threadId: 'thread_1',
          turnId: 'turn_1',
          itemId: 'assistant_1',
          kind: 'agent_message',
          text: answer
        }
      ]
    }])

    expect(projected.liveAssistant).toBe(answer)
  })

  it('extends cumulative snapshot deltas with only the unseen suffix', () => {
    const initial = {
      ...state(),
      blocks: [],
      busy: true,
      lastSeq: 200,
      liveDeltaSeqFloor: 200,
      liveAssistant: 'Hello',
      liveAssistantItemId: 'assistant_1',
      liveAssistantTurnId: 'turn_1'
    }

    const projected = project(initial, [{
      type: 'deltas_received',
      deltas: [{
        seq: 201,
        deltaOffset: 5,
        threadId: 'thread_1',
        turnId: 'turn_1',
        itemId: 'assistant_1',
        kind: 'agent_message',
        text: 'Hello world'
      }]
    }])

    expect(projected.liveAssistant).toBe('Hello world')
  })

  it('keeps legacy no-offset deltas appending genuinely new text', () => {
    const initial = {
      ...state(),
      blocks: [{
        kind: 'assistant' as const,
        id: 'assistant_1',
        turnId: 'turn_1',
        text: 'Hello'
      }],
      busy: false,
      lastSeq: 200,
      liveDeltaSeqFloor: 200,
      liveAssistant: ''
    }

    const projected = project(initial, [{
      type: 'deltas_received',
      deltas: [{
        seq: 201,
        threadId: 'thread_1',
        turnId: 'turn_1',
        itemId: 'assistant_1',
        kind: 'agent_message',
        text: ' world'
      }]
    }])

    expect(projected.liveAssistant).toBe(' world')
    expect(projected.liveAssistantItemId).toBe('assistant_1')
    expect(projected.busy).toBe(true)
  })

  it('discards a foreign live buffer instead of materializing another thread turn', () => {
    const projected = project({
      ...state(),
      busy: true,
      currentTurnId: 'turn_b',
      lastSeq: 20,
      liveDeltaSeqFloor: 20,
      liveAssistant: 'Stale answer from A',
      liveAssistantItemId: 'assistant_a',
      liveAssistantTurnId: 'turn_a',
      liveAssistantCreatedAt: '2026-07-10T23:59:00.000Z',
      blocks: [{ kind: 'user', id: 'user_b', turnId: 'turn_b', text: 'Continue B' }]
    }, [{
      type: 'deltas_received',
      deltas: [{
        seq: 21,
        threadId: 'thread_1',
        turnId: 'turn_b',
        itemId: 'assistant_b',
        kind: 'agent_message',
        text: 'Fresh answer from B'
      }]
    }])

    expect(projected.blocks).toEqual([
      { kind: 'user', id: 'user_b', turnId: 'turn_b', text: 'Continue B' }
    ])
    expect(projected.liveAssistant).toBe('Fresh answer from B')
    expect(projected.liveAssistantItemId).toBe('assistant_b')
    expect(projected.liveAssistantTurnId).toBe('turn_b')
    expect(projected.blocks.some((block) => block.turnId === 'turn_a')).toBe(false)
  })

  it('does not settle a newer running turn when a terminal snapshot for an older turn is reconciled', () => {
    const projected = project({
      ...state(),
      busy: true,
      currentTurnId: 'turn_B',
      currentTurnUserId: 'user_B',
      liveAssistant: 'still streaming',
      blocks: [
        { kind: 'user', id: 'user_B', turnId: 'turn_B', text: 'keep going' },
        { kind: 'assistant', id: 'assistant_B', turnId: 'turn_B', text: 'streaming' }
      ],
      threads: [{
        ...state().threads[0]!,
        status: 'running',
        latestTurnId: 'turn_B',
        latestTurnStatus: 'running'
      }]
    }, [{
      type: 'thread_snapshot_reconciled',
      payload: {
        threadId: 'thread_1',
        turnId: 'turn_A',
        userBlockId: 'user_A',
        blocks: [{ kind: 'assistant', id: 'assistant_A', turnId: 'turn_A', text: 'old done' }],
        latestSeq: 12,
        threadStatus: 'running',
        latestTurnId: 'turn_A',
        latestTurnStatus: 'completed'
      }
    }])

    expect(projected.threads[0]).toMatchObject({
      status: 'running',
      latestTurnId: 'turn_B',
      latestTurnStatus: 'running'
    })
    // The newer turn B's live text and blocks are untouched.
    expect(projected.blocks).toContainEqual(
      expect.objectContaining({ id: 'assistant_B', turnId: 'turn_B', text: 'streaming' })
    )
    expect(projected.liveAssistant).toBe('still streaming')
  })

  it('keeps terminal latest-turn evidence authoritative during snapshot reconciliation', () => {
    const projected = project({
      ...state(),
      busy: false,
      currentTurnId: null,
      threads: [{ ...state().threads[0]!, status: 'running' }]
    }, [{
      type: 'thread_snapshot_reconciled',
      payload: {
        threadId: 'thread_1',
        blocks: [{ kind: 'assistant', id: 'assistant_done', text: 'done' }],
        latestSeq: 9,
        threadStatus: 'running',
        latestTurnId: 'turn_done',
        latestTurnStatus: 'completed'
      }
    }])

    expect(projected.busy).toBe(false)
    expect(projected.threads[0]).toMatchObject({
      status: 'idle', latestTurnId: 'turn_done', latestTurnStatus: 'completed'
    })
  })

  it('preserves an unchanged assistant block reference during terminal snapshot reconciliation', () => {
    const assistant = {
      kind: 'assistant' as const,
      id: 'assistant_1',
      turnId: 'turn_1',
      createdAt: '2026-07-11T00:00:00.000Z',
      text: 'Stable markdown'
    }
    const initial = {
      ...state(),
      busy: false,
      currentTurnId: null,
      lastSeq: 4,
      blocks: [
        { kind: 'user' as const, id: 'user_1', turnId: 'turn_1', text: 'Question' },
        assistant
      ]
    }
    const projected = project(initial, [{
      type: 'thread_snapshot_reconciled',
      payload: {
        threadId: 'thread_1',
        turnId: 'turn_1',
        userBlockId: 'user_1',
        latestSeq: 8,
        blocks: [
          { kind: 'user', id: 'user_1', turnId: 'turn_1', text: 'Question' },
          { ...assistant }
        ]
      }
    }])

    expect(projected.blocks.find((block) => block.id === 'assistant_1')).toBe(assistant)
  })

  it('replaces a flushed synthetic assistant projection with its durable item', () => {
    const projected = project({
      ...state(),
      busy: true,
      currentTurnId: 'turn_1',
      blocks: [{
        kind: 'assistant' as const,
        id: 'a-123',
        turnId: 'turn_1',
        text: 'The answer is ready.'
      }]
    }, [{
      type: 'assistant_item_upserted',
      payload: {
        itemId: 'item_answer',
        threadId: 'thread_1',
        turnId: 'turn_1',
        kind: 'agent_message',
        status: 'completed',
        createdAt: '2026-07-11T00:00:00.000Z',
        text: 'The answer is ready.'
      }
    }])

    expect(projected.blocks).toEqual([{
      kind: 'assistant',
      id: 'item_answer',
      turnId: 'turn_1',
      createdAt: '2026-07-11T00:00:00.000Z',
      text: 'The answer is ready.'
    }])
  })

  it('deduplicates repeated assistant snapshots while reconciling an active turn', () => {
    const projected = project({
      ...state(),
      busy: true,
      currentTurnId: 'turn_1',
      currentTurnUserId: 'user_1',
      blocks: [{ kind: 'user' as const, id: 'user_1', turnId: 'turn_1', text: 'Question' }]
    }, [{
      type: 'thread_snapshot_reconciled',
      payload: {
        threadId: 'thread_1',
        turnId: 'turn_1',
        userBlockId: 'user_1',
        latestSeq: 8,
        threadStatus: 'running',
        latestTurnId: 'turn_1',
        latestTurnStatus: 'running',
        blocks: [
          { kind: 'user', id: 'user_1', turnId: 'turn_1', text: 'Question' },
          { kind: 'assistant', id: 'assistant_1', turnId: 'turn_1', text: 'partial' },
          { kind: 'assistant', id: 'assistant_1', turnId: 'turn_1', text: 'complete' }
        ]
      }
    }], { ...context, threadSnapshotLooksRunning: () => true })

    expect(projected.blocks).toEqual([
      { kind: 'user', id: 'user_1', turnId: 'turn_1', text: 'Question' },
      { kind: 'assistant', id: 'assistant_1', turnId: 'turn_1', text: 'complete' }
    ])
    expect(projected.busy).toBe(true)
    expect(projected.currentTurnId).toBe('turn_1')
  })
})

describe('chat projection reducer usage timing metrics', () => {
  const usageSnapshot = (overrides: Record<string, unknown>) => ({
    inputTokens: 100,
    outputTokens: 50,
    reasoningTokens: 0,
    cachedTokens: 0,
    cacheMissTokens: 100,
    cacheHitRate: 0,
    totalTokens: 150,
    costUsd: 0,
    costCny: null,
    tokenEconomySavingsTokens: 0,
    turns: 1,
    avgTtftMs: null,
    avgTokensPerSecond: null,
    turnAvgTtftMs: null,
    turnAvgTokensPerSecond: null,
    ...overrides
  })

  it('stores per-turn averages keyed by the snapshot turnId', () => {
    const projected = project(state(), [
      {
        type: 'usage_received',
        payload: usageSnapshot({
          turnId: 'turn_1',
          turnAvgTtftMs: 1_000,
          turnAvgTokensPerSecond: 40.2,
          avgTtftMs: 1_200,
          avgTokensPerSecond: 38.5
        })
      }
    ])

    expect(projected.turnTimingMetrics.get('turn_1')).toEqual({
      avgTtftMs: 1_000,
      avgTokensPerSecond: 40.2
    })
  })

  it('clears per-turn metrics when a usage event belongs to a different thread', () => {
    const first = project(state(), [
      {
        type: 'usage_received',
        payload: usageSnapshot({ turnId: 'turn_1', turnAvgTtftMs: 800 })
      }
    ])
    const switched = project({ ...first, activeThreadId: 'thread_2' }, [
      {
        type: 'usage_received',
        payload: usageSnapshot({ turnId: 'turn_2', turnAvgTtftMs: 500 })
      }
    ])

    expect(switched.turnTimingMetrics.has('turn_1')).toBe(false)
    expect(switched.turnTimingMetrics.get('turn_2')).toEqual({
      avgTtftMs: 500,
      avgTokensPerSecond: null
    })
  })

  it('removes a turn entry when its snapshot has no timing data', () => {
    const first = project(state(), [
      {
        type: 'usage_received',
        payload: usageSnapshot({ turnId: 'turn_1', turnAvgTtftMs: 800 })
      }
    ])
    const cleared = project(first, [
      {
        type: 'usage_received',
        payload: usageSnapshot({ turnId: 'turn_1' })
      }
    ])

    expect(cleared.turnTimingMetrics.has('turn_1')).toBe(false)
  })

  it('clears per-turn metrics when the active thread changes', () => {
    const first = project(state(), [
      {
        type: 'usage_received',
        payload: usageSnapshot({ turnId: 'turn_1', turnAvgTtftMs: 800 })
      }
    ])
    const reconciled = project({ ...first, activeThreadId: 'thread_2' }, [
      {
        type: 'thread_snapshot_reconciled',
        payload: {
          threadId: 'thread_2',
          turnId: 'turn_2',
          userBlockId: 'user_2',
          latestSeq: 1,
          blocks: [
            { kind: 'user', id: 'user_2', turnId: 'turn_2', text: 'Hi' }
          ]
        }
      }
    ])

    expect(reconciled.turnTimingMetrics.size).toBe(0)
  })
})
