import { readFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import {
  MemoryFeedbackTiebreakerCalibrationReport,
  MemoryFeedbackTiebreakerDevelopmentArtifact,
  MemoryFeedbackTiebreakerDecisionPlan
} from './memory-feedback-tiebreaker-contracts.js'
import {
  compactMemoryFeedbackTiebreakerDevelopmentReport,
  evaluateMemoryFeedbackTiebreakerDevelopment
} from './memory-feedback-tiebreaker-development.js'
import { loadMemoryFeedbackTiebreakerDataset } from './memory-feedback-tiebreaker-fixture-loader.js'

const calibrationPath = fileURLToPath(new URL(
  './fixtures/memory-feedback-tiebreaker-calibration.v1.json',
  import.meta.url
))
const planPath = fileURLToPath(new URL(
  './fixtures/memory-feedback-tiebreaker-plan.v1.json',
  import.meta.url
))
const developmentPath = fileURLToPath(new URL(
  './fixtures/memory-feedback-tiebreaker-development.v1.json',
  import.meta.url
))

describe('memory feedback tiebreaker development evaluation', () => {
  it('evaluates every frozen candidate deterministically without holdout results', async () => {
    const input = await loadInput()
    const first = evaluateMemoryFeedbackTiebreakerDevelopment(input)
    const second = evaluateMemoryFeedbackTiebreakerDevelopment(input)

    expect(first).toEqual(second)
    expect(first.candidates).toHaveLength(7)
    expect(first.candidates.map((candidate) => candidate.candidateId))
      .toEqual(input.plan.candidates.map((candidate) => candidate.id))
    expect(first.candidates.every((candidate) => candidate.cases.length === 18)).toBe(true)
    expect(first.candidates.flatMap((candidate) => candidate.cases)
      .every((item) => item.caseId.startsWith('case_dev_'))).toBe(true)
  })

  it('keeps traces bounded to synthetic ids and numeric features', async () => {
    const report = evaluateMemoryFeedbackTiebreakerDevelopment(await loadInput())
    const serialized = JSON.stringify(report)

    expect(serialized).not.toContain('"query"')
    expect(serialized).not.toContain('"content"')
    expect(serialized).not.toContain('"sources"')
    expect(report.candidates.every((candidate) => candidate.cases.every((item) =>
      item.rankings.length <= 64))).toBe(true)
  })

  it('compacts every configuration with a deterministic selected-id digest', async () => {
    const input = await loadInput()
    const report = evaluateMemoryFeedbackTiebreakerDevelopment(input)
    const compact = compactMemoryFeedbackTiebreakerDevelopmentReport(report)

    expect(compact.configurations).toHaveLength(input.plan.candidates.length)
    expect(compact.configurations.map((item) => item.candidateId))
      .toEqual(input.plan.candidates.map((item) => item.id))
    expect(compact.configurations.every((item) => /^[a-f0-9]{64}$/u.test(item.selectedIdsSha256))).toBe(true)
  })

  it('matches the frozen development artifact', async () => {
    const report = compactMemoryFeedbackTiebreakerDevelopmentReport(
      evaluateMemoryFeedbackTiebreakerDevelopment(await loadInput())
    )
    const frozen = MemoryFeedbackTiebreakerDevelopmentArtifact.parse(
      JSON.parse(await readFile(developmentPath, 'utf8'))
    )

    expect(frozen).toEqual(report)
  })
})

async function loadInput() {
  const dataset = await loadMemoryFeedbackTiebreakerDataset()
  const [calibrationText, planText] = await Promise.all([
    readFile(calibrationPath, 'utf8'),
    readFile(planPath, 'utf8')
  ])
  return {
    fixture: dataset.fixture,
    fixtureSha256: dataset.sourceHashes.fixture,
    manifestSha256: dataset.sourceHashes.manifest,
    calibration: MemoryFeedbackTiebreakerCalibrationReport.parse(JSON.parse(calibrationText)),
    plan: MemoryFeedbackTiebreakerDecisionPlan.parse(JSON.parse(planText))
  }
}
