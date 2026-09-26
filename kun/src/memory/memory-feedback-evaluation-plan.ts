import { readFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import { z } from 'zod'
import {
  MEMORY_FEEDBACK_EVALUATION_VERSION,
  MEMORY_FEEDBACK_EVALUATION_WEIGHTS
} from './memory-feedback-evaluation.js'
import {
  loadMemoryFeedbackFixtures,
  DEFAULT_MEMORY_FEEDBACK_FIXTURE_PATHS,
  memoryFeedbackFixtureSha256,
  type MemoryFeedbackFixtureDataset
} from './memory-feedback-fixtures.js'

const Hash = z.string().regex(/^[a-f0-9]{64}$/u)
const Candidate = z.object({
  id: z.enum(['foundation', 'feedback-additive-v1']),
  kind: z.string().min(1),
  formula: z.string().min(1)
}).strict()

const Plan = z.object({
  schemaVersion: z.literal(1),
  evaluationVersion: z.literal(MEMORY_FEEDBACK_EVALUATION_VERSION),
  decisionId: z.string().regex(/^kun-memory-[a-z0-9-]+$/u),
  status: z.literal('pre-registered'),
  fixtureDatasetId: z.string().min(1),
  fixtureSha256: Hash,
  partitions: z.object({
    development: z.array(z.string().min(1)).min(1),
    holdout: z.array(z.string().min(1)).min(1)
  }).strict(),
  candidates: z.array(Candidate).length(2),
  features: z.object({
    retrievalFrequency: z.literal('clamp01(log1p(retrievalCount)/log1p(16))'),
    confirmation: z.literal('clamp01(confirmationCount)'),
    correction: z.literal('clamp01(correctionCount)'),
    canonical: z.array(z.enum(['freshness', 'importance', 'confidence'])).length(3)
  }).strict(),
  gates: z.object({
    development: z.object({
      minimumRecallGain: z.number().min(-1).max(1),
      minimumMrrGain: z.number().min(-1).max(1),
      maximumPrecisionDecline: z.number().min(0).max(1),
      maximumForbiddenSelections: z.literal(0)
    }).strict(),
    holdout: z.object({
      minimumRecallGainLowerBound: z.number().min(-1).max(1),
      minimumMrrGainLowerBound: z.number().min(-1).max(1),
      maximumPrecisionDecline: z.number().min(0).max(1),
      maximumForbiddenSelections: z.literal(0)
    }).strict(),
    safety: z.object({
      maximumScopeOrLifecycleLeaks: z.literal(0),
      maximumUnboundedFeatureValues: z.literal(0),
      productionRankingChanges: z.literal(0)
    }).strict(),
    privacy: z.object({
      queryTextInTrace: z.literal(false),
      memoryContentInTrace: z.literal(false),
      localPathInTrace: z.literal(false),
      credentialInTrace: z.literal(false)
    }).strict(),
    resource: z.object({
      maximumTraceRankings: z.number().int().positive().max(64),
      maximumEvaluationMilliseconds: z.number().int().positive()
    }).strict()
  }).strict(),
  bootstrap: z.object({
    method: z.literal('paired-percentile-lower-bound'),
    seed: z.number().int().nonnegative().max(0xffffffff),
    resamples: z.number().int().positive(),
    confidenceLevel: z.number().gt(0).lt(1),
    unit: z.literal('case'),
    holdoutRuns: z.literal(1)
  }).strict(),
  production: z.object({
    rankingWeightsChanged: z.literal(false),
    dormantFeatureFlagAdded: z.literal(false),
    evaluatorImportAllowedFrom: z.array(z.string().min(1)).min(1)
  }).strict()
}).strict()

const Checksums = z.object({
  schemaVersion: z.literal(1),
  evaluationVersion: z.literal(MEMORY_FEEDBACK_EVALUATION_VERSION),
  algorithm: z.literal('sha256'),
  fixtureSha256: Hash,
  manifestSha256: Hash
}).strict()

export type MemoryFeedbackEvaluationPlan = z.infer<typeof Plan>

export const DEFAULT_MEMORY_FEEDBACK_EVALUATION_PLAN_PATHS = Object.freeze({
  manifest: fileURLToPath(new URL('./fixtures/memory-feedback-evaluation-plan.v1.json', import.meta.url)),
  checksums: fileURLToPath(new URL('./fixtures/memory-feedback-evaluation-checksums.v1.json', import.meta.url))
})

export async function loadMemoryFeedbackEvaluationPlan(
  paths = DEFAULT_MEMORY_FEEDBACK_EVALUATION_PLAN_PATHS,
  fixturePaths = DEFAULT_MEMORY_FEEDBACK_FIXTURE_PATHS
): Promise<{ plan: MemoryFeedbackEvaluationPlan; fixture: MemoryFeedbackFixtureDataset; sourceHashes: { manifest: string; fixture: string } }> {
  const [manifestText, checksumsText, fixture] = await Promise.all([
    readFile(paths.manifest, 'utf8'),
    readFile(paths.checksums, 'utf8'),
    loadMemoryFeedbackFixtures(fixturePaths)
  ])
  const plan = Plan.parse(parseJson(manifestText, 'evaluation plan'))
  const checksums = Checksums.parse(parseJson(checksumsText, 'evaluation checksums'))
  const manifestSha256 = sha256(manifestText)
  if (checksums.manifestSha256 !== manifestSha256) throw new Error('memory feedback evaluation manifest checksum mismatch')
  if (checksums.fixtureSha256 !== fixture.fixtureSha256 || plan.fixtureSha256 !== fixture.fixtureSha256) {
    throw new Error('memory feedback evaluation fixture checksum mismatch')
  }
  if (plan.fixtureDatasetId !== 'kun-memory-feedback-anonymous-v1') {
    throw new Error('memory feedback evaluation fixture dataset mismatch')
  }
  validatePartitions(plan, fixture)
  validateCandidateFormula(plan)
  return { plan, fixture, sourceHashes: { manifest: manifestSha256, fixture: fixture.fixtureSha256 } }
}

function validatePartitions(plan: MemoryFeedbackEvaluationPlan, fixture: MemoryFeedbackFixtureDataset): void {
  const expected = new Set(fixture.cases.map((item) => item.id))
  const partitionIds = [...plan.partitions.development, ...plan.partitions.holdout]
  if (new Set(partitionIds).size !== partitionIds.length) throw new Error('feedback evaluation partitions overlap')
  if (partitionIds.some((id) => !expected.has(id)) || partitionIds.length !== expected.size) {
    throw new Error('feedback evaluation partitions do not cover the frozen cases')
  }
}

function validateCandidateFormula(plan: MemoryFeedbackEvaluationPlan): void {
  const foundation = plan.candidates.find((candidate) => candidate.id === 'foundation')
  const feedback = plan.candidates.find((candidate) => candidate.id === 'feedback-additive-v1')
  if (foundation?.formula !== 'foundationScore' || feedback?.formula !==
      'clamp01(foundationScore + retrievalFrequency*0.05 + confirmation*0.1 + correction*0.1)') {
    throw new Error('feedback evaluation formula is not pre-registered')
  }
  if (JSON.stringify(MEMORY_FEEDBACK_EVALUATION_WEIGHTS) !==
      JSON.stringify({ retrievalFrequency: 0.05, confirmation: 0.1, correction: 0.1 })) {
    throw new Error('feedback evaluator weights changed unexpectedly')
  }
}

function parseJson(text: string, name: string): unknown {
  try {
    return JSON.parse(text) as unknown
  } catch {
    throw new Error(`invalid memory feedback ${name} JSON`)
  }
}

function sha256(text: string): string {
  return memoryFeedbackFixtureSha256(text)
}
