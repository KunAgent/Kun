import type {
  MemoryFeedbackTiebreakerCalibration,
  MemoryFeedbackTiebreakerDevelopmentArtifactValue,
  MemoryFeedbackTiebreakerLock,
  MemoryFeedbackTiebreakerPlan
} from './memory-feedback-tiebreaker-contracts.js'
import { validateMemoryFeedbackTiebreakerCandidateLock } from './memory-feedback-tiebreaker-lock.js'

export function runLockedMemoryFeedbackTiebreakerHoldout<T>(input: {
  lock: MemoryFeedbackTiebreakerLock
  plan: MemoryFeedbackTiebreakerPlan
  calibration: MemoryFeedbackTiebreakerCalibration
  development: MemoryFeedbackTiebreakerDevelopmentArtifactValue
  lockedAt: string
  independentReviewConfirmed: boolean
  evidenceExists: boolean
  evaluate: (selectedCandidateId: string) => T
}): T {
  const lock = validateMemoryFeedbackTiebreakerCandidateLock(input)
  if (!input.independentReviewConfirmed) {
    throw new Error('memory feedback tiebreaker holdout requires independent lock review')
  }
  if (input.evidenceExists) {
    throw new Error('memory feedback tiebreaker holdout evidence already exists')
  }
  return input.evaluate(lock.selectedCandidateId)
}
