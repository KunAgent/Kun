import { describe, expect, it, vi } from 'vitest'
import type { ThreadRecord } from '../contracts/threads.js'
import { TurnService } from '../services/turn-service-core.js'
import type { ServerRuntime } from './routes/server-runtime.js'
import { reconcileRuntimeAfterRestart } from './runtime-restart-reconciliation.js'

describe('reconcileRuntimeAfterRestart', () => {
  it('recovers private conversation side threads but not delegated or room-task sides', async () => {
    const resumeInterruptedGoals = vi.fn(async (sources: readonly unknown[]) => sources.length)
    const resumeInterruptedTurns = vi.fn(async (sources: readonly unknown[]) => sources.length)
    const runtime = {
      turnService: {
        reconcileOrphanedTurns: async () => ['private', 'goal', 'child', 'task'].map((threadId) => ({ threadId, turnId: threadId })),
        reconcileManagerSettledInterruptions: async () => []
      },
      threadStore: { get: async (id: string) => ({ id, relation: 'side',
        turns: [{ id, status: 'failed' }],
        ...(id === 'private' || id === 'goal' ? { roomContext: { kind: 'conversation' } } : {}),
        ...(id === 'task' ? { roomContext: { kind: 'task' } } : {}),
        ...(id === 'goal' ? { goal: { status: 'active' } } : {}) }) },
      resumeInterruptedGoals, resumeInterruptedTurns
    } as unknown as ServerRuntime
    const report = await reconcileRuntimeAfterRestart(runtime)
    expect(report.resumeCandidateIds).toEqual(['private', 'goal'])
    expect(resumeInterruptedGoals).toHaveBeenCalledWith([{ threadId: 'goal', turnId: 'goal' }])
    expect(resumeInterruptedTurns).toHaveBeenCalledWith([{ threadId: 'private', turnId: 'private' }], [])
  })

  it('settles children first and resumes ordinary plus child-recovery parent threads', async () => {
    const order: string[] = []
    const resumeInterruptedGoals = vi.fn(async (sources: readonly unknown[]) => sources.length)
    const resumeInterruptedTurns = vi.fn(async (sources: readonly unknown[]) => sources.length)
    const runtime = {
      delegationRuntime: {
        reconcileOrphanedChildRuns: vi.fn(async () => {
          order.push('children')
          return 2
        }),
        proactiveRetryRecoveryCandidates: vi.fn(async () => [{
          parentThreadId: 'parent_resume', parentTurnId: 'turn_parent_resume',
          childId: 'child_retry', resumeCount: 0,
          proactiveRetry: { enabled: true, eligible: true, count: 0, limit: 3, remaining: 3 },
          detached: false
        }, {
          parentThreadId: 'detached_parent', parentTurnId: 'turn_detached_parent',
          childId: 'child_detached', resumeCount: 0,
          proactiveRetry: { enabled: true, eligible: true, count: 0, limit: 3, remaining: 3 },
          detached: true
        }])
      },
      turnService: {
        reconcileOrphanedTurns: vi.fn(async () => {
          order.push('turns')
          return [
            { threadId: 'child_side', turnId: 'turn_child_side' },
            { threadId: 'parent_resume', turnId: 'turn_parent_resume' },
            { threadId: 'ordinary', turnId: 'turn_ordinary' }
          ]
        }),
        reconcileManagerSettledInterruptions: vi.fn(async () => {
          order.push('manager-settled')
          return [{ threadId: 'owner_expired', turnId: 'turn_owner_expired' }]
        })
      },
      threadStore: {
        get: vi.fn(async (threadId: string) => ({
          id: threadId,
          relation: threadId === 'child_side' ? 'side' : 'primary',
          turns: [{ id: `turn_${threadId}`, status: 'failed' as const }],
          ...(threadId === 'owner_expired'
            ? { goal: { status: 'active' as const } }
            : {})
        }))
      },
      resumeInterruptedGoals,
      resumeInterruptedTurns
    } as unknown as ServerRuntime

    const report = await reconcileRuntimeAfterRestart(runtime)

    expect(order).toEqual(['children', 'turns', 'manager-settled'])
    expect(report.recoveryParentIds).toEqual(['parent_resume', 'detached_parent'])
    expect(report.managerSettledThreadIds).toEqual(['owner_expired'])
    expect(report.resumeCandidateIds).toEqual([
      'parent_resume',
      'ordinary',
      'owner_expired',
      'detached_parent'
    ])
    expect(runtime.turnService.reconcileManagerSettledInterruptions)
      .toHaveBeenCalledWith({ settledAfter: undefined })
    expect(resumeInterruptedGoals).toHaveBeenCalledWith([
      { threadId: 'owner_expired', turnId: 'turn_owner_expired' }
    ])
    expect(resumeInterruptedTurns).toHaveBeenCalledWith(
      [
        { threadId: 'parent_resume', turnId: 'turn_parent_resume' },
        { threadId: 'ordinary', turnId: 'turn_ordinary' },
        { threadId: 'detached_parent', turnId: 'turn_detached_parent' }
      ],
      expect.arrayContaining([expect.objectContaining({ childId: 'child_retry' })])
    )
  })

  it('does not auto-resume when child reconciliation fails', async () => {
    const resumeInterruptedTurns = vi.fn(async () => 1)
    const runtime = {
      delegationRuntime: {
        reconcileOrphanedChildRuns: vi.fn(async () => { throw new Error('store unavailable') }),
        proactiveRetryRecoveryCandidates: vi.fn(async () => [])
      },
      turnService: {
        reconcileOrphanedTurns: vi.fn(async () => [
          { threadId: 'ordinary', turnId: 'turn_ordinary' }
        ]),
        reconcileManagerSettledInterruptions: vi.fn(async () => [
          { threadId: 'owner_expired', turnId: 'turn_owner_expired' }
        ])
      },
      threadStore: {
        get: vi.fn(async (threadId: string) => ({
          relation: 'primary',
          turns: [{ id: `turn_${threadId}`, status: 'failed' as const }]
        }))
      },
      resumeInterruptedTurns
    } as unknown as ServerRuntime

    const report = await reconcileRuntimeAfterRestart(runtime)

    expect(report.resumeCandidateIds).toEqual([])
    expect(resumeInterruptedTurns).not.toHaveBeenCalled()
  })

  it('ignores a stale child candidate when a newer failed goal turn is the recovery source', async () => {
    const resumeInterruptedGoals = vi.fn(async (sources: readonly unknown[]) => sources.length)
    const resumeInterruptedTurns = vi.fn(async (sources: readonly unknown[]) => sources.length)
    const runtime = {
      delegationRuntime: {
        reconcileOrphanedChildRuns: vi.fn(async () => 0),
        proactiveRetryRecoveryCandidates: vi.fn(async () => [{
          parentThreadId: 'goal_parent',
          parentTurnId: 'turn_older',
          childId: 'child_stale',
          resumeCount: 0,
          proactiveRetry: { enabled: true, eligible: true, count: 0, limit: 3, remaining: 3 },
          detached: false
        }])
      },
      turnService: {
        reconcileOrphanedTurns: vi.fn(async () => [
          { threadId: 'goal_parent', turnId: 'turn_newer' }
        ]),
        reconcileManagerSettledInterruptions: vi.fn(async () => [])
      },
      threadStore: {
        get: vi.fn(async () => ({
          id: 'goal_parent',
          relation: 'primary',
          turns: [{ id: 'turn_newer', status: 'failed' as const }],
          goal: { status: 'active' as const }
        }))
      },
      resumeInterruptedGoals,
      resumeInterruptedTurns
    } as unknown as ServerRuntime

    const report = await reconcileRuntimeAfterRestart(runtime)

    expect(report.recoveryParentIds).toEqual([])
    expect(resumeInterruptedGoals).toHaveBeenCalledWith([
      { threadId: 'goal_parent', turnId: 'turn_newer' }
    ])
    expect(resumeInterruptedTurns).not.toHaveBeenCalled()
  })

  it('routes a failed turn with a retained non-active goal to ordinary recovery', async () => {
    const source = { threadId: 'post_goal_work', turnId: 'turn_post_goal_work' }
    const resumeInterruptedGoals = vi.fn(async () => 0)
    const resumeInterruptedTurns = vi.fn(async (sources: readonly unknown[]) => sources.length)
    const runtime = {
      delegationRuntime: {
        reconcileOrphanedChildRuns: vi.fn(async () => 0),
        proactiveRetryRecoveryCandidates: vi.fn(async () => [])
      },
      turnService: {
        reconcileOrphanedTurns: vi.fn(async () => [source]),
        reconcileManagerSettledInterruptions: vi.fn(async () => [])
      },
      threadStore: {
        get: vi.fn(async () => ({
          id: source.threadId,
          relation: 'primary',
          turns: [{ id: source.turnId, status: 'failed' as const }],
          goal: { status: 'completed' as const }
        }))
      },
      resumeInterruptedGoals,
      resumeInterruptedTurns
    } as unknown as ServerRuntime

    await reconcileRuntimeAfterRestart(runtime)

    expect(resumeInterruptedGoals).not.toHaveBeenCalled()
    expect(resumeInterruptedTurns).toHaveBeenCalledWith([source], [])
  })
})

