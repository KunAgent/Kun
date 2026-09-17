import type { MemoryFeedbackEvent } from '../contracts/memory-feedback.js'
import type { MemoryRecord } from '../contracts/memory.js'
import {
  compareRankedMemories,
  hasPositiveMemoryRelevance,
  memoryInScope,
  memoryLifecycleState,
  rankMemory,
  type RankedMemory
} from './memory-ranking.js'
import { memorySearchTokens } from './memory-search-tokens.js'
import type {
  MemoryFeedbackFixtureCase,
  MemoryFeedbackFixtureDataset
} from './memory-feedback-fixtures.js'

export const MEMORY_FEEDBACK_EVALUATION_VERSION = 'p3-feedback-v1'
export const MEMORY_FEEDBACK_RETRIEVAL_LOG_CAP = 16

/** The only feedback weights used by this shadow evaluator. Production ranking does not import this module. */
export const MEMORY_FEEDBACK_EVALUATION_WEIGHTS = Object.freeze({
  retrievalFrequency: 0.05,
  confirmation: 0.1,
  correction: 0.1
})

export type MemoryFeedbackEvaluationWeights = Readonly<typeof MEMORY_FEEDBACK_EVALUATION_WEIGHTS>

export type MemoryFeedbackFeatureVector = {
  lexical: number
  scopeAffinity: number
  typeAffinity: number
  freshness: number
  importance: number
  confidence: number
  retrievalFrequency: number
  confirmation: number
  correction: number
  foundationScore: number
  candidateScore: number
}

export type MemoryFeedbackEvaluationRanking = {
  memoryId: string
  features: MemoryFeedbackFeatureVector
  selected: boolean
}

export type MemoryFeedbackEvaluationTrace = {
  caseId: string
  candidate: 'foundation' | 'feedback'
  rankings: MemoryFeedbackEvaluationRanking[]
  selectedIds: string[]
  forbiddenSelectedIds: string[]
}

export type MemoryFeedbackEvaluationMetrics = {
  recallAtK: number
  precisionAtK: number
  meanReciprocalRank: number
  forbiddenSelections: number
  queryCount: number
}

export type MemoryFeedbackEvaluationResult = {
  version: typeof MEMORY_FEEDBACK_EVALUATION_VERSION
  fixtureSha256: string
  weights: MemoryFeedbackEvaluationWeights
  foundation: MemoryFeedbackEvaluationMetrics
  candidate: MemoryFeedbackEvaluationMetrics
  traces: MemoryFeedbackEvaluationTrace[]
}

type FeedbackSignals = {
  retrievalCount: number
  confirmationCount: number
  correctionCount: number
}

/**
 * Evaluate feedback as a bounded, deterministic re-rank after the existing lexical
 * foundation has selected relevant, authorized, active candidates. This is an
 * offline wrapper: no production retrieval module imports it or reads its output.
 */
export function evaluateMemoryFeedbackCandidate(
  dataset: MemoryFeedbackFixtureDataset,
  weights: MemoryFeedbackEvaluationWeights = MEMORY_FEEDBACK_EVALUATION_WEIGHTS
): MemoryFeedbackEvaluationResult {
  const records = new Map(dataset.records.map((record) => [record.id, record]))
  const signals = buildFeedbackSignals(dataset.events)
  const traces: MemoryFeedbackEvaluationTrace[] = []
  const foundationMetrics: CaseMetrics[] = []
  const candidateMetrics: CaseMetrics[] = []

  for (const fixture of dataset.cases) {
    const ranked = rankFixtureCase(fixture, records, signals, dataset.evaluationNow, weights)
    const relevant = ranked.filter((item) => item.relevant)
    const foundation = relevant
      .slice()
      .sort((left, right) => compareRankedMemories(left.ranked, right.ranked))
    const candidate = relevant
      .slice()
      .sort((left, right) => right.features.candidateScore - left.features.candidateScore ||
        compareRankedMemories(left.ranked, right.ranked))
    traces.push(toTrace(fixture, 'foundation', foundation, ranked))
    traces.push(toTrace(fixture, 'feedback', candidate, ranked))
    foundationMetrics.push(scoreCase(fixture, foundation.map((item) => item.ranked.record.id)))
    candidateMetrics.push(scoreCase(fixture, candidate.map((item) => item.ranked.record.id)))
  }

  return {
    version: MEMORY_FEEDBACK_EVALUATION_VERSION,
    fixtureSha256: dataset.fixtureSha256,
    weights,
    foundation: summarizeMetrics(foundationMetrics),
    candidate: summarizeMetrics(candidateMetrics),
    traces
  }
}

