import { describe, expect, it, vi } from 'vitest'
import type { ServerRuntime } from './routes/server-runtime.js'
import { reconcileRuntimeAfterRestart } from './runtime-restart-reconciliation.js'

describe('reconcileRuntimeAfterRestart', () => {
  it('settles children first and resumes ordinary plus child-recovery parent threads', async () => {
    const order: string[] = []
    const resumeInterruptedGoals = vi.fn(async (threadIds: readonly string[]) => threadIds.length)
    const resumeInterruptedTurns = vi.fn(async (threadIds: readonly string[]) => threadIds.length)
    const runtime = {
      delegationRuntime: {
        reconcileOrphanedChildRuns: vi.fn(async () => {
          order.push('children')
          return 2
        }),
        proactiveRetryRecoveryCandidates: vi.fn(async () => [{
          parentThreadId: 'parent_resume', childId: 'child_retry', resumeCount: 0,
          proactiveRetry: { enabled: true, eligible: true, count: 0, limit: 3, remaining: 3 },
          detached: false
        }, {
          parentThreadId: 'detached_parent', childId: 'child_detached', resumeCount: 0,
          proactiveRetry: { enabled: true, eligible: true, count: 0, limit: 3, remaining: 3 },
          detached: true
        }])
      },
      turnService: {
        reconcileOrphanedTurns: vi.fn(async () => {
          order.push('turns')
          return ['child_side', 'parent_resume', 'ordinary']
        })
      },
      threadStore: {
        get: vi.fn(async (threadId: string) => ({
          id: threadId,
          relation: threadId === 'child_side' ? 'side' : 'primary'
        }))
      },
      resumeInterruptedGoals,
      resumeInterruptedTurns
    } as unknown as ServerRuntime

    const report = await reconcileRuntimeAfterRestart(runtime)

    expect(order).toEqual(['children', 'turns'])
    expect(report.recoveryParentIds).toEqual(['parent_resume', 'detached_parent'])
    expect(report.resumeCandidateIds).toEqual(['parent_resume', 'ordinary', 'detached_parent'])
    expect(resumeInterruptedGoals).toHaveBeenCalledWith(['ordinary'])
    expect(resumeInterruptedTurns).toHaveBeenCalledWith(
      ['parent_resume', 'ordinary', 'detached_parent'],
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
      turnService: { reconcileOrphanedTurns: vi.fn(async () => ['ordinary']) },
      threadStore: { get: vi.fn(async () => ({ relation: 'primary' })) },
      resumeInterruptedTurns
    } as unknown as ServerRuntime

    const report = await reconcileRuntimeAfterRestart(runtime)

    expect(report.resumeCandidateIds).toEqual([])
    expect(resumeInterruptedTurns).not.toHaveBeenCalled()
  })
})
