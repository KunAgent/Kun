import { describe, expect, it, vi } from 'vitest'
import { InMemoryThreadStore } from '../adapters/in-memory-thread-store.js'
import { createThreadRecord } from '../domain/thread.js'
import { createTurnRecord } from '../domain/turn.js'
import { makeToolResultItem } from '../domain/item.js'
import type { RuntimeEventRecorder } from '../services/runtime-event-recorder.js'
import type { TurnService } from '../services/turn-service.js'
import { GoalTurnCoordinator } from './goal-turn-coordinator.js'

const threadId = 'thread_goal_turn_coordinator'
const turnId = 'turn_goal_turn_coordinator'

function activeThread() {
  const createdAt = '2026-07-11T00:00:00.000Z'
  return {
    ...createThreadRecord({
      id: threadId,
      title: 'goal',
      workspace: '/workspace',
      model: 'model',
      createdAt,
      goal: {
        threadId,
        objective: 'finish the work',
        status: 'active' as const,
        tokenBudget: 10,
        tokensUsed: 0,
        timeUsedSeconds: 0,
        createdAt,
        updatedAt: createdAt
      }
    }),
    turns: [createTurnRecord({
      id: turnId,
      threadId,
      prompt: 'work',
      clientSurface: 'tui',
      status: 'completed',
      createdAt
    })]
  }
}

function harness() {
  const threadStore = new InMemoryThreadStore()
  const eventDrafts: Array<{ kind?: string; goal?: { status?: string; tokensUsed?: number; timeUsedSeconds?: number } }> = []
  const events = {
    record: vi.fn(async (draft: typeof eventDrafts[number]) => {
      eventDrafts.push(draft)
      return draft
    })
  } as unknown as Pick<RuntimeEventRecorder, 'record'>
  let nowMs = 1_000
  let nowSequence = 0
  const timers: Array<{ fn: () => void; cancelled: boolean }> = []
  const startTurn = vi.fn(async () => ({
    threadId,
    turnId: 'turn_resumed',
    userMessageItemId: 'item_resumed'
  }))
  const runTurn = vi.fn(async () => 'completed' as const)
  const finishTurn = vi.fn(async () => ({ kind: 'settled', status: 'failed' as const }))
  const coordinator = new GoalTurnCoordinator({
    threadStore,
    turns: { startTurn, finishTurn } as unknown as Pick<TurnService, 'startTurn' | 'finishTurn'>,
    events,
    nowIso: () => `2026-07-11T00:00:0${nowSequence++}.000Z`,
    nowMs: () => nowMs,
    runTurn,
    goalResume: {
      setTimer: (fn) => {
        const timer = { fn, cancelled: false }
        timers.push(timer)
        return { cancel: () => { timer.cancelled = true } }
      }
    }
  })
  return {
    coordinator,
    threadStore,
    eventDrafts,
    timers,
    startTurn,
    runTurn,
    finishTurn,
    setNowMs: (value: number) => { nowMs = value }
  }
}

