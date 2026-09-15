import { describe, expect, it } from 'vitest'
import { memoryFeedbackPairedBootstrapLowerBound } from './memory-feedback-tiebreaker-bootstrap.js'

describe('memory feedback paired bootstrap', () => {
  it('produces deterministic paired lower bounds', () => {
    const input = {
      baseline: [0, 1, 0, 1],
      candidate: [1, 1, 0, 1],
      seed: 20260916,
      resamples: 2_000,
      confidenceLevel: 0.95
    }
    const first = memoryFeedbackPairedBootstrapLowerBound(input)
    const second = memoryFeedbackPairedBootstrapLowerBound(input)

    expect(first).toEqual(second)
    expect(first.pointEstimate).toBe(0.25)
    expect(first.lowerBound).toBeLessThanOrEqual(first.pointEstimate)
  })

  it('retains an exact lower bound for a constant paired gain', () => {
    expect(memoryFeedbackPairedBootstrapLowerBound({
      baseline: [0, 0.25, 0.5, 0.75],
      candidate: [0.25, 0.5, 0.75, 1],
      seed: 0,
      resamples: 1_000,
      confidenceLevel: 0.95
    })).toMatchObject({ pointEstimate: 0.25, lowerBound: 0.25 })
  })

  it('rejects unpaired or invalid bootstrap requests', () => {
    expect(() => memoryFeedbackPairedBootstrapLowerBound({
      baseline: [1], candidate: [], seed: 1, resamples: 1_000, confidenceLevel: 0.95
    })).toThrow(/equal non-empty/u)
    expect(() => memoryFeedbackPairedBootstrapLowerBound({
      baseline: [1], candidate: [1], seed: 1, resamples: 0, confidenceLevel: 0.95
    })).toThrow(/positive integer/u)
  })
})
