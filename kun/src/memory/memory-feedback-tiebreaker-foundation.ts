import { DEFAULT_KUN_CAPABILITIES_CONFIG } from '../contracts/capabilities.js'
import type { MemoryRecord, MemoryRetrievalTrace } from '../contracts/memory.js'
import type { MemoryFeedbackTiebreakerFixture } from './memory-feedback-tiebreaker-contracts.js'
import { retrieveMemoryRecords } from './memory-retrieval.js'

type FixtureCase = MemoryFeedbackTiebreakerFixture['cases'][number]

export type MemoryFeedbackTiebreakerFoundationRanking = {
  memoryId: string
  foundationScore: number
  selected: boolean
}

export type MemoryFeedbackTiebreakerFoundationGap = {
  higherId: string
  lowerId: string
  gap: number
}

export type MemoryFeedbackTiebreakerFoundationResult = {
  caseId: string
  rankings: MemoryFeedbackTiebreakerFoundationRanking[]
  selectedIds: string[]
  gaps: MemoryFeedbackTiebreakerFoundationGap[]
  trace: MemoryRetrievalTrace
}

export function rankMemoryFeedbackTiebreakerFoundationCase(
  fixture: MemoryFeedbackTiebreakerFixture,
  item: FixtureCase
): MemoryFeedbackTiebreakerFoundationResult {
  const recordsById = new Map(fixture.records.map((record) => [record.id, record]))
  const records = item.candidateIds
    .map((id) => recordsById.get(id))
    .filter((record): record is MemoryRecord => record !== undefined)
  const result = retrieveMemoryRecords({
    records,
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
  const rankings = result.trace.rankings.map((ranking) => ({
    memoryId: ranking.memoryId,
    foundationScore: ranking.features.finalScore,
    selected: ranking.selected
  }))

  return {
    caseId: item.id,
    rankings,
    selectedIds: result.records.map((record) => record.id),
    gaps: rankings.slice(1).map((ranking, index) => ({
      higherId: rankings[index]!.memoryId,
      lowerId: ranking.memoryId,
      gap: round(rankings[index]!.foundationScore - ranking.foundationScore)
    })),
    trace: result.trace
  }
}

export function rankMemoryFeedbackTiebreakerDevelopment(
  fixture: MemoryFeedbackTiebreakerFixture
): MemoryFeedbackTiebreakerFoundationResult[] {
  return fixture.cases
    .filter((item) => item.partition === 'development')
    .map((item) => rankMemoryFeedbackTiebreakerFoundationCase(fixture, item))
}

function round(value: number): number {
  return Math.round(value * 1_000_000) / 1_000_000
}
