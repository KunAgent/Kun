import { describe, expect, it } from 'vitest'
import { loadMemoryFeedbackFixtures } from './memory-feedback-fixtures.js'
import {
  evaluateMemoryFeedbackCandidate,
  MEMORY_FEEDBACK_RETRIEVAL_LOG_CAP,
  MEMORY_FEEDBACK_EVALUATION_VERSION
} from './memory-feedback-evaluation.js'

describe('offline memory feedback evaluation', () => {
  it('traces bounded feedback features separately from the lexical foundation', async () => {
    const result = evaluateMemoryFeedbackCandidate(await loadMemoryFeedbackFixtures())
    const foundation = result.traces.find((trace) => trace.candidate === 'foundation')!
    const candidate = result.traces.find((trace) => trace.candidate === 'feedback')!
    const frequent = candidate.rankings.find((item) => item.memoryId === 'mem_feedback_frequent')!
    const confirmed = candidate.rankings.find((item) => item.memoryId === 'mem_feedback_confirmed')!
    const replacement = candidate.rankings.find((item) => item.memoryId === 'mem_feedback_replacement')!

    expect(result.version).toBe(MEMORY_FEEDBACK_EVALUATION_VERSION)
    expect(result.foundation.queryCount).toBe(4)
    expect(result.candidate.queryCount).toBe(4)
    expect(frequent.features.retrievalFrequency).toBeCloseTo(
      Math.log1p(3) / Math.log1p(MEMORY_FEEDBACK_RETRIEVAL_LOG_CAP)
    )
    expect(frequent.features.confirmation).toBe(0)
    expect(confirmed.features.confirmation).toBe(1)
    // A correction attributes to the corrected record only, matching the
    // persisted aggregate; the replacement carries no correction count.
    expect(replacement.features.correction).toBe(0)
    expect(frequent.features.foundationScore).toBeGreaterThanOrEqual(0)
    expect(frequent.features.candidateScore).toBeGreaterThanOrEqual(frequent.features.foundationScore)
    expect(foundation.selectedIds).not.toContain('mem_feedback_disabled')
    expect(candidate.selectedIds).not.toContain('mem_feedback_cross_scope')
    expect(candidate.forbiddenSelectedIds).toEqual([])
  })

  it('is deterministic for the same frozen fixture and never changes production retrieval', async () => {
    const dataset = await loadMemoryFeedbackFixtures()
    const first = evaluateMemoryFeedbackCandidate(dataset)
    const second = evaluateMemoryFeedbackCandidate(dataset)
    expect(second).toEqual(first)
    expect(first.traces.every((trace) => trace.rankings.every((item) => item.memoryId))).toBe(true)
  })
})
