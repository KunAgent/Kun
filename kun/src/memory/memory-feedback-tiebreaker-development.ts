import { memoryFeedbackPairedBootstrapLowerBound } from './memory-feedback-tiebreaker-bootstrap.js'
import type {
  MemoryFeedbackTiebreakerCalibration,
  MemoryFeedbackTiebreakerCandidateValue,
  MemoryFeedbackTiebreakerDevelopmentArtifactValue,
  MemoryFeedbackTiebreakerFixture,
  MemoryFeedbackTiebreakerPlan
} from './memory-feedback-tiebreaker-contracts.js'
import { memoryFeedbackTiebreakerArtifactSha256 } from './memory-feedback-tiebreaker-contracts.js'
import {
  evaluateMemoryFeedbackTiebreakerCase,
  type MemoryFeedbackTiebreakerCaseResult
} from './memory-feedback-tiebreaker-evaluator.js'
import { rankMemoryFeedbackTiebreakerFoundationCase } from './memory-feedback-tiebreaker-foundation.js'
import {
  scoreMemoryFeedbackTiebreakerCases,
  type MemoryFeedbackTiebreakerCaseMetrics,
  type MemoryFeedbackTiebreakerMetrics
} from './memory-feedback-tiebreaker-metrics.js'

type LowerBounds = {
  pairAccuracyGain: number
  recallGain: number
  mrrGain: number
}

export type MemoryFeedbackTiebreakerDevelopmentCandidate = {
  candidateId: string
  boundaryId: string | null
  maximumGap: number
  signalRule: MemoryFeedbackTiebreakerCandidateValue['signalRule']
  metrics: MemoryFeedbackTiebreakerMetrics
  bootstrapLowerBounds: LowerBounds
  gates: {
    localBenefit: boolean
    globalNonRegression: boolean
    safety: boolean
    passed: boolean
  }
  cases: MemoryFeedbackTiebreakerCaseResult[]
}

export type MemoryFeedbackTiebreakerDevelopmentReport = {
  schemaVersion: 1
  evaluationVersion: 'p3-feedback-tiebreaker-v1'
  partition: 'development'
  artifactHashes: {
    fixtureSha256: string
    manifestSha256: string
    calibrationSha256: string
    decisionPlanSha256: string
  }
  foundation: {
    metrics: MemoryFeedbackTiebreakerMetrics
    cases: MemoryFeedbackTiebreakerCaseResult[]
  }
  candidates: MemoryFeedbackTiebreakerDevelopmentCandidate[]
}

export function evaluateMemoryFeedbackTiebreakerDevelopment(input: {
  fixture: MemoryFeedbackTiebreakerFixture
  fixtureSha256: string
  manifestSha256: string
  calibration: MemoryFeedbackTiebreakerCalibration
  plan: MemoryFeedbackTiebreakerPlan
}): MemoryFeedbackTiebreakerDevelopmentReport {
  const cases = input.fixture.cases.filter((item) => item.partition === 'development')
  const foundationCases = cases.map((item) => {
    const foundation = rankMemoryFeedbackTiebreakerFoundationCase(input.fixture, item)
    return {
      caseId: item.id,
      signalRule: 'foundation-only' as const,
      maximumGap: 0,
      rankings: foundation.rankings.map((ranking) => ({
        memoryId: ranking.memoryId,
        foundationScore: ranking.foundationScore,
        confirmationCount: 0,
        correctionCount: 0,
        retrievalCount: 0,
        selected: ranking.selected
      })),
      selectedIds: foundation.selectedIds,
      forbiddenSelectedIds: foundation.selectedIds.filter((id) => item.forbiddenIds.includes(id)),
      selectedCharacters: foundation.trace.selectedCharacters
    }
  })
  const foundationScored = scoreMemoryFeedbackTiebreakerCases({ fixture: input.fixture, results: foundationCases })
  const candidates = input.plan.candidates.map((candidate) => evaluateCandidate({
    fixture: input.fixture,
    cases,
    candidate,
    calibration: input.calibration,
    plan: input.plan,
    foundationMetrics: foundationScored.metrics,
    foundationCases: foundationScored.cases
  }))

  return {
    schemaVersion: 1,
    evaluationVersion: 'p3-feedback-tiebreaker-v1',
    partition: 'development',
    artifactHashes: {
      fixtureSha256: input.fixtureSha256,
      manifestSha256: input.manifestSha256,
      calibrationSha256: memoryFeedbackTiebreakerArtifactSha256(input.calibration),
      decisionPlanSha256: memoryFeedbackTiebreakerArtifactSha256(input.plan)
    },
    foundation: { metrics: foundationScored.metrics, cases: foundationCases },
    candidates
  }
}