describe('restart execution source behind queued inputs', () => {
  it('does not reinstall a recovery barrier after an explicit capacity-blocked queue resume', async () => {
    const source = { threadId: 'thread', turnId: 'A' }
    let thread = {
      id: source.threadId, relation: 'primary', revision: 0,
      turns: [
        { id: source.turnId, status: 'failed', startedAt: '2026-10-05T00:00:00.000Z' },
        { id: 'B', status: 'queued' }
      ]
    } as unknown as ThreadRecord
    const get = async () => thread
    const control = {
      deps: { threadStore: { get }, nowIso: () => '2026-10-05T00:01:00.000Z' },
      withQueueDataMutation: async (_threadId: string, operation: () => Promise<unknown>) => operation(),
      commitThreadRecordCAS: async (next: ThreadRecord, revision: number) => {
        if (revision !== thread.revision) return { applied: false }
        thread = { ...next, revision: revision + 1 }
        return { applied: true }
      }
    } as unknown as TurnService
    const pause = vi.fn(async (threadId: string, reason: 'user_stop' | 'restart_recovery', turnId: string) =>
      TurnService.prototype.pauseQueuedTurns.call(control, threadId, reason, turnId))
    const resume = vi.fn(async () => 1)
    const runtime = {
      turnService: {
        reconcileOrphanedTurns: async () => {
          await pause(source.threadId, 'restart_recovery', source.turnId)
          return [source]
        },
        reconcileManagerSettledInterruptions: async () => {
          // The user resumes after orphan settlement; global capacity is still full,
          // so B remains queued when the final recovery candidate sweep runs.
          await TurnService.prototype.resumeQueuedTurns.call(control, source.threadId)
          return []
        },
        pauseQueuedTurns: pause
      },
      threadStore: { get },
      resumeInterruptedTurns: resume,
      queuedTurnDispatcher: { drainAllQueued: vi.fn(async () => 1) }
    } as unknown as ServerRuntime

    const report = await reconcileRuntimeAfterRestart(runtime)

    expect(thread.queueControl).toBeUndefined()
    expect(thread.turns.find((turn) => turn.id === 'B')?.status).toBe('queued')
    expect(report.resumeCandidateIds).toEqual([])
    expect(resume).not.toHaveBeenCalled()
  })

  it('recovers interrupted execution before draining later queued inputs', async () => {
    const resume = vi.fn(async () => 1)
    const drain = vi.fn(async () => 0)
    const runtime = {
      turnService: {
        reconcileOrphanedTurns: async () => [{ threadId: 'thread', turnId: 'A' }],
        reconcileManagerSettledInterruptions: async () => [],
        pauseQueuedTurns: vi.fn(async () => {})
      },
      threadStore: { get: async () => ({ id: 'thread', relation: 'primary',
        turns: [{ id: 'A', status: 'failed' }, { id: 'B', status: 'queued' }, { id: 'C', status: 'queued' }] }) },
      resumeInterruptedTurns: resume,
      queuedTurnDispatcher: { drainAllQueued: drain }
    } as unknown as ServerRuntime
    const result = await reconcileRuntimeAfterRestart(runtime)
    expect(result.resumeCandidateIds).toEqual(['thread'])
    expect(resume).toHaveBeenCalledWith([{ threadId: 'thread', turnId: 'A' }], [])
    expect(resume.mock.invocationCallOrder[0]).toBeLessThan(drain.mock.invocationCallOrder[0]!)
  })
})
