import {
  MemoryFeedbackTiebreakerCalibrationProcedure,
  MemoryFeedbackTiebreakerCandidate,
  type MemoryFeedbackTiebreakerCandidateValue,
  type MemoryFeedbackTiebreakerSignalRuleValue
} from './memory-feedback-tiebreaker-contracts.js'

export const MEMORY_FEEDBACK_TIEBREAKER_CALIBRATION_PROCEDURE =
  MemoryFeedbackTiebreakerCalibrationProcedure.parse({
    source: 'development-foundation-only',
    gapFormula: 'higher-score-minus-lower-score',
    quantiles: [0.25, 0.5, 0.75],
    quantileMethod: 'floor-index',
    maximumGridSize: 4,
    boundaryInclusive: true,
    grouping: 'leader-relative',
    maximumReorderWindow: 3,
    exactTieControl: true,
    noRerankControl: true,
    stableFallback: ['foundation-score', 'memory-id']
  })

export type MemoryFeedbackTiebreakerItem = {
  memoryId: string
  foundationScore: number
  confirmationCount: number
  correctionCount: number
  retrievalCount: number
  lastRetrievedAt?: string
}

export function deriveMemoryFeedbackTiebreakerBoundaries(gaps: readonly number[]): Array<{
  id: string
  maximumGap: number
  inclusive: true
}> {
  const sorted = gaps
    .filter((gap) => Number.isFinite(gap) && gap >= 0 && gap <= 1)
    .map((gap) => round(gap))
    .sort((left, right) => left - right)
  const values = [0, ...MEMORY_FEEDBACK_TIEBREAKER_CALIBRATION_PROCEDURE.quantiles.map((quantile) =>
    sorted[Math.floor(quantile * Math.max(0, sorted.length - 1))] ?? 0)]
  return [...new Set(values)]
    .slice(0, MEMORY_FEEDBACK_TIEBREAKER_CALIBRATION_PROCEDURE.maximumGridSize)
    .map((maximumGap, index) => ({ id: `gap_${index}`, maximumGap, inclusive: true }))
}

export function buildMemoryFeedbackTiebreakerCandidates(
  boundaries: ReadonlyArray<{ id: string }>
): MemoryFeedbackTiebreakerCandidateValue[] {
  const shadowSignals = ['retrieval-frequency', 'last-retrieved-at'] as const
  const candidates: unknown[] = [{
    id: 'foundation-control',
    kind: 'foundation-control',
    boundaryId: null,
    signalRule: 'foundation-only',
    orderingSignals: [],
    shadowSignals
  }]
  for (const boundary of boundaries) {
    candidates.push({
      id: `confirmation-${boundary.id}`,
      kind: 'near-tie-rerank',
      boundaryId: boundary.id,
      signalRule: 'confirmation',
      orderingSignals: ['confirmation'],
      shadowSignals
    }, {
      id: `confirmation-correction-${boundary.id}`,
      kind: 'near-tie-rerank',
      boundaryId: boundary.id,
      signalRule: 'confirmation-correction',
      orderingSignals: ['confirmation', 'correction'],
      shadowSignals
    })
  }
  return candidates.map((candidate) => MemoryFeedbackTiebreakerCandidate.parse(candidate))
}

export function compareMemoryFeedbackTiebreakerItems(
  left: MemoryFeedbackTiebreakerItem,
  right: MemoryFeedbackTiebreakerItem,
  signalRule: MemoryFeedbackTiebreakerSignalRuleValue
): number {
  const evidence = evidencePriority(right, signalRule) - evidencePriority(left, signalRule)
  if (evidence !== 0) return evidence
  const foundation = finiteScore(right.foundationScore) - finiteScore(left.foundationScore)
  if (foundation !== 0) return foundation
  return left.memoryId < right.memoryId ? -1 : left.memoryId > right.memoryId ? 1 : 0
}

function evidencePriority(
  item: MemoryFeedbackTiebreakerItem,
  signalRule: MemoryFeedbackTiebreakerSignalRuleValue
): number {
  if (signalRule === 'confirmation-correction' && item.correctionCount > 0) return 2
  if (signalRule !== 'foundation-only' && item.confirmationCount > 0) return 1
  return 0
}

function finiteScore(value: number): number {
  return Number.isFinite(value) ? value : 0
}

function round(value: number): number {
  return Math.round(value * 1_000_000) / 1_000_000
}
