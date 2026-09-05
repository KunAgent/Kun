import { describe, expect, it, vi } from 'vitest'
import type { ServerRuntime } from './routes/server-runtime.js'
import { reconcileRuntimeAfterRestart } from './runtime-restart-reconciliation.js'

describe('reconcileRuntimeAfterRestart', () => {
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