export function compactMemoryFeedbackTiebreakerDevelopmentReport(
  report: MemoryFeedbackTiebreakerDevelopmentReport
): MemoryFeedbackTiebreakerDevelopmentArtifactValue {
  return {
    schemaVersion: 1,
    evaluationVersion: report.evaluationVersion,
    partition: 'development',
    artifactHashes: report.artifactHashes,
    foundation: report.foundation.metrics,
    configurations: report.candidates.map((candidate) => ({
      candidateId: candidate.candidateId,
      boundaryId: candidate.boundaryId,
      maximumGap: candidate.maximumGap,
      signalRule: candidate.signalRule,
      metrics: candidate.metrics,
      bootstrapLowerBounds: candidate.bootstrapLowerBounds,
      gates: candidate.gates,
      selectedIdsSha256: memoryFeedbackTiebreakerArtifactSha256(candidate.cases.map((item) => ({
        caseId: item.caseId,
        selectedIds: item.selectedIds
      })))
    }))
  }
}

function evaluateCandidate(input: {
  fixture: MemoryFeedbackTiebreakerFixture
  cases: MemoryFeedbackTiebreakerFixture['cases']
  candidate: MemoryFeedbackTiebreakerCandidateValue
  calibration: MemoryFeedbackTiebreakerCalibration
  plan: MemoryFeedbackTiebreakerPlan
  foundationMetrics: MemoryFeedbackTiebreakerMetrics
  foundationCases: MemoryFeedbackTiebreakerCaseMetrics[]
}): MemoryFeedbackTiebreakerDevelopmentCandidate {
  const maximumGap = input.candidate.boundaryId === null
    ? 0
    : input.calibration.boundaryGrid.find((boundary) => boundary.id === input.candidate.boundaryId)?.maximumGap
  if (maximumGap === undefined) throw new Error(`unknown tiebreaker boundary: ${input.candidate.boundaryId}`)
  const cases = input.cases.map((item) => evaluateMemoryFeedbackTiebreakerCase({
    fixture: input.fixture,
    item,
    signalRule: input.candidate.signalRule,
    maximumGap
  }))
  const scored = scoreMemoryFeedbackTiebreakerCases({ fixture: input.fixture, results: cases })
  const lowerBounds = bootstrapLowerBounds(input.foundationCases, scored.cases, input.plan)
  const pointPairGain = scored.metrics.pairAccuracy - input.foundationMetrics.pairAccuracy
  const localBenefit = pointPairGain >= input.plan.gates.localBenefit.minimumPairAccuracyGain &&
    lowerBounds.pairAccuracyGain >= input.plan.gates.localBenefit.minimumPairAccuracyGainLowerBound
  const globalNonRegression = lowerBounds.recallGain >= input.plan.gates.globalNonRegression.minimumRecallGainLowerBound &&
    lowerBounds.mrrGain >= input.plan.gates.globalNonRegression.minimumMrrGainLowerBound &&
    input.foundationMetrics.precisionAtK - scored.metrics.precisionAtK <=
      input.plan.gates.globalNonRegression.maximumPrecisionDecline &&
    input.foundationMetrics.abstentionAccuracy - scored.metrics.abstentionAccuracy <=
      input.plan.gates.globalNonRegression.maximumAbstentionDecline
  const safety = scored.metrics.explicitForbiddenSelections <=
    input.plan.gates.safety.maximumExplicitForbiddenSelections &&
    scored.metrics.authorizationOrLifecycleViolations <=
      input.plan.gates.safety.maximumAuthorizationOrLifecycleViolations

  return {
    candidateId: input.candidate.id,
    boundaryId: input.candidate.boundaryId,
    maximumGap,
    signalRule: input.candidate.signalRule,
    metrics: scored.metrics,
    bootstrapLowerBounds: lowerBounds,
    gates: { localBenefit, globalNonRegression, safety, passed: localBenefit && globalNonRegression && safety },
    cases
  }
}

function bootstrapLowerBounds(
  foundation: readonly MemoryFeedbackTiebreakerCaseMetrics[],
  candidate: readonly MemoryFeedbackTiebreakerCaseMetrics[],
  plan: MemoryFeedbackTiebreakerPlan
): LowerBounds {
  return {
    pairAccuracyGain: bootstrapMetric(foundation, candidate, 'pairCorrect', plan),
    recallGain: bootstrapMetric(foundation, candidate, 'recallAtK', plan),
    mrrGain: bootstrapMetric(foundation, candidate, 'reciprocalRank', plan)
  }
}

function bootstrapMetric(
  foundation: readonly MemoryFeedbackTiebreakerCaseMetrics[],
  candidate: readonly MemoryFeedbackTiebreakerCaseMetrics[],
  key: 'pairCorrect' | 'recallAtK' | 'reciprocalRank',
  plan: MemoryFeedbackTiebreakerPlan
): number {
  const candidateById = new Map(candidate.map((item) => [item.caseId, item]))
  const pairs = foundation.flatMap((item) => {
    const right = candidateById.get(item.caseId)
    const leftValue = item[key]
    const rightValue = right?.[key]
    return leftValue === undefined || rightValue === undefined ? [] : [[leftValue, rightValue] as const]
  })
  if (pairs.length === 0) return 0
  return memoryFeedbackPairedBootstrapLowerBound({
    baseline: pairs.map(([left]) => left),
    candidate: pairs.map(([, right]) => right),
    seed: plan.bootstrap.seed,
    resamples: plan.bootstrap.resamples,
    confidenceLevel: plan.bootstrap.confidenceLevel
  }).lowerBound
}
