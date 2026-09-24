import { describe, expect, it } from 'vitest'
import {
  MEMORY_FEEDBACK_TIEBREAKER_DATASET_ID,
  MEMORY_FEEDBACK_TIEBREAKER_EVALUATION_VERSION,
  MemoryFeedbackTiebreakerCalibrationReport,
  MemoryFeedbackTiebreakerCandidateLock,
  MemoryFeedbackTiebreakerDecisionPlan,
  MemoryFeedbackTiebreakerEvidence,
  MemoryFeedbackTiebreakerFixtureFile,
  MemoryFeedbackTiebreakerManifest,
  memoryFeedbackTiebreakerArtifactSha256
} from './memory-feedback-tiebreaker-contracts.js'
import {
  MEMORY_FEEDBACK_TIEBREAKER_CALIBRATION_PROCEDURE,
  buildMemoryFeedbackTiebreakerCandidates,
  compareMemoryFeedbackTiebreakerItems,
  deriveMemoryFeedbackTiebreakerBoundaries
} from './memory-feedback-tiebreaker-calibration.js'

const HASH_A = 'a'.repeat(64)
const HASH_B = 'b'.repeat(64)
const EVALUATION_NOW = '2026-09-16T00:00:00.000Z'

describe('memory feedback tie-breaker contracts', () => {
  it('strictly validates every versioned artifact shape', () => {
    const fixture = makeFixture()
    const manifest = makeManifest()
    const calibration = makeCalibration()
    const plan = makePlan()
    const lock = makeLock()
    const evidence = makeEvidence()

    expect(MemoryFeedbackTiebreakerFixtureFile.parse(fixture).cases).toHaveLength(2)
    expect(MemoryFeedbackTiebreakerManifest.parse(manifest).splitCounts).toEqual({ development: 1, holdout: 1 })
    expect(MemoryFeedbackTiebreakerCalibrationReport.parse(calibration).boundaryGrid[0]?.maximumGap).toBe(0)
    expect(MemoryFeedbackTiebreakerDecisionPlan.parse(plan).production.evaluatorOnly).toBe(true)
    expect(MemoryFeedbackTiebreakerCandidateLock.parse(lock).holdoutRunLimit).toBe(1)
    expect(MemoryFeedbackTiebreakerEvidence.parse(evidence).decision).toBe('no-go')

    expect(() => MemoryFeedbackTiebreakerFixtureFile.parse({ ...fixture, unexpected: true })).toThrow()
    expect(() => MemoryFeedbackTiebreakerFixtureFile.parse({ ...fixture, schemaVersion: 2 })).toThrow()
    expect(() => MemoryFeedbackTiebreakerCandidateLock.parse({
      ...lock,
      artifactHashes: { ...lock.artifactHashes, fixtureSha256: 'not-a-hash' }
    })).toThrow()
  })

  it('rejects duplicate identities and invalid references before evaluation', () => {
    const fixture = makeFixture()
    expect(() => MemoryFeedbackTiebreakerFixtureFile.parse({
      ...fixture,
      records: [...fixture.records, fixture.records[0]]
    })).toThrow(/record ids must be unique/u)
    expect(() => MemoryFeedbackTiebreakerFixtureFile.parse({
      ...fixture,
      cases: [{ ...fixture.cases[0], expectedIds: ['missing'] }, fixture.cases[1]]
    })).toThrow(/unknown memory/u)
  })

  it('derives a finite deterministic boundary grid with exact-tie control', () => {
    const boundaries = deriveMemoryFeedbackTiebreakerBoundaries([0.04, 0.01, 0.03, 0.02])
    expect(boundaries).toEqual([
      { id: 'gap_0', maximumGap: 0, inclusive: true },
      { id: 'gap_1', maximumGap: 0.01, inclusive: true },
      { id: 'gap_2', maximumGap: 0.02, inclusive: true },
      { id: 'gap_3', maximumGap: 0.03, inclusive: true }
    ])
    expect(deriveMemoryFeedbackTiebreakerBoundaries([Number.NaN, -1, 2])).toEqual([
      { id: 'gap_0', maximumGap: 0, inclusive: true }
    ])
    expect(MEMORY_FEEDBACK_TIEBREAKER_CALIBRATION_PROCEDURE.maximumReorderWindow).toBe(3)
  })

  it('keeps retrieval frequency shadow-only in candidates and comparison', () => {
    const [boundary] = deriveMemoryFeedbackTiebreakerBoundaries([0.02])
    const candidates = buildMemoryFeedbackTiebreakerCandidates([boundary!])
    expect(candidates).toHaveLength(3)
    expect(candidates.every((candidate) => !candidate.orderingSignals.includes('retrieval-frequency' as never))).toBe(true)
    expect(candidates.every((candidate) => candidate.shadowSignals[0] === 'retrieval-frequency')).toBe(true)

    const base = {
      memoryId: 'memory-a',
      foundationScore: 0.5,
      confirmationCount: 0,
      correctionCount: 0,
      retrievalCount: 0
    }
    const other = { ...base, memoryId: 'memory-b', foundationScore: 0.49, retrievalCount: 1 }
    const frequent = { ...other, retrievalCount: 1_000_000 }
    expect(compareMemoryFeedbackTiebreakerItems(base, other, 'confirmation')).toBe(
      compareMemoryFeedbackTiebreakerItems(base, frequent, 'confirmation')
    )
  })

  it('changes the plan hash when a gate or candidate rule changes', () => {
    const plan = MemoryFeedbackTiebreakerDecisionPlan.parse(makePlan())
    const changedGate = {
      ...plan,
      gates: {
        ...plan.gates,
        localBenefit: { ...plan.gates.localBenefit, minimumPairAccuracyGain: 0.2 }
      }
    }
    const changedCandidate = {
      ...plan,
      candidates: plan.candidates.map((candidate, index) => index === 1
        ? { ...candidate, signalRule: 'confirmation-correction', orderingSignals: ['confirmation', 'correction'] }
        : candidate)
    }
    const originalHash = memoryFeedbackTiebreakerArtifactSha256(plan)
    expect(memoryFeedbackTiebreakerArtifactSha256(changedGate)).not.toBe(originalHash)
    expect(memoryFeedbackTiebreakerArtifactSha256(changedCandidate)).not.toBe(originalHash)
  })
})

