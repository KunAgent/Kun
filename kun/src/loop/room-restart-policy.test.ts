import { describe, expect, it, vi } from 'vitest'
import { InMemoryThreadStore } from '../adapters/in-memory-thread-store.js'
import { createThreadRecord } from '../domain/thread.js'
import { createTurnRecord } from '../domain/turn.js'
import { InterruptedTurnCoordinator } from './interrupted-turn-coordinator.js'
import { GoalTurnCoordinator } from './goal-turn-coordinator.js'

describe('room task restart ownership', () => {
  it('never launches a generic interrupted or goal continuation for a room task', async () => {
    const threadStore = new InMemoryThreadStore()
    const now = '2026-09-12T00:00:00.000Z'
    const thread = createThreadRecord({ id: 'room_thread', title: 'Room task', workspace: '/task', model: 'test',
      roomContext: { roomId: 'room_one', taskId: 'task_one', memberId: 'member_one', kind: 'execution',
        blockedToolNames: [], blockedProviderIds: [], blockedSkillIds: [] },
      goal: { threadId: 'room_thread', objective: 'legacy goal', status: 'active', tokensUsed: 0, timeUsedSeconds: 0,
        createdAt: now, updatedAt: now } })
    await threadStore.upsert({ ...thread, turns: [createTurnRecord({
      id: 'failed_turn', threadId: thread.id, prompt: 'Work', status: 'failed'
    })] })
    const startTurn = vi.fn()
    const runTurn = vi.fn()
    const deps = { threadStore, turns: { startTurn, finishTurn: vi.fn() },
      events: { record: vi.fn() }, nowIso: () => now, nowMs: () => Date.parse(now), runTurn }
    const interrupted = new InterruptedTurnCoordinator(deps)
    const goals = new GoalTurnCoordinator(deps)
    const sources = [{ threadId: thread.id, turnId: 'failed_turn' }]
    expect(await interrupted.resumeInterruptedTurns(sources)).toBe(0)
    expect(await goals.resumeInterruptedGoals(sources)).toBe(0)
    await goals.afterTerminal({ threadId: thread.id, turnId: 'failed_turn', finalStatus: 'failed', timer: null })
    expect(startTurn).not.toHaveBeenCalled()
    expect(runTurn).not.toHaveBeenCalled()
    expect((await threadStore.get(thread.id))?.turns).toHaveLength(1)
    interrupted.shutdown()
    goals.shutdown()
  })
})
