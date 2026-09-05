import { describe, expect, it } from 'vitest'
import { DEFAULT_KUN_CAPABILITIES_CONFIG } from '../contracts/capabilities.js'
import { MEMORY_RANKING_WEIGHTS, memoryInScope, memoryLifecycleState } from './memory-ranking.js'
import {
  MEMORY_RETRIEVAL_FIXTURE_CASES,
  MEMORY_RETRIEVAL_FIXTURE_RECORDS
} from './memory-retrieval-fixtures.js'
import {
  formatMemoryEvaluationReport,
  scoreMemoryRetrievalEvaluation
} from './memory-retrieval-evaluation.js'
import { retrieveMemoryRecords } from './memory-retrieval.js'

describe('anonymous memory retrieval evaluation', () => {
  it('reports baseline and foundation metrics without reading production data', async () => {
    const baseline = await scoreMemoryRetrievalEvaluation({
      records: MEMORY_RETRIEVAL_FIXTURE_RECORDS,
      cases: MEMORY_RETRIEVAL_FIXTURE_CASES,
      retrieve: async (fixture, records) => legacyBaseline(records, fixture.query, fixture.workspace, fixture.limit)
    })
    const foundation = await scoreMemoryRetrievalEvaluation({
      records: MEMORY_RETRIEVAL_FIXTURE_RECORDS,
      cases: MEMORY_RETRIEVAL_FIXTURE_CASES,
      retrieve: async (fixture, records) => retrieveMemoryRecords({
        records,
        request: {
          query: fixture.query,
          workspace: fixture.workspace,
          limit: fixture.limit,
          promptCharacterBudget: 2_000
        },
        policy: { ...DEFAULT_KUN_CAPABILITIES_CONFIG.memory, enabled: true },
        mode: 'filesystem-fallback',
        nowIso: '2026-08-28T00:00:00.000Z'
      }).records
    })

    expect(foundation.scopeLeaks).toBe(0)
    expect(foundation.recallAtK).toBeGreaterThanOrEqual(baseline.recallAtK)
    expect(foundation.precisionAtK).toBeGreaterThan(baseline.precisionAtK)
    expect(formatMemoryEvaluationReport({ baseline, foundation, rankingWeights: MEMORY_RANKING_WEIGHTS }))
      .toContain('checked-in-anonymous-fixtures')
    console.info(formatMemoryEvaluationReport({ baseline, foundation, rankingWeights: MEMORY_RANKING_WEIGHTS }))
  })
})

function legacyBaseline(
  records: readonly (typeof MEMORY_RETRIEVAL_FIXTURE_RECORDS)[number][],
  query: string,
  workspace: string | undefined,
  limit: number
) {
  const nowMs = Date.parse('2026-08-28T00:00:00.000Z')
  const active = records.filter((record) =>
    memoryInScope(record, { workspace }) && memoryLifecycleState(record, nowMs) === 'active'
  )
  const user = active.filter((record) => record.scope === 'user')
  const queryTerms = new Set(query.toLocaleLowerCase('en-US').match(/[\p{L}\p{N}_]+/gu) ?? [])
  const scored = active.filter((record) => record.scope !== 'user').map((record) => ({
    record,
    score: [...queryTerms].filter((term) => record.content.toLocaleLowerCase('en-US').includes(term)).length
  })).filter((candidate) => candidate.score > 0)
    .sort((left, right) => right.score - left.score)
    .map((candidate) => candidate.record)
  return [...user, ...scored].slice(0, limit)
}
