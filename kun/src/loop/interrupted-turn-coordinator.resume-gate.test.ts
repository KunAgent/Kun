import { describe, expect, it, vi } from 'vitest'
import { InMemoryThreadStore } from '../adapters/in-memory-thread-store.js'
import { createThreadRecord } from '../domain/thread.js'
import { createTurnRecord } from '../domain/turn.js'
import { InterruptedTurnCoordinator } from './interrupted-turn-coordinator.js'

const NOW = '2026-10-29T01:00:00.000Z'

async function resume(input: {
  failedTurn?: { interruptedResume?: { sourceTurnId: string } }
  items: Array<{ turnId: string; kind: string }>
}) {
  const threadStore = new InMemoryThreadStore()
  const thread = createThreadRecord({
    id: 'thr_resume_gate',
    title: 'Resume gate',
    workspace: '/workspace',
    model: 'test-model',
    status: 'idle',
    createdAt: NOW
  })
  await threadStore.upsert({
    ...thread,
    turns: [createTurnRecord({
      id: 'turn_interrupted',
      threadId: thread.id,
      prompt: 'Plan the migration',
      status: 'failed',
      ...input.failedTurn
    })]
  })
  const startTurn = vi.fn(async (_request: unknown, _options?: unknown) => ({ turnId: 'turn_resume' }))
  const coordinator = new InterruptedTurnCoordinator({
    threadStore,
    turns: { startTurn, finishTurn: vi.fn() } as never,
    events: { record: vi.fn(async () => undefined) } as never,
    nowIso: () => NOW,
    nowMs: () => Date.parse(NOW),
    runTurn: vi.fn(async () => 'completed' as const),
    loadSessionItems: async () => input.items as never
  })
  const resumed = await coordinator.resumeInterruptedTurns([
    { threadId: thread.id, turnId: 'turn_interrupted' }
  ])
  coordinator.shutdown()
  return { resumed, startTurn }
}

describe('InterruptedTurnCoordinator resume gate', () => {
  it('resumes an interrupted user turn that left work behind', async () => {
    const { resumed, startTurn } = await resume({
      items: [{ turnId: 'turn_interrupted', kind: 'assistant_text' }]
    })

    expect(resumed).toBe(1)
    const [started] = startTurn.mock.calls[0]! as unknown as [{ request: { interruptedResume?: unknown } }]
    expect(started.request.interruptedResume).toEqual({ sourceTurnId: 'turn_interrupted' })
  })

  it('skips a turn killed before any assistant or tool output', async () => {
    const { resumed, startTurn } = await resume({
      items: [{ turnId: 'turn_interrupted', kind: 'user_message' }]
    })

    expect(resumed).toBe(0)
    expect(startTurn).not.toHaveBeenCalled()
  })

  it('never chains one auto-resume onto another', async () => {
    const { resumed, startTurn } = await resume({
      failedTurn: { interruptedResume: { sourceTurnId: 'turn_original' } },
      items: [{ turnId: 'turn_interrupted', kind: 'tool_call' }]
    })

    expect(resumed).toBe(0)
    expect(startTurn).not.toHaveBeenCalled()
  })
})
