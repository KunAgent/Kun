import { readFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import {
  MemoryFeedbackTiebreakerCalibrationReport,
  memoryFeedbackTiebreakerArtifactSha256
} from './memory-feedback-tiebreaker-contracts.js'
import { createMemoryFeedbackTiebreakerCalibrationReport } from './memory-feedback-tiebreaker-calibration-report.js'
import { loadMemoryFeedbackTiebreakerDataset } from './memory-feedback-tiebreaker-fixture-loader.js'

describe('memory feedback tiebreaker calibration report', () => {
  it('derives a deterministic finite boundary grid from development foundation gaps only', async () => {
    const dataset = await loadMemoryFeedbackTiebreakerDataset()
    const first = createMemoryFeedbackTiebreakerCalibrationReport({
      fixture: dataset.fixture,
      fixtureSha256: dataset.sourceHashes.fixture
    })
    const second = createMemoryFeedbackTiebreakerCalibrationReport({
      fixture: dataset.fixture,
      fixtureSha256: dataset.sourceHashes.fixture
    })

    expect(first).toEqual(second)
    expect(first.boundaryGrid[0]?.maximumGap).toBe(0)
    expect(first.boundaryGrid.length).toBeLessThanOrEqual(4)
    expect(first.observedGaps.length).toBeGreaterThan(0)
    expect(first.observedGaps.every((gap) => gap.caseId.startsWith('case_dev_'))).toBe(true)
    expect(memoryFeedbackTiebreakerArtifactSha256(first))
      .toBe(memoryFeedbackTiebreakerArtifactSha256(second))
  })

  it('matches the frozen baseline-only calibration artifact', async () => {
    const dataset = await loadMemoryFeedbackTiebreakerDataset()
    const generated = createMemoryFeedbackTiebreakerCalibrationReport({
      fixture: dataset.fixture,
      fixtureSha256: dataset.sourceHashes.fixture
    })
    const path = fileURLToPath(new URL(
      './fixtures/memory-feedback-tiebreaker-calibration.v1.json',
      import.meta.url
    ))
    const frozen = MemoryFeedbackTiebreakerCalibrationReport.parse(JSON.parse(await readFile(path, 'utf8')))

    expect(frozen).toEqual(generated)
  })
})
