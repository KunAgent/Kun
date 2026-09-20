import { describe, expect, it } from 'vitest'
import { DEFAULT_MEMORY_FEEDBACK_TIEBREAKER_HOLDOUT_EVIDENCE_PATH, runMemoryFeedbackTiebreakerHoldout } from './memory-feedback-tiebreaker-holdout-runner.js'
import { dirname } from 'node:path'

describe('memory feedback tiebreaker reviewed execution', () => {
  it('publishes the single immutable holdout evidence artifact when explicitly enabled', async () => {
    if (process.env.KUN_RUN_REVIEWED_HOLDOUT !== '1') return
    const evidence = await runMemoryFeedbackTiebreakerHoldout({
      outputDirectory: dirname(DEFAULT_MEMORY_FEEDBACK_TIEBREAKER_HOLDOUT_EVIDENCE_PATH),
      independentReviewConfirmed: true,
      lockedAt: '2026-09-16T00:00:00.000Z'
    })
    expect(evidence.selectedCandidateId).toBe('foundation-control')
    expect(evidence.holdoutRunCount).toBe(1)
  })
})
