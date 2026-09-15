import { describe, expect, it } from 'vitest'
import { DEFAULT_KUN_CAPABILITIES_CONFIG } from '../contracts/capabilities.js'
import { loadMemoryFeedbackTiebreakerDataset } from './memory-feedback-tiebreaker-fixture-loader.js'
import {
  rankMemoryFeedbackTiebreakerDevelopment,
  rankMemoryFeedbackTiebreakerFoundationCase
} from './memory-feedback-tiebreaker-foundation.js'
import { retrieveMemoryRecords } from './memory-retrieval.js'

describe('memory feedback tiebreaker lexical foundation', () => {
  it('matches direct post-#1308 foundation retrieval for every development case', async () => {
    const { fixture } = await loadMemoryFeedbackTiebreakerDataset()
    const results = rankMemoryFeedbackTiebreakerDevelopment(fixture)
    const records = new Map(fixture.records.map((record) => [record.id, record]))

    expect(results).toHaveLength(18)
    for (const item of fixture.cases.filter((candidate) => candidate.partition === 'development')) {
      const actual = results.find((result) => result.caseId === item.id)!
      const direct = retrieveMemoryRecords({
        records: item.candidateIds.map((id) => records.get(id)!),
        request: {
          query: item.query,
          workspace: item.workspace,
          limit: item.limit,
          promptCharacterBudget: item.promptCharacterBudget
        },
        policy: { ...DEFAULT_KUN_CAPABILITIES_CONFIG.memory, enabled: true },
        mode: 'filesystem-fallback',
        nowIso: fixture.evaluationNow,
        relevanceMode: 'foundation-v1'
      })

      expect(actual.selectedIds).toEqual(direct.records.map((record) => record.id))
      expect(actual.rankings).toEqual(direct.trace.rankings.map((ranking) => ({
        memoryId: ranking.memoryId,
        foundationScore: ranking.features.finalScore,
        selected: ranking.selected
      })))
    }
  })

  it('keeps no-result controls empty and emits non-negative adjacent gaps', async () => {
    const { fixture } = await loadMemoryFeedbackTiebreakerDataset()

    for (const item of fixture.cases.filter((candidate) =>
      candidate.partition === 'development' && candidate.stratum === 'no-result-control')) {
      const result = rankMemoryFeedbackTiebreakerFoundationCase(fixture, item)
      expect(result.selectedIds).toEqual([])
      expect(result.gaps.every((gap) => gap.gap >= 0)).toBe(true)
    }
  })
})
