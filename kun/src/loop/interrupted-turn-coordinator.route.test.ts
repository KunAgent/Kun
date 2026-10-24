import { describe, expect, it, vi } from 'vitest'
import { createThreadRecord } from '../domain/thread.js'
import { createTurnRecord } from '../domain/turn.js'
import { InterruptedTurnCoordinator } from './interrupted-turn-coordinator.js'

describe('InterruptedTurnCoordinator route', () => {
  it('resumes an interrupted external Agent turn on the same Agent route', async () => {
    const base = createThreadRecord({
      id: 'thr_ext', title: 'External', workspace: '/workspace', model: 'default',
      status: 'idle', createdAt: '2026-08-19T00:00:00.000Z'
    })
    const thread = {
      ...base,
      turns: [createTurnRecord({
        id: 'turn_interrupted', threadId: base.id, prompt: 'Investigate', status: 'failed',
        clientSurface: 'gui', harnessId: 'codemaker', providerId: 'codemaker-acp',
        model: 'deepseek-flash', credentialMode: 'native-login', reasoningEffort: 'high'
      })]
    }
    const startTurn = vi.fn(async (_request: unknown, _options?: unknown) => ({ turnId: 'turn_resume' }))
    const coordinator = new InterruptedTurnCoordinator({
      threadStore: { get: vi.fn(async () => thread), upsert: vi.fn(async () => undefined) } as never,
      turns: { startTurn } as never,
      events: { record: vi.fn(async () => undefined) } as never,
      nowIso: () => '2026-08-19T00:01:00.000Z',
      nowMs: () => Date.parse('2026-08-19T00:01:00.000Z'),
      runTurn: vi.fn(async () => 'completed' as const)
    })

    await expect(coordinator.resumeInterruptedTurns([{ threadId: 'thr_ext', turnId: 'turn_interrupted' }])).resolves.toBe(1)
    const [input] = startTurn.mock.calls[0]!
    expect((input as { request: unknown }).request).toMatchObject({
      harnessId: 'codemaker', providerId: 'codemaker-acp', model: 'deepseek-flash',
      credentialMode: 'native-login', reasoningEffort: 'high'
    })
  })
})
