import { describe, expect, it } from 'vitest'
import { evaluateMoaSamples } from './moa-eval-runner.js'

describe('MoA paired evaluation', () => {
  it('reports a positive blinded quality interval within the cost budget', () => {
    const report = evaluateMoaSamples([
      sample(0.70, 0.84, 1.8),
      sample(0.72, 0.87, 1.9),
      sample(0.68, 0.82, 1.7),
      sample(0.74, 0.88, 2.0)
    ], { seed: 42, maxCostMultiplier: 2.2 })

    expect(report).toMatchObject({ sampleCount: 4, blinded: true, withinBudget: true })
    expect(report.qualityDelta.confidenceLow).toBeGreaterThan(0)
    expect(report.latencyMs.moaP95).toBeGreaterThanOrEqual(report.latencyMs.moaP50)
  })
})

function sample(baselineScore: number, moaScore: number, costMultiplier: number) {
  return {
    id: `${baselineScore}`,
    prompt: 'Evaluate a complex request',
    baselineScore,
    moaScore,
    baselineLatencyMs: 1000,
    moaLatencyMs: 1800,
    baselineCostUsd: 0.01,
    moaCostUsd: 0.01 * costMultiplier
  }
}