function rankFixtureCase(
  fixture: MemoryFeedbackFixtureCase,
  records: ReadonlyMap<string, MemoryRecord>,
  signals: ReadonlyMap<string, FeedbackSignals>,
  nowIso: string,
  weights: MemoryFeedbackEvaluationWeights
): Array<{ ranked: RankedMemory; features: MemoryFeedbackFeatureVector; relevant: boolean }> {
  const nowMs = Date.parse(nowIso)
  const candidates = fixture.candidateIds
    .map((id) => records.get(id))
    .filter((record): record is MemoryRecord => Boolean(record))
    .filter((record) => memoryInScope(record, { workspace: fixture.workspace }))
    .filter((record) => memoryLifecycleState(record, nowMs) === 'active')
  const supersededIds = new Set(candidates.flatMap((record) => record.supersedes ? [record.supersedes] : []))
  const queryTokens = memorySearchTokens(fixture.query).tokens

  return candidates
    .filter((record) => !supersededIds.has(record.id))
    .map((record) => {
      const ranked = rankMemory({
        record,
        query: fixture.query,
        queryTokens,
        nowMs,
        channel: 'filesystem'
      })
      const signal = signals.get(record.id) ?? emptySignals()
      const retrievalFrequency = boundedLogFrequency(signal.retrievalCount)
      const confirmation = clamp01(signal.confirmationCount)
      const correction = clamp01(signal.correctionCount)
      const features: MemoryFeedbackFeatureVector = {
        lexical: ranked.features.lexical,
        scopeAffinity: ranked.features.scopeAffinity,
        typeAffinity: ranked.features.typeAffinity,
        freshness: ranked.features.freshness,
        importance: ranked.features.importance,
        confidence: ranked.features.confidence,
        retrievalFrequency,
        confirmation,
        correction,
        foundationScore: ranked.features.finalScore,
        candidateScore: clamp01(ranked.features.finalScore +
          retrievalFrequency * weights.retrievalFrequency +
          confirmation * weights.confirmation +
          correction * weights.correction)
      }
      return { ranked, features, relevant: hasPositiveMemoryRelevance(ranked, fixture.query) }
    })
}

function buildFeedbackSignals(events: readonly MemoryFeedbackEvent[]): Map<string, FeedbackSignals> {
  const signals = new Map<string, FeedbackSignals>()
  const get = (memoryId: string): FeedbackSignals => {
    const current = signals.get(memoryId)
    if (current) return current
    const created = emptySignals()
    signals.set(memoryId, created)
    return created
  }
  for (const event of events) {
    // One feedback event attributes to exactly one record, matching the
    // persisted aggregate projection: a correction counts against the
    // corrected (old) Memory, not the replacement it produced.
    const target = get(event.memoryId)
    if (event.kind === 'retrieved') target.retrievalCount += 1
    if (event.kind === 'confirmed') target.confirmationCount += 1
    if (event.kind === 'corrected') target.correctionCount += 1
  }
  return signals
}

function toTrace(
  fixture: MemoryFeedbackFixtureCase,
  candidate: MemoryFeedbackEvaluationTrace['candidate'],
  ranked: Array<{ ranked: RankedMemory; features: MemoryFeedbackFeatureVector }>,
  allRanked: Array<{ ranked: RankedMemory; features: MemoryFeedbackFeatureVector; relevant: boolean }>
): MemoryFeedbackEvaluationTrace {
  const selectedIds = ranked.slice(0, fixture.limit).map((item) => item.ranked.record.id)
  const selected = new Set(selectedIds)
  const rankedIds = new Set(ranked.map((item) => item.ranked.record.id))
  const unselected = allRanked
    .filter((item) => !rankedIds.has(item.ranked.record.id))
    .sort((left, right) => compareRankedMemories(left.ranked, right.ranked))
  return {
    caseId: fixture.id,
    candidate,
    rankings: [...ranked, ...unselected].map((item) => ({
      memoryId: item.ranked.record.id,
      features: item.features,
      selected: selected.has(item.ranked.record.id)
    })),
    selectedIds,
    forbiddenSelectedIds: selectedIds.filter((id) => fixture.forbiddenIds.includes(id))
  }
}

type CaseMetrics = Omit<MemoryFeedbackEvaluationMetrics, 'queryCount'>

function scoreCase(fixture: MemoryFeedbackFixtureCase, selectedIds: readonly string[]): CaseMetrics {
  const expected = new Set(fixture.expectedIds)
  const relevant = selectedIds.filter((id) => expected.has(id)).length
  const firstRelevant = selectedIds.findIndex((id) => expected.has(id))
  return {
    recallAtK: expected.size === 0 ? 1 : relevant / expected.size,
    precisionAtK: selectedIds.length === 0 ? (expected.size === 0 ? 1 : 0) : relevant / selectedIds.length,
    meanReciprocalRank: firstRelevant < 0 ? 0 : 1 / (firstRelevant + 1),
    forbiddenSelections: selectedIds.filter((id) => fixture.forbiddenIds.includes(id)).length
  }
}

function summarizeMetrics(metrics: readonly CaseMetrics[]): MemoryFeedbackEvaluationMetrics {
  const count = metrics.length
  if (count === 0) return { recallAtK: 0, precisionAtK: 0, meanReciprocalRank: 0, forbiddenSelections: 0, queryCount: 0 }
  return {
    recallAtK: round(metrics.reduce((sum, item) => sum + item.recallAtK, 0) / count),
    precisionAtK: round(metrics.reduce((sum, item) => sum + item.precisionAtK, 0) / count),
    meanReciprocalRank: round(metrics.reduce((sum, item) => sum + item.meanReciprocalRank, 0) / count),
    forbiddenSelections: metrics.reduce((sum, item) => sum + item.forbiddenSelections, 0),
    queryCount: count
  }
}

function boundedLogFrequency(retrievalCount: number): number {
  return clamp01(Math.log1p(Math.max(0, retrievalCount)) / Math.log1p(MEMORY_FEEDBACK_RETRIEVAL_LOG_CAP))
}

function emptySignals(): FeedbackSignals {
  return { retrievalCount: 0, confirmationCount: 0, correctionCount: 0 }
}

function clamp01(value: number): number {
  return Math.max(0, Math.min(1, Number.isFinite(value) ? value : 0))
}

function round(value: number): number {
  return Math.round(value * 1_000) / 1_000
}
