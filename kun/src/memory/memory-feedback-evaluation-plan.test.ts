import { readFile } from 'node:fs/promises'
import { describe, expect, it } from 'vitest'
import { loadMemoryFeedbackEvaluationPlan } from './memory-feedback-evaluation-plan.js'

describe('pre-registered memory feedback evaluation plan', () => {
  it('freezes disjoint development and holdout partitions with matching hashes', async () => {
    const loaded = await loadMemoryFeedbackEvaluationPlan()
    const { plan, fixture, sourceHashes } = loaded
    expect(plan.status).toBe('pre-registered')
    expect(plan.partitions.development).toHaveLength(2)
    expect(plan.partitions.holdout).toHaveLength(2)
    expect(sourceHashes.fixture).toBe(plan.fixtureSha256)
    expect(new Set([
      ...plan.partitions.development,
      ...plan.partitions.holdout
    ])).toEqual(new Set(fixture.cases.map((item) => item.id)))
    expect(plan.bootstrap.holdoutRuns).toBe(1)
    expect(plan.production.rankingWeightsChanged).toBe(false)
    expect(plan.production.dormantFeatureFlagAdded).toBe(false)
  })

  it('keeps the offline evaluator out of production retrieval', async () => {
    const source = await readFile(new URL('./memory-retrieval.ts', import.meta.url), 'utf8')
    expect(source).not.toContain('memory-feedback-evaluation')
  })
})
