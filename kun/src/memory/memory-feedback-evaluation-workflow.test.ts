import { readFile } from 'node:fs/promises'
import { describe, expect, it } from 'vitest'
import { loadMemoryFeedbackEvaluationPlan } from './memory-feedback-evaluation-plan.js'
import { runMemoryFeedbackEvaluationWorkflow } from './memory-feedback-evaluation-workflow.js'

describe('memory feedback evaluation workflow', () => {
  it('runs development before holdout and never runs holdout more than once', async () => {
    const loaded = await loadMemoryFeedbackEvaluationPlan()
    const result = runMemoryFeedbackEvaluationWorkflow(loaded)

    expect(result.fixtureSha256).toBe(loaded.fixture.fixtureSha256)
    expect(result.holdoutRunCount).toBe(result.candidateLocked ? 1 : 0)
    expect(result.holdout.status).toBe(result.candidateLocked ? 'run' : 'not-run')
    expect(result.development.result?.traces).toHaveLength(4)
    expect(result.decision).toBe('no-go')
  })

  it('publishes a reproducible no-go without changing production ranking', async () => {
    const loaded = await loadMemoryFeedbackEvaluationPlan()
    const first = runMemoryFeedbackEvaluationWorkflow(loaded)
    const second = runMemoryFeedbackEvaluationWorkflow(loaded)

    expect(second).toEqual(first)
    expect(first.development.result?.weights).toEqual({
      retrievalFrequency: 0.05,
      confirmation: 0.1,
      correction: 0.1
    })
    expect(loaded.plan.production.rankingWeightsChanged).toBe(false)
    expect(loaded.plan.production.dormantFeatureFlagAdded).toBe(false)
  })

  it('keeps the checked-in evidence aligned with the one-run decision', async () => {
    const evidence = JSON.parse(await readFile(new URL('./fixtures/memory-feedback-evaluation-evidence.v1.json', import.meta.url), 'utf8')) as {
      decision: string
      holdout: { bootstrap: { recallGainLowerBound: number; mrrGainLowerBound: number } }
      traces: unknown[]
    }
    expect(evidence.decision).toBe('no-go')
    expect(evidence.holdout.bootstrap).toEqual({ recallGainLowerBound: 0, mrrGainLowerBound: 0 })
    expect(evidence.traces).toHaveLength(8)
  })
})
