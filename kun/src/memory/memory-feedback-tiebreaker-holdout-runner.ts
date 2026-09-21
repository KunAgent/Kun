import type { MemoryFeedbackTiebreakerEvidenceValue } from './memory-feedback-tiebreaker-contracts.js'

// Repeated real-data tests consumed v1. Preserve its historical artifact;
// never score it again. See holdout-execution-audit.md for the limitations.
export async function runMemoryFeedbackTiebreakerHoldout(_input: {
  outputDirectory: string
  independentReviewConfirmed: boolean
  lockedAt: string
}): Promise<MemoryFeedbackTiebreakerEvidenceValue> {
  throw new Error('Memory feedback tiebreaker v1 is retired: see holdout-execution-audit.md')
}