describe('GoalTurnCoordinator', () => {
  it('accounts elapsed time after the durable terminal outcome', async () => {
    const h = harness()
    await h.threadStore.upsert(activeThread())
    const timer = await h.coordinator.begin(threadId)
    h.setNowMs(4_500)

    await h.coordinator.afterTerminal({
      threadId,
      turnId,
      finalStatus: 'aborted',
      timer
    })

    expect((await h.threadStore.get(threadId))?.goal?.timeUsedSeconds).toBe(3)
    expect(h.eventDrafts).toEqual([
      expect.objectContaining({ kind: 'goal_updated', goal: expect.objectContaining({ timeUsedSeconds: 3 }) })
    ])
    expect(h.timers.filter((entry) => !entry.cancelled)).toHaveLength(0)
  })

  it('does not charge elapsed time to a goal replaced during the turn', async () => {
    const h = harness()
    const thread = activeThread()
    await h.threadStore.upsert(thread)
    const timer = await h.coordinator.begin(threadId)
    await h.threadStore.upsert({
      ...thread,
      goal: thread.goal ? { ...thread.goal, objective: 'replacement goal' } : undefined
    })
    h.setNowMs(8_000)

    await h.coordinator.afterTerminal({
      threadId,
      turnId,
      finalStatus: 'aborted',
      timer
    })

    expect((await h.threadStore.get(threadId))?.goal).toMatchObject({
      objective: 'replacement goal',
      timeUsedSeconds: 0
    })
    expect(h.eventDrafts).toEqual([])
  })

  it('accounts a graceful suspension slice without scheduling terminal resume', async () => {
    const h = harness()
    await h.threadStore.upsert(activeThread())
    const timer = await h.coordinator.begin(threadId)
    h.setNowMs(5_900)

    await h.coordinator.afterSuspended(threadId, timer)

    expect((await h.threadStore.get(threadId))?.goal?.timeUsedSeconds).toBe(4)
    expect(h.eventDrafts).toEqual([
      expect.objectContaining({
        kind: 'goal_updated',
        goal: expect.objectContaining({ timeUsedSeconds: 4 })
      })
    ])
    expect(h.timers.filter((entry) => !entry.cancelled)).toHaveLength(0)
  })

  it('records token usage and moves an exhausted active goal to usageLimited', async () => {
    const h = harness()
    await h.threadStore.upsert(activeThread())

    await h.coordinator.recordUsage(threadId, 6.9)
    await h.coordinator.recordUsage(threadId, 4)

    expect((await h.threadStore.get(threadId))?.goal).toMatchObject({
      tokensUsed: 10,
      status: 'usageLimited'
    })
    expect(h.eventDrafts.map((event) => event.goal?.status)).toEqual(['active', 'usageLimited'])
  })

  it('consumes progress and deliberate-stop state before cleanup', async () => {
    const progressing = harness()
    await progressing.threadStore.upsert(activeThread())
    progressing.coordinator.noteToolExecuted(turnId, 'write', {
      item: makeToolResultItem({
        id: 'item_success', threadId, turnId, callId: 'call_success', toolName: 'write', output: {}
      }),
      approved: true
    })
    await progressing.coordinator.afterTerminal({
      threadId,
      turnId,
      finalStatus: 'completed',
      timer: null
    })
    expect(progressing.timers.filter((entry) => !entry.cancelled)).toHaveLength(1)
    progressing.timers.find((entry) => !entry.cancelled)?.fn()
    await vi.waitFor(() => {
      expect(progressing.startTurn).toHaveBeenCalledWith(expect.objectContaining({
        threadId,
        request: expect.objectContaining({ clientSurface: 'tui' })
      }))
    })

    const suppressed = harness()
    await suppressed.threadStore.upsert(activeThread())
    suppressed.coordinator.suppressResume(turnId)
    await suppressed.coordinator.afterTerminal({
      threadId,
      turnId,
      finalStatus: 'completed',
      timer: null
    })
    expect(suppressed.timers.filter((entry) => !entry.cancelled)).toHaveLength(0)
  })

  it('does not count failed tool results or goal bookkeeping as progress', () => {
    const h = harness()
    h.coordinator.noteToolExecuted(turnId, 'write', {
      item: makeToolResultItem({
        id: 'item_failed', threadId, turnId, callId: 'call_failed', toolName: 'write',
        output: { error: 'failed' }, isError: true
      }),
      approved: false
    })
    h.coordinator.noteToolExecuted(turnId, 'get_goal', {
      item: makeToolResultItem({
        id: 'item_goal', threadId, turnId, callId: 'call_goal', toolName: 'get_goal', output: {}
      }),
      approved: true
    })
    expect(h.coordinator.hasMadeProgress(turnId)).toBe(false)
  })

  it('resumes a restarted goal only while the same failed turn remains latest', async () => {
    const h = harness()
    const failed = activeThread()
    failed.turns = [{ ...failed.turns[0]!, status: 'failed' }]
    await h.threadStore.upsert(failed)

    await expect(h.coordinator.resumeInterruptedGoals([{ threadId, turnId }])).resolves.toBe(1)
    expect(h.startTurn).toHaveBeenCalledOnce()
    expect(h.startTurn).toHaveBeenCalledWith(
      expect.objectContaining({ threadId }),
      { expectedLatestFailedTurnId: turnId }
    )

    const raced = harness()
    await raced.threadStore.upsert(failed)
    const originalGet = raced.threadStore.get.bind(raced.threadStore)
    let reads = 0
    vi.spyOn(raced.threadStore, 'get').mockImplementation(async (id) => {
      const current = await originalGet(id)
      reads += 1
      if (reads === 1 || !current) return current
      return {
        ...current,
        turns: [...current.turns, createTurnRecord({
          id: 'turn_newer',
          threadId,
          prompt: 'new work',
          status: 'completed'
        })]
      }
    })

    await expect(raced.coordinator.resumeInterruptedGoals([{ threadId, turnId }])).resolves.toBe(0)
    expect(raced.startTurn).not.toHaveBeenCalled()
  })
})
