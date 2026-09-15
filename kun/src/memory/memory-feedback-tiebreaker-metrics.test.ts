import { describe, expect, it } from 'vitest'
import { loadMemoryFeedbackTiebreakerDataset } from './memory-feedback-tiebreaker-fixture-loader.js'
import { scoreMemoryFeedbackTiebreakerCases } from './memory-feedback-tiebreaker-metrics.js'

describe('memory feedback tiebreaker metrics', () => {
  it('reports local pair ordering separately from global relevance and abstention', async () => {
    const { fixture } = await loadMemoryFeedbackTiebreakerDataset()
    const pairCase = fixture.cases.find((item) =>
      item.partition === 'development' && item.stratum === 'confirmed-near-tie')!
    const noResultCase = fixture.cases.find((item) =>
      item.partition === 'development' && item.stratum === 'no-result-control')!
    const pair = pairCase.preferredPairs[0]!
    const scored = scoreMemoryFeedbackTiebreakerCases({
      fixture,
      results: [{
        caseId: pairCase.id,
        rankings: [{ memoryId: pair.preferredId }, { memoryId: pair.otherId }],
        selectedIds: [pair.preferredId]
      }, {
        caseId: noResultCase.id,
        rankings: [],
        selectedIds: []
      }]
    })

    expect(scored.metrics).toEqual({
      pairAccuracy: 1,
      pairCount: 1,
      recallAtK: 1,
      precisionAtK: 1,
      meanReciprocalRank: 1,
      abstentionAccuracy: 1,
      explicitForbiddenSelections: 0,
      authorizationOrLifecycleViolations: 0,
      rankedCaseCount: 1,
      noResultCaseCount: 1,
      caseCount: 2
    })
  })

  it('counts a reversed pair and selected hard negative as separate failures', async () => {
    const { fixture } = await loadMemoryFeedbackTiebreakerDataset()
    const item = fixture.cases.find((candidate) =>
      candidate.partition === 'development' && candidate.stratum === 'misleading-feedback-control')!
    const pair = item.preferredPairs[0]!
    const scored = scoreMemoryFeedbackTiebreakerCases({
      fixture,
      results: [{
        caseId: item.id,
        rankings: [{ memoryId: pair.otherId }, { memoryId: pair.preferredId }],
        selectedIds: [pair.otherId]
      }]
    })

    expect(scored.cases[0]).not.toHaveProperty('pairCorrect')
    expect(scored.metrics.recallAtK).toBe(0)
    expect(scored.metrics.explicitForbiddenSelections).toBe(1)
    expect(scored.metrics.authorizationOrLifecycleViolations).toBe(0)
  })
})