function makeFixture() {
  const records = [makeRecord('memory-a'), makeRecord('memory-b')]
  return {
    schemaVersion: 1,
    datasetId: MEMORY_FEEDBACK_TIEBREAKER_DATASET_ID,
    status: 'frozen',
    evaluationNow: EVALUATION_NOW,
    records,
    events: [{
      schemaVersion: 1,
      id: 'event-confirm-a',
      kind: 'confirmed',
      memoryId: 'memory-a',
      occurredAt: '2026-09-01T00:00:00.000Z'
    }],
    cases: [makeCase('case_development', 'development'), makeCase('case_holdout', 'holdout')]
  }
}

function makeRecord(id: string) {
  return {
    schemaVersion: 2,
    id,
    content: `Synthetic content for ${id}.`,
    scope: 'workspace',
    workspace: 'fixture-workspace',
    tags: ['synthetic'],
    confidence: 0.8,
    type: 'fact',
    authority: 'reference',
    importance: 0.5,
    observedAt: '2026-01-01T00:00:00.000Z',
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    sources: [{ id: 'synthetic-source', kind: 'user', trust: 'explicit-user' }]
  }
}

function makeCase(id: string, partition: 'development' | 'holdout') {
  return {
    id,
    partition,
    stratum: 'confirmed-near-tie',
    query: `Synthetic query for ${partition}.`,
    workspace: 'fixture-workspace',
    candidateIds: ['memory-a', 'memory-b'],
    expectedIds: ['memory-a'],
    forbiddenIds: [],
    preferredPairs: [{ preferredId: 'memory-a', otherId: 'memory-b', rationale: 'Synthetic preference.' }],
    rationale: 'Synthetic contract case.',
    limit: 1,
    promptCharacterBudget: 1_000
  }
}

function makeManifest() {
  return {
    schemaVersion: 1,
    evaluationVersion: MEMORY_FEEDBACK_TIEBREAKER_EVALUATION_VERSION,
    datasetId: MEMORY_FEEDBACK_TIEBREAKER_DATASET_ID,
    status: 'frozen',
    evaluationNow: EVALUATION_NOW,
    normalization: {
      unicode: 'NFKC',
      caseFold: 'unicode-lowercase',
      punctuation: 'strip',
      nearDuplicateTokenJaccard: 0.75
    },
    splitCounts: { development: 1, holdout: 1 },
    stratumQuotas: [{ stratum: 'confirmed-near-tie', development: 1, holdout: 1 }],
    fixtureSha256: HASH_A
  }
}

