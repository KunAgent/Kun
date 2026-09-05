import { describe, expect, it, vi } from 'vitest'
import { createThreadRecord } from '../domain/thread.js'
import { createTurnRecord } from '../domain/turn.js'
import { TurnCapacityError } from '../services/turn-service.js'
import { InterruptedTurnCoordinator } from './interrupted-turn-coordinator.js'

describe('InterruptedTurnCoordinator subagent recovery context', () => {
  it('launches one idempotent parent decision turn with safe child facts', async () => {
    const baseThread = createThreadRecord({
      id: 'parent', title: 'Parent', workspace: '/workspace', model: 'test-model',
      status: 'idle', createdAt: '2026-08-19T00:00:00.000Z',
      goal: {
        threadId: 'parent', objective: 'finish the review', status: 'active',
        tokensUsed: 0, timeUsedSeconds: 0,
        createdAt: '2026-08-19T00:00:00.000Z',
        updatedAt: '2026-08-19T00:00:00.000Z'
      }
    })
    const thread = {
      ...baseThread,
      turns: [createTurnRecord({
        id: 'turn_interrupted',
        threadId: baseThread.id,
        prompt: 'Delegate the review',
        status: 'failed'
      })]
    }
    const threadStore = {
      get: vi.fn(async () => thread),
      upsert: vi.fn(async () => undefined)
    }
    const startTurn = vi.fn(async (_request: unknown, _options?: unknown) => ({ turnId: 'turn_recovery' }))
    const record = vi.fn(async () => undefined)
    const runTurn = vi.fn(async () => 'completed' as const)
    const coordinator = new InterruptedTurnCoordinator({
      threadStore: threadStore as never,
      turns: { startTurn } as never,
      events: { record } as never,
      nowIso: () => '2026-08-19T00:01:00.000Z',
      nowMs: () => Date.parse('2026-08-19T00:01:00.000Z'),
      runTurn
    })

    await expect(coordinator.resumeInterruptedTurns([{
      threadId: 'parent',
      turnId: 'turn_interrupted'
    }], [{
      parentThreadId: 'parent',
      parentTurnId: 'turn_interrupted',
      childId: 'child_retry',
      label: 'Review change',
      error: 'model request failed with status 520',
      failure: {
        source: 'model', code: 'http_520', category: 'unavailable', httpStatus: 520
      },
      resumeCount: 0,
      proactiveRetry: { enabled: true, eligible: true, count: 0, limit: 3, remaining: 3 },
      detached: true
    }])).resolves.toBe(1)

    expect(startTurn).toHaveBeenCalledTimes(1)
    const [requestValue, optionsValue] = startTurn.mock.calls[0]!
    const request = requestValue as { request: { clientRequestId?: string } }
    const options = optionsValue as {
      expectedLatestFailedTurnId: string
      runtimeContext: { kind: string; content: string }
    }
    expect(request.request.clientRequestId).toMatch(/^subagent-recovery:/)
    expect(options.expectedLatestFailedTurnId).toBe('turn_interrupted')
    expect(options.runtimeContext).toMatchObject({ kind: 'host-control' })
    expect(options.runtimeContext.content).toContain('child_retry')
    expect(options.runtimeContext.content).toContain('http_520')
    expect(options.runtimeContext.content).not.toContain('<html>')
    expect(runTurn).toHaveBeenCalledWith('parent', 'turn_recovery')
  })

  it('resumes past a retained non-active goal and marks cooldown only after admission', async () => {
    const baseThread = createThreadRecord({
      id: 'ordinary',
      title: 'Ordinary',
      workspace: '/workspace',
      model: 'test-model',
      status: 'idle',
      goal: {
        threadId: 'ordinary',
        objective: 'A prior goal is paused',
        status: 'paused',
        tokensUsed: 0,
        timeUsedSeconds: 0,
        createdAt: '2026-08-19T00:00:00.000Z',
        updatedAt: '2026-08-19T00:00:00.000Z'
      }
    })
    const thread = {
      ...baseThread,
      turns: [createTurnRecord({
        id: 'turn_interrupted',
        threadId: baseThread.id,
        prompt: 'Continue ordinary work',
        status: 'failed'
      })]
    }
    let scheduled: (() => void) | undefined
    const threadStore = {
      get: vi.fn(async () => thread),
      upsert: vi.fn(async () => undefined)
    }
    const startTurn = vi.fn()
      .mockRejectedValueOnce(new TurnCapacityError(1))
      .mockResolvedValueOnce({ turnId: 'turn_recovery' })
    const runTurn = vi.fn(async () => 'completed' as const)
    const coordinator = new InterruptedTurnCoordinator({
      threadStore: threadStore as never,
      turns: { startTurn, finishTurn: vi.fn() } as never,
      events: { record: vi.fn(async () => undefined) } as never,
      nowIso: () => '2026-08-19T00:01:00.000Z',
      nowMs: () => Date.parse('2026-08-19T00:01:00.000Z'),
      runTurn,
      interruptedResume: {
        setTimer: (callback) => {
          scheduled = callback
          return { cancel: () => undefined }
        }
      }
    })

    await expect(coordinator.resumeInterruptedTurns([{
      threadId: 'ordinary',
      turnId: 'turn_interrupted'
    }])).resolves.toBe(0)
    expect(threadStore.upsert).not.toHaveBeenCalled()
    expect(scheduled).toBeTypeOf('function')

    scheduled?.()
    await new Promise((resolve) => setTimeout(resolve, 0))
    expect(startTurn).toHaveBeenCalledTimes(2)
    expect(threadStore.upsert).toHaveBeenCalledOnce()
    expect(runTurn).toHaveBeenCalledWith('ordinary', 'turn_recovery')
  })
})
