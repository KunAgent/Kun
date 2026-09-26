import { readFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import {
  MemoryFeedbackTiebreakerCalibrationReport,
  MemoryFeedbackTiebreakerDecisionPlan,
  MemoryFeedbackTiebreakerDevelopmentArtifact,
  memoryFeedbackTiebreakerArtifactSha256
} from './memory-feedback-tiebreaker-contracts.js'
import {
  compactMemoryFeedbackTiebreakerDevelopmentReport,
  evaluateMemoryFeedbackTiebreakerDevelopment
} from './memory-feedback-tiebreaker-development.js'
import { loadMemoryFeedbackTiebreakerDataset } from './memory-feedback-tiebreaker-fixture-loader.js'

const fixturePath = (name: string) => fileURLToPath(new URL(`./fixtures/${name}`, import.meta.url))

describe('memory feedback tiebreaker deterministic replay', () => {
  it('keeps scores, selections, metrics, and compact hashes stable after replay', async () => {
    const input = await loadInput()
    const first = evaluateMemoryFeedbackTiebreakerDevelopment(input)
    const replay = evaluateMemoryFeedbackTiebreakerDevelopment({
      ...input,
      fixture: {
        ...input.fixture,
        records: [...input.fixture.records].reverse(),
        events: [...input.fixture.events].reverse()
      }
    })

    expect(replay).toEqual(first)
    expect(compactMemoryFeedbackTiebreakerDevelopmentReport(replay))
      .toEqual(compactMemoryFeedbackTiebreakerDevelopmentReport(first))
  })

  it('preserves canonical hashes through JSON serialization and schema parsing', async () => {
    const input = await loadInput()
    const report = compactMemoryFeedbackTiebreakerDevelopmentReport(
      evaluateMemoryFeedbackTiebreakerDevelopment(input)
    )
    const serialized = JSON.stringify(report)
    const parsed = MemoryFeedbackTiebreakerDevelopmentArtifact.parse(JSON.parse(serialized))

    expect(parsed).toEqual(report)
    expect(memoryFeedbackTiebreakerArtifactSha256(parsed))
      .toBe(memoryFeedbackTiebreakerArtifactSha256(report))
    expect(memoryFeedbackTiebreakerArtifactSha256(JSON.parse(JSON.stringify(parsed))))
      .toBe(memoryFeedbackTiebreakerArtifactSha256(parsed))
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
