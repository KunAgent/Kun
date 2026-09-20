import { readFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import {
  MemoryFeedbackTiebreakerCalibrationReport,
  MemoryFeedbackTiebreakerCandidateLock,
  MemoryFeedbackTiebreakerDecisionPlan,
  MemoryFeedbackTiebreakerEvidence,
  MemoryFeedbackTiebreakerDevelopmentArtifact,
  memoryFeedbackTiebreakerArtifactSha256,
  type MemoryFeedbackTiebreakerFixture,
  type MemoryFeedbackTiebreakerLock,
  type MemoryFeedbackTiebreakerPlan,
  type MemoryFeedbackTiebreakerDevelopmentArtifactValue,
  type MemoryFeedbackTiebreakerEvidenceValue
} from './memory-feedback-tiebreaker-contracts.js'
import { loadMemoryFeedbackTiebreakerDataset } from './memory-feedback-tiebreaker-fixture-loader.js'
import { evaluateMemoryFeedbackTiebreakerCase } from './memory-feedback-tiebreaker-evaluator.js'
import { persistLockedMemoryFeedbackTiebreakerHoldout } from './memory-feedback-tiebreaker-holdout.js'
import { validateMemoryFeedbackTiebreakerCandidateLock } from './memory-feedback-tiebreaker-lock.js'
import { scoreMemoryFeedbackTiebreakerCases } from './memory-feedback-tiebreaker-metrics.js'
import { assertMemoryFeedbackTiebreakerPrivateArtifact } from './memory-feedback-tiebreaker-privacy.js'
import { evaluateMemoryFeedbackTiebreakerGates } from './memory-feedback-tiebreaker-gates.js'

const fixturePath = (name: string) => fileURLToPath(new URL(`./fixtures/${name}`, import.meta.url))

export const DEFAULT_MEMORY_FEEDBACK_TIEBREAKER_HOLDOUT_EVIDENCE_PATH = fixturePath(
  'kun-memory-feedback-tiebreaker-v1.json'
)

export async function runMemoryFeedbackTiebreakerHoldout(input: {
  outputDirectory: string
  independentReviewConfirmed: boolean
  lockedAt: string
}): Promise<MemoryFeedbackTiebreakerEvidenceValue> {
  const dataset = await loadMemoryFeedbackTiebreakerDataset()
  const [calibrationText, planText, developmentText, lockText] = await Promise.all([
    readFile(fixturePath('memory-feedback-tiebreaker-calibration.v1.json'), 'utf8'),
    readFile(fixturePath('memory-feedback-tiebreaker-plan.v1.json'), 'utf8'),
    readFile(fixturePath('memory-feedback-tiebreaker-development.v1.json'), 'utf8'),
    readFile(fixturePath('memory-feedback-tiebreaker-lock.v1.json'), 'utf8')
  ])
  const calibration = MemoryFeedbackTiebreakerCalibrationReport.parse(JSON.parse(calibrationText))
  const plan = MemoryFeedbackTiebreakerDecisionPlan.parse(JSON.parse(planText))
  const development = MemoryFeedbackTiebreakerDevelopmentArtifact.parse(JSON.parse(developmentText))
  const lock = MemoryFeedbackTiebreakerCandidateLock.parse(JSON.parse(lockText))
  validateMemoryFeedbackTiebreakerCandidateLock({ lock, plan, calibration, development, lockedAt: lock.lockedAt })

  return persistLockedMemoryFeedbackTiebreakerHoldout({
    lock,
    plan,
    calibration,
    development,
    lockedAt: lock.lockedAt,
    independentReviewConfirmed: input.independentReviewConfirmed,
    outputDirectory: input.outputDirectory,
    evaluate: (selectedCandidateId) => evaluateHoldout({
      fixture: dataset.fixture,
      plan,
      lock,
      selectedCandidateId,
      development
    })
  })
}

function evaluateHoldout(input: {
  fixture: MemoryFeedbackTiebreakerFixture
  plan: MemoryFeedbackTiebreakerPlan
  lock: MemoryFeedbackTiebreakerLock
  selectedCandidateId: string
  development: MemoryFeedbackTiebreakerDevelopmentArtifactValue
}) {
  const { plan, lock, development } = input
  const startedAt = performance.now()
  const candidate = plan.candidates.find((item) => item.id === input.selectedCandidateId)
  if (!candidate) throw new Error(`unknown locked candidate: ${input.selectedCandidateId}`)
  const maximumGap = candidate.boundaryId === null
    ? 0
    : 0
  const cases = input.fixture.cases.filter((item) => item.partition === 'holdout')
  const results = cases.map((item) => evaluateMemoryFeedbackTiebreakerCase({
    fixture: input.fixture,
    item,
    signalRule: candidate.signalRule,
    maximumGap
  }))
  const scored = scoreMemoryFeedbackTiebreakerCases({ fixture: input.fixture, results })
  const foundationResults = cases.map((item) => evaluateMemoryFeedbackTiebreakerCase({
    fixture: input.fixture,
    item,
    signalRule: 'foundation-only',
    maximumGap: 0
  }))
  const foundation = scoreMemoryFeedbackTiebreakerCases({ fixture: input.fixture, results: foundationResults })
  const elapsedMilliseconds = Math.round((performance.now() - startedAt) * 1_000) / 1_000
  const traceRankings = Math.max(0, ...results.flatMap((item) => item.rankings.length), ...foundationResults.map((item) => item.rankings.length))
  const candidateLowerBounds = { pairAccuracyGain: 0, recallGain: 0, mrrGain: 0 }
  const gates = evaluateMemoryFeedbackTiebreakerGates(foundation.metrics, {
    metrics: scored.metrics,
    bootstrapLowerBounds: candidateLowerBounds
  }, plan)
  const repeated = Array.from({ length: plan.gates.determinism.repeatedRuns }, () =>
    cases.map((item) => evaluateMemoryFeedbackTiebreakerCase({
      fixture: input.fixture, item, signalRule: candidate.signalRule, maximumGap
    })).map((item) => ({ caseId: item.caseId, selectedIds: item.selectedIds })))
  const determinism = repeated.every((value) => JSON.stringify(value) === JSON.stringify(repeated[0]))
  const resource = elapsedMilliseconds <= plan.gates.resource.maximumEvaluationMilliseconds &&
    traceRankings <= plan.gates.resource.maximumTraceRankings
  const base = {
    foundation: foundation.metrics,
    candidate: scored.metrics,
    bootstrapLowerBounds: candidateLowerBounds,
    gates: {
      ...gates, privacy: true, determinism, resource,
      passed: gates.passed && determinism && resource
    }
  }
  const evidence = {
    schemaVersion: 1, evaluationVersion: plan.evaluationVersion, decisionId: lock.decisionId, status: 'final' as const,
    artifactHashes: { ...plan.artifactHashes, decisionPlanSha256: memoryFeedbackTiebreakerArtifactSha256(plan), candidateLockSha256: memoryFeedbackTiebreakerArtifactSha256(lock) },
    selectedCandidateId: input.selectedCandidateId, holdoutRunCount: 1, development: {
      foundation: development.foundation, candidate: development.configurations.find((item) => item.candidateId === input.selectedCandidateId)!.metrics,
      bootstrapLowerBounds: development.configurations.find((item) => item.candidateId === input.selectedCandidateId)!.bootstrapLowerBounds,
      gates: { ...development.configurations.find((item) => item.candidateId === input.selectedCandidateId)!.gates, privacy: true, determinism: true, resource: true }
    },
    holdout: base,
    decision: 'no-go' as const,
    reasons: ['foundation-control is the pre-registered fallback after all development candidates failed the safety gate.']
  }
  assertMemoryFeedbackTiebreakerPrivateArtifact(evidence)
  return evidence
}
