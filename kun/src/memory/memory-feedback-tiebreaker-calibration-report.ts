import {
  MEMORY_FEEDBACK_TIEBREAKER_CALIBRATION_PROCEDURE,
  deriveMemoryFeedbackTiebreakerBoundaries
} from './memory-feedback-tiebreaker-calibration.js'
import {
  MemoryFeedbackTiebreakerCalibrationReport,
  type MemoryFeedbackTiebreakerCalibration,
  type MemoryFeedbackTiebreakerFixture
} from './memory-feedback-tiebreaker-contracts.js'
import { rankMemoryFeedbackTiebreakerDevelopment } from './memory-feedback-tiebreaker-foundation.js'

export const MEMORY_FEEDBACK_TIEBREAKER_FOUNDATION_VERSION = 'post-1308-foundation-v1'

export function createMemoryFeedbackTiebreakerCalibrationReport(input: {
  fixture: MemoryFeedbackTiebreakerFixture
  fixtureSha256: string
}): MemoryFeedbackTiebreakerCalibration {
  const observedGaps = rankMemoryFeedbackTiebreakerDevelopment(input.fixture)
    .flatMap((result) => result.gaps.map((gap) => ({ caseId: result.caseId, ...gap })))
    .sort((left, right) => left.caseId.localeCompare(right.caseId) ||
      left.higherId.localeCompare(right.higherId) || left.lowerId.localeCompare(right.lowerId))

  return MemoryFeedbackTiebreakerCalibrationReport.parse({
    schemaVersion: 1,
    evaluationVersion: 'p3-feedback-tiebreaker-v1',
    fixtureSha256: input.fixtureSha256,
    foundationVersion: MEMORY_FEEDBACK_TIEBREAKER_FOUNDATION_VERSION,
    procedure: MEMORY_FEEDBACK_TIEBREAKER_CALIBRATION_PROCEDURE,
    observedGaps,
    boundaryGrid: deriveMemoryFeedbackTiebreakerBoundaries(observedGaps.map((item) => item.gap))
  })
}
