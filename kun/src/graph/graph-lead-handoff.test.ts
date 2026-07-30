import { afterEach, describe, expect, it } from 'vitest'
import type { DelegationRuntime } from '../delegation/delegation-runtime.js'
import {
  testCompletedChild,
  testGraphPlan
} from './graph-test-fixtures.test-support.js'
import {
  cleanupSchedulerHarnesses,
  schedulerHarness,
  waitFor
} from '../../tests/graph-scheduler-test-harness.js'

afterEach(cleanupSchedulerHarnesses)

describe('Graph source Lead result handoff', () => {
  it('captures ordinary work, waits for Lead approval, then hands it to the successor', async () => {
    const basic = testGraphPlan()
    const source: ReturnType<typeof testGraphPlan>['nodes'][number] = {
      ...basic.nodes[0]!,
      maxAttempts: 1,
      completion: {
        ...basic.nodes[0]!.completion,
        requiredResultFields: ['summary', 'artifactRefs']
      }
    }
    const plan = testGraphPlan({
      nodes: [source, basic.nodes[1]!],
      edges: [{
        id: 'footer_data',
        kind: 'data',
        from: source.id,
        to: 'finish',
        artifactName: 'footer-analysis',
        required: true
      }],
      completionNodeIds: ['finish'],
      autoStart: true
    })
    const prompts: string[] = []
    let childNumber = 0
    const delegation = {
      enabled: () => true,
      runChild: async (input: {
        onQueued?: (id: string) => Promise<void> | void
        onRunning?: (id: string) => Promise<void> | void
        prompt: string
      }) => {
        prompts.push(input.prompt)
        const childId = `child_executor_${++childNumber}`
        await input.onQueued?.(childId)
        await input.onRunning?.(childId)
        return testCompletedChild(
          childId,
          childNumber === 1
            ? 'Useful footer analysis in .graph-artifacts/docs-top-audit.md.'
            : 'Successor used the approved footer analysis.'
        )
      }
    } as unknown as DelegationRuntime
    const harness = await schedulerHarness(plan, () => delegation, {}, {
      autoLeadReview: false
    })
    harness.scheduler.start()
    const waiting = await waitFor(async () => {
      const run = await harness.store.get('run_harness')
      return run?.status === 'awaiting_supervision' &&
        run.nodes.research.attempts.length === 1
        ? run
        : null
    })

    const researchAttempt = waiting.nodes.research.attempts[0]!
    expect(waiting.nodes.research.status).toBe('reviewing')
    expect(researchAttempt.validation).toMatchObject({ valid: true, issues: [] })
    expect(researchAttempt.result?.artifactRefs).toEqual([])
    expect(waiting.nodes.finish.status).toBe('blocked')
    expect(waiting.reviews.some((review) => review.reviewerKind === 'lead')).toBe(false)

    await harness.control.recordReview('run_harness', {
      version: 1,
      reviewId: 'lead_review_research',
      nodeId: 'research',
      attemptId: researchAttempt.id,
      reviewerKind: 'lead',
      outcome: 'pass',
      summary: 'The main agent inspected and approved the audit.',
      evidence: ['Inspected the executor result and child record.'],
      artifactRefs: [],
      createdAt: new Date().toISOString()
    }, {
      commandId: 'lead_review_research_command',
      idempotencyKey: 'lead_review_research'
    }, 'lead')

    const successorWaiting = await waitFor(async () => {
      const run = await harness.store.get('run_harness')
      return run?.status === 'awaiting_supervision' &&
        run.nodes.finish.attempts.length === 1
        ? run
        : null
    })
    expect(successorWaiting.nodes.research.status).toBe('accepted')
    expect(prompts[1]).toContain('Main-agent-approved inputs')
    expect(prompts[1]).toContain(
      'Useful footer analysis in .graph-artifacts/docs-top-audit.md.'
    )

    const finishAttempt = successorWaiting.nodes.finish.attempts[0]!
    await harness.control.recordReview('run_harness', {
      version: 1,
      reviewId: 'lead_review_finish',
      nodeId: 'finish',
      attemptId: finishAttempt.id,
      reviewerKind: 'lead',
      outcome: 'pass',
      summary: 'The main agent approved the successor result.',
      evidence: ['Inspected the successor child record.'],
      artifactRefs: [],
      createdAt: new Date().toISOString()
    }, {
      commandId: 'lead_review_finish_command',
      idempotencyKey: 'lead_review_finish'
    }, 'lead')

    const completed = await waitFor(async () => {
      const run = await harness.store.get('run_harness')
      return run?.status === 'completed' ? run : null
    })
    expect(completed.nodes.finish.status).toBe('accepted')
    await harness.scheduler.stop()
  }, 15_000)
})