function makeCalibration() {
  return {
    schemaVersion: 1,
    evaluationVersion: MEMORY_FEEDBACK_TIEBREAKER_EVALUATION_VERSION,
    fixtureSha256: HASH_A,
    foundationVersion: 'post-1308-lexical-foundation',
    procedure: MEMORY_FEEDBACK_TIEBREAKER_CALIBRATION_PROCEDURE,
    observedGaps: [],
    boundaryGrid: [{ id: 'gap_0', maximumGap: 0, inclusive: true }]
  }
}

function makePlan() {
  const boundaries = [{ id: 'gap_0', maximumGap: 0, inclusive: true }]
  return {
    schemaVersion: 1,
    evaluationVersion: MEMORY_FEEDBACK_TIEBREAKER_EVALUATION_VERSION,
    decisionId: 'kun-memory-feedback-tiebreaker-v1',
    status: 'pre-registered',
    artifactHashes: { fixtureSha256: HASH_A, manifestSha256: HASH_B, calibrationSha256: HASH_A },
    partitions: { development: ['case_development'], holdout: ['case_holdout'] },
    candidates: buildMemoryFeedbackTiebreakerCandidates(boundaries),
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
      localBenefit: { minimumPairAccuracyGain: 0.1, minimumPairAccuracyGainLowerBound: 0 },
      globalNonRegression: {
        minimumRecallGainLowerBound: -0.01,
        minimumMrrGainLowerBound: -0.01,
        maximumPrecisionDecline: 0.01,
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
      resource: { maximumEvaluationMilliseconds: 1_000, maximumTraceRankings: 64, maximumEvidenceBytes: 1_000_000 }
    },
    bootstrap: {
      method: 'paired-percentile-lower-bound',
      seed: 20260916,
      resamples: 2_000,
      confidenceLevel: 0.95,
      unit: 'case',
      holdoutRuns: 1
    },
    production: { rankingChanged: false, dormantFeatureFlagAdded: false, evaluatorOnly: true }
  }
}

function makeLock() {
  return {
    schemaVersion: 1,
    evaluationVersion: MEMORY_FEEDBACK_TIEBREAKER_EVALUATION_VERSION,
    decisionId: 'kun-memory-feedback-tiebreaker-v1',
    status: 'locked',
    artifactHashes: {
      fixtureSha256: HASH_A,
      manifestSha256: HASH_B,
      calibrationSha256: HASH_A,
      decisionPlanSha256: HASH_B,
      developmentReportSha256: HASH_A
    },
    selectedCandidateId: 'foundation-control',
    gates: makePlan().gates,
    evaluatorIdentity: 'memory-feedback-tiebreaker-v1',
    bootstrapSeed: 20260916,
    holdoutRunLimit: 1,
    lockedAt: EVALUATION_NOW
  }
}

function makeEvidence() {
  const metrics = {
    pairAccuracy: 0.5,
    pairCount: 1,
    recallAtK: 1,
    precisionAtK: 1,
    meanReciprocalRank: 1,
    abstentionAccuracy: 1,
    explicitForbiddenSelections: 0,
    authorizationOrLifecycleViolations: 0,
    rankedCaseCount: 1,
    noResultCaseCount: 0,
    caseCount: 1
  }
  const partition = {
    foundation: metrics,
    candidate: metrics,
    bootstrapLowerBounds: { pairAccuracyGain: 0, recallGain: 0, mrrGain: 0 },
    gates: {
      localBenefit: false,
      globalNonRegression: true,
      safety: true,
      privacy: true,
      determinism: true,
      resource: true,
      passed: false
    }
  }
  return {
    schemaVersion: 1,
    evaluationVersion: MEMORY_FEEDBACK_TIEBREAKER_EVALUATION_VERSION,
    decisionId: 'kun-memory-feedback-tiebreaker-v1',
    status: 'final',
    artifactHashes: {
      fixtureSha256: HASH_A,
      manifestSha256: HASH_B,
      calibrationSha256: HASH_A,
      decisionPlanSha256: HASH_B,
      candidateLockSha256: HASH_A
    },
    selectedCandidateId: 'foundation-control',
    holdoutRunCount: 1,
    development: partition,
    holdout: partition,
    decision: 'no-go',
    reasons: ['Synthetic contract evidence.']
  }
}
