import { describe, expect, it } from 'vitest'
import { runtimeProjectionActionsFromEvent } from '../agent/kun-mapper'
import type { CoreRuntimeEventJson } from '../agent/kun-contract'
import type { ChatState } from './chat-store-types'
import { reduceChatProjection, type ChatProjectionReducerContext } from './chat-projection-reducer'

const createdAt = '2026-10-24T09:40:51.000Z'
const startedAt = '2026-10-24T09:44:35.000Z'
const startedMs = Date.parse(startedAt)
const now = startedMs + 30_000
const context: ChatProjectionReducerContext = {
  now, clearRecoveringError: (error) => error, goalTimelineText: () => '',
  runtimeStatusText: () => '', runtimeErrorView: (event) => ({ summary: event.message, message: event.message }),
  upsertRuntimeError: (blocks) => blocks, formatRuntimeError: String, runtimeErrorDetail: () => '',
  isInterruptSettledError: () => false, settlePendingRuntimeWork: (blocks) => blocks,
  threadSnapshotLooksRunning: (_blocks, _thread, turn) => turn === 'running'
}

function state(): ChatState {
  return {
    activeThreadId: 'thread', threads: [{ id: 'thread' }], adeThreads: [],
    blocks: [], liveAssistant: '', liveReasoning: '', busy: false,
    currentTurnId: null, currentTurnUserId: null, currentTurnStartedAtMs: null,
    queuedMessages: [{ id: 'q-followup', text: 'Follow-up', deliveryState: 'in_flight',
      deliveryTurnId: 'queued', deliveryUserMessageItemId: 'queued-user' }],
    turnStartedAtByUserId: {}, turnDurationByUserId: {}, usageRefreshKey: 0,
    watchTurnCompletion: {}, unreadThreadIds: {}, error: null
  } as unknown as ChatState
}

function userEvent(extra: Partial<CoreRuntimeEventJson> = {}): CoreRuntimeEventJson {
  return {
    kind: 'item_created', seq: 4, threadId: 'thread', turnId: 'queued',
    timestamp: '2026-10-24T09:44:35.100Z', turnStartedAt: startedAt,
    item: { id: 'queued-user', kind: 'user_message', role: 'user', status: 'completed',
      threadId: 'thread', turnId: 'queued', createdAt, text: 'Follow-up' },
    ...extra
  }
}

function projectEvent(initial: ChatState, event = userEvent()): ChatState {
  return runtimeProjectionActionsFromEvent(event).reduce((current, action) => ({
    ...current, ...reduceChatProjection(current, action, context)
  }), initial)
}

describe('queued turn execution timing', () => {
  it('counts live and completed duration from execution start while preserving the message timestamp', () => {
    const running = projectEvent(state())
    expect(running.blocks[0]).toMatchObject({ id: 'queued-user', createdAt })
    expect(running.currentTurnStartedAtMs).toBe(startedMs)
    expect(running.turnStartedAtByUserId['queued-user']).toBe(startedMs)
    expect(now - running.turnStartedAtByUserId['queued-user']).toBe(30_000)
    expect(running.queuedMessages).toEqual([])
    const completed = { ...running, ...reduceChatProjection(running, {
      type: 'turn_completed', payload: { threadId: 'thread', turnId: 'queued', status: 'completed' }
    }, context) }
    expect(completed.turnDurationByUserId['queued-user']).toBe(30_000)
    expect(completed.busy).toBe(false)
  })

  it('uses the durable event timestamp when replaying a legacy promotion event', () => {
    const event = userEvent({ turnStartedAt: undefined })
    const running = projectEvent(state(), event)
    expect(running.turnStartedAtByUserId['queued-user']).toBe(Date.parse(event.timestamp!))
  })

  it('preserves an authoritative start more than thirty minutes before replay', () => {
    const longRunningStart = new Date(now - 60 * 60_000).toISOString()
    const running = projectEvent(state(), userEvent({ turnStartedAt: longRunningStart }))
    expect(running.currentTurnStartedAtMs).toBe(Date.parse(longRunningStart))
    expect(now - running.turnStartedAtByUserId['queued-user']).toBe(60 * 60_000)
  })

  it('does not restart the running timer when a user item is updated', () => {
    const running = projectEvent(state())
    const updated = projectEvent(running, userEvent({
      kind: 'item_updated', seq: 5, timestamp: new Date(now).toISOString(), turnStartedAt: undefined
    }))
    expect(updated.currentTurnStartedAtMs).toBe(startedMs)
    expect(updated.turnStartedAtByUserId['queued-user']).toBe(startedMs)
  })

  it('keeps guidance attached to the current turn without resetting its original timer', () => {
    const running = projectEvent(state())
    const event = userEvent({ seq: 5, timestamp: new Date(now).toISOString(), turnStartedAt: undefined })
    event.item = { ...event.item!, id: 'guided-user', text: 'Additional guidance', createdAt: new Date(now).toISOString() }
    const guided = projectEvent(running, event)
    expect(guided.currentTurnUserId).toBe('queued-user')
    expect(guided.currentTurnStartedAtMs).toBe(startedMs)
    expect(guided.turnStartedAtByUserId['queued-user']).toBe(startedMs)
  })

  it('corrects a stale live timer from the authoritative running snapshot', () => {
    const stale = projectEvent(state())
    stale.turnStartedAtByUserId['queued-user'] = Date.parse(createdAt)
    stale.currentTurnStartedAtMs = Date.parse(createdAt)
    const patch = reduceChatProjection(stale, {
      type: 'thread_snapshot_reconciled', payload: {
        threadId: 'thread', turnId: 'queued', userBlockId: 'queued-user', blocks: stale.blocks,
        latestSeq: 6, latestTurnId: 'queued', latestTurnStatus: 'running',
        threadStatus: 'running', latestTurnStartedAtMs: startedMs
      }
    }, context)
    expect(patch.currentTurnStartedAtMs).toBe(startedMs)
    expect(patch.turnStartedAtByUserId?.['queued-user']).toBe(startedMs)
  })
})
