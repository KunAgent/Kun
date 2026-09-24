import { describe, expect, it } from 'vitest'
import { loadMemoryFeedbackTiebreakerDataset } from './memory-feedback-tiebreaker-fixture-loader.js'
import {
  evaluateMemoryFeedbackTiebreakerCase,
  groupMemoryFeedbackTiebreakerNearTies
} from './memory-feedback-tiebreaker-evaluator.js'
import { rankMemoryFeedbackTiebreakerFoundationCase } from './memory-feedback-tiebreaker-foundation.js'

describe('memory feedback near-tie evaluator', () => {
  it('uses an inclusive leader-relative boundary and bounded groups', () => {
    const rankings = [
      { id: 'a', foundationScore: 0.8 },
      { id: 'b', foundationScore: 0.7 },
      { id: 'c', foundationScore: 0.69 },
      { id: 'd', foundationScore: 0.68 }
    ]

    expect(groupMemoryFeedbackTiebreakerNearTies(rankings, 0.1, 3))
      .toEqual([[rankings[0], rankings[1]], [rankings[2], rankings[3]]])
    expect(groupMemoryFeedbackTiebreakerNearTies(rankings, 1, 2))
      .toEqual([[rankings[0], rankings[1]], [rankings[2], rankings[3]]])
    expect(groupMemoryFeedbackTiebreakerNearTies(rankings, 0, 3))
      .toEqual(rankings.map((item) => [item]))
  })

  it('reorders only admitted candidates and preserves abstention, scope, lifecycle, and budgets', async () => {
    const { fixture } = await loadMemoryFeedbackTiebreakerDataset()
    const cases = fixture.cases.filter((item) => item.partition === 'development')

    for (const item of cases) {
      const foundation = rankMemoryFeedbackTiebreakerFoundationCase(fixture, item)
      const candidate = evaluateMemoryFeedbackTiebreakerCase({
        fixture,
        item,
        signalRule: 'confirmation-correction',
        maximumGap: 1
      })

      expect(new Set(candidate.rankings.map((ranking) => ranking.memoryId)))
        .toEqual(new Set(foundation.rankings.map((ranking) => ranking.memoryId)))
      expect(candidate.selectedIds.length).toBeLessThanOrEqual(item.limit)
      expect(candidate.selectedCharacters).toBeLessThanOrEqual(item.promptCharacterBudget)
      if (item.stratum === 'no-result-control') expect(candidate.selectedIds).toEqual([])
      if (item.stratum === 'scope-safety' || item.stratum === 'lifecycle-safety') {
        expect(candidate.forbiddenSelectedIds).toEqual([])
      }
    }
  })

  it('applies explicit confirmation and correction only inside the declared window', async () => {
    const { fixture } = await loadMemoryFeedbackTiebreakerDataset()
    for (const stratum of ['confirmed-near-tie', 'corrected-replacement-near-tie'] as const) {
      const item = fixture.cases.find((candidate) =>
        candidate.partition === 'development' && candidate.stratum === stratum)!
      const signalRule = stratum === 'confirmed-near-tie' ? 'confirmation' : 'confirmation-correction'
      const candidate = evaluateMemoryFeedbackTiebreakerCase({ fixture, item, signalRule, maximumGap: 1 })

      expect(candidate.selectedIds).toEqual(item.expectedIds)
    }

    for (const stratum of ['no-feedback-control', 'wide-gap-control'] as const) {
      const item = fixture.cases.find((candidate) =>
        candidate.partition === 'development' && candidate.stratum === stratum)!
      const foundation = rankMemoryFeedbackTiebreakerFoundationCase(fixture, item)
      const candidate = evaluateMemoryFeedbackTiebreakerCase({
        fixture,
        item,
        signalRule: 'confirmation-correction',
        maximumGap: 0
      })

      expect(candidate.selectedIds).toEqual(foundation.selectedIds)
    }
  })

  it('keeps retrieval frequency shadow-only', async () => {
    const { fixture } = await loadMemoryFeedbackTiebreakerDataset()
    const item = fixture.cases.find((candidate) =>
      candidate.partition === 'development' && candidate.stratum === 'frequent-unconfirmed-control')!
    const withFrequency = evaluateMemoryFeedbackTiebreakerCase({
      fixture,
      item,
      signalRule: 'confirmation',
      maximumGap: 1
    })
    const withoutFrequency = evaluateMemoryFeedbackTiebreakerCase({
      fixture: { ...fixture, events: fixture.events.filter((event) => event.kind !== 'retrieved') },
      item,
      signalRule: 'confirmation',
      maximumGap: 1
    })

    expect(withFrequency.selectedIds).toEqual(withoutFrequency.selectedIds)
    expect(withFrequency.rankings.map((ranking) => ranking.memoryId))
      .toEqual(withoutFrequency.rankings.map((ranking) => ranking.memoryId))
    expect(withFrequency.rankings.some((ranking) => ranking.retrievalCount > 0)).toBe(true)
    expect(withoutFrequency.rankings.every((ranking) => ranking.retrievalCount === 0)).toBe(true)
  })
})
