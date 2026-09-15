import {
  MemoryFeedbackTiebreakerCandidateLock,
  memoryFeedbackTiebreakerArtifactSha256,
  type MemoryFeedbackTiebreakerCalibration,
  type MemoryFeedbackTiebreakerDevelopmentArtifactValue,
  type MemoryFeedbackTiebreakerLock,
  type MemoryFeedbackTiebreakerPlan
} from './memory-feedback-tiebreaker-contracts.js'
import { MEMORY_FEEDBACK_TIEBREAKER_FOUNDATION_VERSION } from './memory-feedback-tiebreaker-calibration-report.js'

export const MEMORY_FEEDBACK_TIEBREAKER_EVALUATOR_IDENTITY =
  `memory-feedback-tiebreaker-v1|foundation=${MEMORY_FEEDBACK_TIEBREAKER_FOUNDATION_VERSION}|grouping=leader-relative`

export function createMemoryFeedbackTiebreakerCandidateLock(input: {
  plan: MemoryFeedbackTiebreakerPlan
  calibration: MemoryFeedbackTiebreakerCalibration
  development: MemoryFeedbackTiebreakerDevelopmentArtifactValue
  lockedAt: string
}): MemoryFeedbackTiebreakerLock {
  validateDependencies(input)
  const selectedCandidateId = selectCandidate(input.development, input.plan)
  return MemoryFeedbackTiebreakerCandidateLock.parse({
    schemaVersion: 1,
    evaluationVersion: 'p3-feedback-tiebreaker-v1',
    decisionId: input.plan.decisionId,
    status: 'locked',
    artifactHashes: {
      ...input.plan.artifactHashes,
      decisionPlanSha256: memoryFeedbackTiebreakerArtifactSha256(input.plan),
      developmentReportSha256: memoryFeedbackTiebreakerArtifactSha256(input.development)
    },
    selectedCandidateId,
    gates: input.plan.gates,
    evaluatorIdentity: MEMORY_FEEDBACK_TIEBREAKER_EVALUATOR_IDENTITY,
    bootstrapSeed: input.plan.bootstrap.seed,
    holdoutRunLimit: input.plan.bootstrap.holdoutRuns,
    lockedAt: input.lockedAt
  })
}

function validateDependencies(input: {
  plan: MemoryFeedbackTiebreakerPlan
  calibration: MemoryFeedbackTiebreakerCalibration
  development: MemoryFeedbackTiebreakerDevelopmentArtifactValue
}): void {
  if (input.plan.artifactHashes.calibrationSha256 !==
      memoryFeedbackTiebreakerArtifactSha256(input.calibration)) {
    throw new Error('memory feedback tiebreaker calibration hash mismatch')
  }
  const expectedDevelopmentHashes = {
    ...input.plan.artifactHashes,
    decisionPlanSha256: memoryFeedbackTiebreakerArtifactSha256(input.plan)
  }
  if (memoryFeedbackTiebreakerArtifactSha256(input.development.artifactHashes) !==
      memoryFeedbackTiebreakerArtifactSha256(expectedDevelopmentHashes)) {
    throw new Error('memory feedback tiebreaker development dependency hash mismatch')
  }
}

export function validateMemoryFeedbackTiebreakerCandidateLock(input: {
  lock: unknown
  plan: MemoryFeedbackTiebreakerPlan
  calibration: MemoryFeedbackTiebreakerCalibration
  development: MemoryFeedbackTiebreakerDevelopmentArtifactValue
  lockedAt: string
}): MemoryFeedbackTiebreakerLock {
  const lock = MemoryFeedbackTiebreakerCandidateLock.parse(input.lock)
  const expected = createMemoryFeedbackTiebreakerCandidateLock(input)
  if (memoryFeedbackTiebreakerArtifactSha256(lock) !== memoryFeedbackTiebreakerArtifactSha256(expected)) {
    throw new Error('memory feedback tiebreaker candidate lock does not match its dependencies')
  }
  return lock
}

function selectCandidate(
  development: MemoryFeedbackTiebreakerDevelopmentArtifactValue,
  plan: MemoryFeedbackTiebreakerPlan
): string {
  const eligible = development.configurations.filter((candidate) => candidate.gates.passed)
  eligible.sort((left, right) =>
    right.bootstrapLowerBounds.pairAccuracyGain - left.bootstrapLowerBounds.pairAccuracyGain ||
    (right.metrics.pairAccuracy - development.foundation.pairAccuracy) -
      (left.metrics.pairAccuracy - development.foundation.pairAccuracy) ||
    left.maximumGap - right.maximumGap ||
    left.candidateId.localeCompare(right.candidateId))
  const selected = eligible[0]?.candidateId ?? plan.selectionRule.fallback
  if (!plan.candidates.some((candidate) => candidate.id === selected)) {
    throw new Error(`selected tiebreaker candidate is not pre-registered: ${selected}`)
  }
  return selected
}
