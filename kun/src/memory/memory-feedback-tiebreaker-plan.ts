import {
  MemoryFeedbackTiebreakerDecisionPlan,
  memoryFeedbackTiebreakerArtifactSha256,
  type MemoryFeedbackTiebreakerCalibration,
  type MemoryFeedbackTiebreakerFixture,
  type MemoryFeedbackTiebreakerPlan
} from './memory-feedback-tiebreaker-contracts.js'
import { buildMemoryFeedbackTiebreakerCandidates } from './memory-feedback-tiebreaker-calibration.js'

export const MEMORY_FEEDBACK_TIEBREAKER_DECISION_ID = 'kun-memory-feedback-tiebreaker-v1'

export function createMemoryFeedbackTiebreakerDecisionPlan(input: {
  fixture: MemoryFeedbackTiebreakerFixture
  fixtureSha256: string
  manifestSha256: string
  calibration: MemoryFeedbackTiebreakerCalibration
}): MemoryFeedbackTiebreakerPlan {
  return MemoryFeedbackTiebreakerDecisionPlan.parse({
    schemaVersion: 1,
    evaluationVersion: 'p3-feedback-tiebreaker-v1',
    decisionId: MEMORY_FEEDBACK_TIEBREAKER_DECISION_ID,
    status: 'pre-registered',
    artifactHashes: {
      fixtureSha256: input.fixtureSha256,
      manifestSha256: input.manifestSha256,
      calibrationSha256: memoryFeedbackTiebreakerArtifactSha256(input.calibration)
    },
    partitions: {
      development: partitionIds(input.fixture, 'development'),
      holdout: partitionIds(input.fixture, 'holdout')
    },
    candidates: buildMemoryFeedbackTiebreakerCandidates(input.calibration.boundaryGrid),
    selectionRule: {
      orderBy: [
        'all-required-gates',
        'pair-accuracy-lower-bound',
        'pair-accuracy-point-estimate',
        'smallest-boundary',
        'candidate-id'
      ],
      fallback: 'foundation-control'
    },
    gates: {
      localBenefit: {
        minimumPairAccuracyGain: 0.25,
        minimumPairAccuracyGainLowerBound: 0.001
      },
      globalNonRegression: {
        minimumRecallGainLowerBound: 0,
        minimumMrrGainLowerBound: 0,
        maximumPrecisionDecline: 0,
        maximumAbstentionDecline: 0
      },
      safety: {
        maximumExplicitForbiddenSelections: 0,
        maximumAuthorizationOrLifecycleViolations: 0,
        maximumProductionRankingChanges: 0
      },
      privacy: {
        queryTextInTrace: false,
        memoryContentInTrace: false,
        sourceExcerptInTrace: false,
        machinePathInTrace: false,
        credentialInTrace: false
      },
      determinism: { repeatedRuns: 3, numericTolerance: 0.000001 },
      resource: {
        maximumEvaluationMilliseconds: 5_000,
        maximumTraceRankings: 64,
        maximumEvidenceBytes: 1_000_000
      }
    },
    bootstrap: {
      method: 'paired-percentile-lower-bound',
      seed: 20260916,
      resamples: 10_000,
      confidenceLevel: 0.95,
      unit: 'case',
      holdoutRuns: 1
    },
    production: {
      rankingChanged: false,
      dormantFeatureFlagAdded: false,
      evaluatorOnly: true
    }
  })
}

function partitionIds(
  fixture: MemoryFeedbackTiebreakerFixture,
  partition: 'development' | 'holdout'
): string[] {
  return fixture.cases
    .filter((item) => item.partition === partition)
    .map((item) => item.id)
    .sort()
}
