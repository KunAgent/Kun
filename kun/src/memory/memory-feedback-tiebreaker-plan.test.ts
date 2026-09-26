import { readFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import {
  MemoryFeedbackTiebreakerCalibrationReport,
  MemoryFeedbackTiebreakerDecisionPlan,
  memoryFeedbackTiebreakerArtifactSha256
} from './memory-feedback-tiebreaker-contracts.js'
import { loadMemoryFeedbackTiebreakerDataset } from './memory-feedback-tiebreaker-fixture-loader.js'
import { createMemoryFeedbackTiebreakerDecisionPlan } from './memory-feedback-tiebreaker-plan.js'

const calibrationPath = fileURLToPath(new URL(
  './fixtures/memory-feedback-tiebreaker-calibration.v1.json',
  import.meta.url
))
const planPath = fileURLToPath(new URL(
  './fixtures/memory-feedback-tiebreaker-plan.v1.json',
  import.meta.url
))

describe('memory feedback tiebreaker decision plan', () => {
  it('pre-registers every candidate and gate before development candidate scoring', async () => {
    const dataset = await loadMemoryFeedbackTiebreakerDataset()
    const calibration = MemoryFeedbackTiebreakerCalibrationReport.parse(
      JSON.parse(await readFile(calibrationPath, 'utf8'))
    )
    const plan = createMemoryFeedbackTiebreakerDecisionPlan({
      fixture: dataset.fixture,
      fixtureSha256: dataset.sourceHashes.fixture,
      manifestSha256: dataset.sourceHashes.manifest,
      calibration
    })

    expect(plan.candidates).toHaveLength(7)
    expect(plan.partitions.development).toHaveLength(18)
    expect(plan.partitions.holdout).toHaveLength(18)
    expect(plan.gates.localBenefit.minimumPairAccuracyGain).toBe(0.25)
    expect(plan.gates.globalNonRegression.minimumRecallGainLowerBound).toBe(0)
    expect(plan.bootstrap).toMatchObject({ seed: 20260916, resamples: 10_000, holdoutRuns: 1 })
    expect(plan.production).toEqual({
      rankingChanged: false,
      dormantFeatureFlagAdded: false,
      evaluatorOnly: true
    })
  })

  it('matches the frozen pre-registered plan artifact', async () => {
    const dataset = await loadMemoryFeedbackTiebreakerDataset()
    const calibration = MemoryFeedbackTiebreakerCalibrationReport.parse(
      JSON.parse(await readFile(calibrationPath, 'utf8'))
    )
    const generated = createMemoryFeedbackTiebreakerDecisionPlan({
      fixture: dataset.fixture,
      fixtureSha256: dataset.sourceHashes.fixture,
      manifestSha256: dataset.sourceHashes.manifest,
      calibration
    })
    const frozen = MemoryFeedbackTiebreakerDecisionPlan.parse(JSON.parse(await readFile(planPath, 'utf8')))

    expect(frozen).toEqual(generated)
  })

  it('changes identity when any gate or candidate definition changes', async () => {
    const dataset = await loadMemoryFeedbackTiebreakerDataset()
    const calibration = MemoryFeedbackTiebreakerCalibrationReport.parse(
      JSON.parse(await readFile(calibrationPath, 'utf8'))
    )
    const plan = createMemoryFeedbackTiebreakerDecisionPlan({
      fixture: dataset.fixture,
      fixtureSha256: dataset.sourceHashes.fixture,
      manifestSha256: dataset.sourceHashes.manifest,
      calibration
    })
    const changed = {
      ...plan,
      gates: {
        ...plan.gates,
        localBenefit: { ...plan.gates.localBenefit, minimumPairAccuracyGain: 0.5 }
      }
    }

    expect(memoryFeedbackTiebreakerArtifactSha256(changed))
      .not.toBe(memoryFeedbackTiebreakerArtifactSha256(plan))
  })
})
