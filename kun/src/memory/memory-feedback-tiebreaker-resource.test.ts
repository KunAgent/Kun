import { readFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import {
  MemoryFeedbackTiebreakerCalibrationReport,
  MemoryFeedbackTiebreakerDecisionPlan
} from './memory-feedback-tiebreaker-contracts.js'
import { loadMemoryFeedbackTiebreakerDataset } from './memory-feedback-tiebreaker-fixture-loader.js'
import {
  evaluateAndMeasureMemoryFeedbackTiebreakerResources,
  measureMemoryFeedbackTiebreakerResources
} from './memory-feedback-tiebreaker-resource.js'

const fixturePath = (name: string) => fileURLToPath(new URL(`./fixtures/${name}`, import.meta.url))

describe('memory feedback tiebreaker resource gates', () => {
  it('passes the frozen development evaluation under its resource ceilings', async () => {
    const input = await loadInput()
    const result = evaluateAndMeasureMemoryFeedbackTiebreakerResources(input)

    expect(result.measurement.passed).toBe(true)
    expect(result.measurement.maximumTraceRankings).toBeLessThanOrEqual(
      input.plan.gates.resource.maximumTraceRankings
    )
    expect(result.measurement.evidenceBytes).toBeLessThanOrEqual(
      input.plan.gates.resource.maximumEvidenceBytes
    )
  })

  it('fails an over-limit synthetic trace without truncating evidence', async () => {
    const input = await loadInput()
    const result = evaluateAndMeasureMemoryFeedbackTiebreakerResources(input)
    const firstCase = result.report.candidates[0]!.cases[0]!
    const overLimitReport = {
      ...result.report,
      candidates: result.report.candidates.map((candidate, index) => index === 0
        ? {
            ...candidate,
            cases: [{
              ...firstCase,
              rankings: Array.from({ length: 65 }, () => firstCase.rankings[0]!)
            }]
          }
        : candidate)
    }
    const constrainedPlan = {
      ...input.plan,
      gates: {
        ...input.plan.gates,
        resource: {
          ...input.plan.gates.resource,
          maximumTraceRankings: 1,
          maximumEvidenceBytes: 1
        }
      }
    }

    const measurement = measureMemoryFeedbackTiebreakerResources({
      report: overLimitReport,
      evidence: result.evidence,
      elapsedMilliseconds: 0,
      plan: constrainedPlan
    })

    expect(measurement.passed).toBe(false)
    expect(measurement.failures).toEqual(['trace-rankings', 'evidence-bytes'])
    expect(measurement.evidenceBytes).toBeGreaterThan(1)
    expect(result.evidence.configurations).toHaveLength(input.plan.candidates.length)
  })
})

async function loadInput() {
  const dataset = await loadMemoryFeedbackTiebreakerDataset()
  const [calibrationText, planText] = await Promise.all([
    readFile(fixturePath('memory-feedback-tiebreaker-calibration.v1.json'), 'utf8'),
    readFile(fixturePath('memory-feedback-tiebreaker-plan.v1.json'), 'utf8')
  ])
  return {
    fixture: dataset.fixture,
    fixtureSha256: dataset.sourceHashes.fixture,
    manifestSha256: dataset.sourceHashes.manifest,
    calibration: MemoryFeedbackTiebreakerCalibrationReport.parse(JSON.parse(calibrationText)),
    plan: MemoryFeedbackTiebreakerDecisionPlan.parse(JSON.parse(planText))
  }
}
