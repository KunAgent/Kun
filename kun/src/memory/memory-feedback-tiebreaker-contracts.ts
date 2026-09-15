import { createHash } from 'node:crypto'
import { z } from 'zod'
import { MemoryFeedbackEvent } from '../contracts/memory-feedback.js'
import { MemoryRecord } from '../contracts/memory.js'

export const MEMORY_FEEDBACK_TIEBREAKER_DATASET_ID = 'kun-memory-feedback-tiebreaker-anonymous-v1'
export const MEMORY_FEEDBACK_TIEBREAKER_EVALUATION_VERSION = 'p3-feedback-tiebreaker-v1'

const Hash = z.string().regex(/^[a-f0-9]{64}$/u)
const ArtifactId = z.string().regex(/^[a-z0-9][a-z0-9_-]*$/u)
const Partition = z.enum(['development', 'holdout'])
const Stratum = z.enum([
  'confirmed-near-tie',
  'corrected-replacement-near-tie',
  'frequent-unconfirmed-control',
  'no-feedback-control',
  'wide-gap-control',
  'no-result-control',
  'scope-safety',
  'lifecycle-safety',
  'misleading-feedback-control'
])

const PreferredPair = z.object({
  preferredId: z.string().min(1),
  otherId: z.string().min(1),
  rationale: z.string().min(1).max(512)
}).strict()

const FixtureCase = z.object({
  id: z.string().regex(/^case_[a-z0-9_]+$/u),
  partition: Partition,
  stratum: Stratum,
  query: z.string().min(1).max(512),
  workspace: z.string().min(1).max(256),
  candidateIds: z.array(z.string().min(1)).min(1).max(64),
  expectedIds: z.array(z.string().min(1)).max(64),
  forbiddenIds: z.array(z.string().min(1)).max(64),
  preferredPairs: z.array(PreferredPair).max(64),
  rationale: z.string().min(1).max(1_024),
  limit: z.number().int().positive().max(64),
  promptCharacterBudget: z.number().int().positive().max(64_000)
}).strict()

export const MemoryFeedbackTiebreakerFixtureFile = z.object({
  schemaVersion: z.literal(1),
  datasetId: z.literal(MEMORY_FEEDBACK_TIEBREAKER_DATASET_ID),
  status: z.literal('frozen'),
  evaluationNow: z.string().datetime(),
  records: z.array(MemoryRecord).min(1),
  events: z.array(MemoryFeedbackEvent),
  cases: z.array(FixtureCase).min(2)
}).strict().superRefine((fixture, context) => {
  reportDuplicates(fixture.records.map((record) => record.id), 'record id', context)
  reportDuplicates(fixture.events.map((event) => event.id), 'event id', context)
  reportDuplicates(fixture.cases.map((item) => item.id), 'case id', context)
  const records = new Map(fixture.records.map((record) => [record.id, record]))
  for (const event of fixture.events) {
    if (!records.has(event.memoryId)) addIssue(context, `unknown feedback memory: ${event.memoryId}`)
    if (event.kind === 'corrected') {
      const replacement = records.get(event.replacementMemoryId)
      if (!replacement || replacement.supersedes !== event.memoryId) {
        addIssue(context, `invalid correction replacement: ${event.id}`)
      }
    }
  }
  for (const item of fixture.cases) validateCaseReferences(item, records, context)
  if (!fixture.cases.some((item) => item.partition === 'development') ||
      !fixture.cases.some((item) => item.partition === 'holdout')) {
    addIssue(context, 'fixture requires both development and holdout cases')
  }
})

const StratumQuota = z.object({
  stratum: Stratum,
  development: z.number().int().nonnegative(),
  holdout: z.number().int().nonnegative()
}).strict()

export const MemoryFeedbackTiebreakerManifest = z.object({
  schemaVersion: z.literal(1),
  evaluationVersion: z.literal(MEMORY_FEEDBACK_TIEBREAKER_EVALUATION_VERSION),
  datasetId: z.literal(MEMORY_FEEDBACK_TIEBREAKER_DATASET_ID),
  status: z.literal('frozen'),
  evaluationNow: z.string().datetime(),
  normalization: z.object({
    unicode: z.literal('NFKC'),
    caseFold: z.literal('unicode-lowercase'),
    punctuation: z.literal('strip'),
    nearDuplicateTokenJaccard: z.literal(0.75)
  }).strict(),
  splitCounts: z.object({
    development: z.number().int().positive(),
    holdout: z.number().int().positive()
  }).strict(),
  stratumQuotas: z.array(StratumQuota).min(1),
  fixtureSha256: Hash
}).strict().superRefine((manifest, context) => {
  reportDuplicates(manifest.stratumQuotas.map((quota) => quota.stratum), 'stratum quota', context)
})

export const MemoryFeedbackTiebreakerCalibrationProcedure = z.object({
  source: z.literal('development-foundation-only'),
  gapFormula: z.literal('higher-score-minus-lower-score'),
  quantiles: z.tuple([z.literal(0.25), z.literal(0.5), z.literal(0.75)]),
  quantileMethod: z.literal('floor-index'),
  maximumGridSize: z.literal(4),
  boundaryInclusive: z.literal(true),
  grouping: z.literal('leader-relative'),
  maximumReorderWindow: z.number().int().min(2).max(8),
  exactTieControl: z.literal(true),
  noRerankControl: z.literal(true),
  stableFallback: z.tuple([z.literal('foundation-score'), z.literal('memory-id')])
}).strict()

export const MemoryFeedbackTiebreakerBoundary = z.object({
  id: z.string().regex(/^gap_[0-9]+$/u),
  maximumGap: z.number().min(0).max(1),
  inclusive: z.literal(true)
}).strict()

export const MemoryFeedbackTiebreakerCalibrationReport = z.object({
  schemaVersion: z.literal(1),
  evaluationVersion: z.literal(MEMORY_FEEDBACK_TIEBREAKER_EVALUATION_VERSION),
  fixtureSha256: Hash,
  foundationVersion: z.string().min(1),
  procedure: MemoryFeedbackTiebreakerCalibrationProcedure,
  observedGaps: z.array(z.object({
    caseId: z.string().min(1),
    higherId: z.string().min(1),
    lowerId: z.string().min(1),
    gap: z.number().min(0).max(1)
  }).strict()),
  boundaryGrid: z.array(MemoryFeedbackTiebreakerBoundary).min(1).max(4)
}).strict().superRefine((report, context) => {
  reportDuplicates(report.boundaryGrid.map((boundary) => boundary.id), 'boundary id', context)
  if (report.boundaryGrid[0]?.maximumGap !== 0) addIssue(context, 'boundary grid must start with exact tie')
  for (let index = 1; index < report.boundaryGrid.length; index += 1) {
    if (report.boundaryGrid[index]!.maximumGap <= report.boundaryGrid[index - 1]!.maximumGap) {
      addIssue(context, 'boundary grid must be strictly increasing')
    }
  }
})

export const MemoryFeedbackTiebreakerSignalRule = z.enum([
  'foundation-only',
  'confirmation',
  'confirmation-correction'
])

export const MemoryFeedbackTiebreakerCandidate = z.object({
  id: ArtifactId,
  kind: z.enum(['foundation-control', 'near-tie-rerank']),
  boundaryId: z.string().regex(/^gap_[0-9]+$/u).nullable(),
  signalRule: MemoryFeedbackTiebreakerSignalRule,
  orderingSignals: z.array(z.enum(['confirmation', 'correction'])).max(2),
  shadowSignals: z.tuple([z.literal('retrieval-frequency'), z.literal('last-retrieved-at')])
}).strict().superRefine((candidate, context) => {
  if (candidate.kind === 'foundation-control' &&
      (candidate.boundaryId !== null || candidate.signalRule !== 'foundation-only' || candidate.orderingSignals.length > 0)) {
    addIssue(context, 'foundation control cannot use a boundary or feedback signal')
  }
  if (candidate.kind === 'near-tie-rerank' && candidate.boundaryId === null) {
    addIssue(context, 'near-tie candidate requires a boundary')
  }
  const expected = candidate.signalRule === 'confirmation'
    ? ['confirmation']
    : candidate.signalRule === 'confirmation-correction'
      ? ['confirmation', 'correction']
      : []
  if (candidate.orderingSignals.join(',') !== expected.join(',')) {
    addIssue(context, 'candidate ordering signals do not match its signal rule')
  }
})

const ArtifactHashes = z.object({
  fixtureSha256: Hash,
  manifestSha256: Hash,
  calibrationSha256: Hash
}).strict()

const Bootstrap = z.object({
  method: z.literal('paired-percentile-lower-bound'),
  seed: z.number().int().nonnegative().max(0xffffffff),
  resamples: z.number().int().min(1_000),
  confidenceLevel: z.number().gt(0.5).lt(1),
  unit: z.literal('case'),
  holdoutRuns: z.literal(1)
}).strict()

export const MemoryFeedbackTiebreakerDecisionPlan = z.object({
  schemaVersion: z.literal(1),
  evaluationVersion: z.literal(MEMORY_FEEDBACK_TIEBREAKER_EVALUATION_VERSION),
  decisionId: z.string().regex(/^kun-memory-[a-z0-9-]+$/u),
  status: z.literal('pre-registered'),
  artifactHashes: ArtifactHashes,
  partitions: z.object({
    development: z.array(z.string().min(1)).min(1),
    holdout: z.array(z.string().min(1)).min(1)
  }).strict(),
  candidates: z.array(MemoryFeedbackTiebreakerCandidate).min(3).max(16),
  selectionRule: z.object({
    orderBy: z.tuple([
      z.literal('all-required-gates'),
      z.literal('pair-accuracy-lower-bound'),
      z.literal('pair-accuracy-point-estimate'),
      z.literal('smallest-boundary'),
      z.literal('candidate-id')
    ]),
    fallback: z.literal('foundation-control')
  }).strict(),
  gates: z.object({
    localBenefit: z.object({
      minimumPairAccuracyGain: z.number().min(-1).max(1),
      minimumPairAccuracyGainLowerBound: z.number().min(-1).max(1)
    }).strict(),
    globalNonRegression: z.object({
      minimumRecallGainLowerBound: z.number().min(-1).max(1),
      minimumMrrGainLowerBound: z.number().min(-1).max(1),
      maximumPrecisionDecline: z.number().min(0).max(1),
      maximumAbstentionDecline: z.number().min(0).max(1)
    }).strict(),
    safety: z.object({
      maximumExplicitForbiddenSelections: z.literal(0),
      maximumAuthorizationOrLifecycleViolations: z.literal(0),
      maximumProductionRankingChanges: z.literal(0)
    }).strict(),
    privacy: z.object({
      queryTextInTrace: z.literal(false),
      memoryContentInTrace: z.literal(false),
      sourceExcerptInTrace: z.literal(false),
      machinePathInTrace: z.literal(false),
      credentialInTrace: z.literal(false)
    }).strict(),
    determinism: z.object({
      repeatedRuns: z.number().int().min(2).max(10),
      numericTolerance: z.number().min(0).max(1e-6)
    }).strict(),
    resource: z.object({
      maximumEvaluationMilliseconds: z.number().int().positive(),
      maximumTraceRankings: z.number().int().positive().max(64),
      maximumEvidenceBytes: z.number().int().positive()
    }).strict()
  }).strict(),
  bootstrap: Bootstrap,
  production: z.object({
    rankingChanged: z.literal(false),
    dormantFeatureFlagAdded: z.literal(false),
    evaluatorOnly: z.literal(true)
  }).strict()
}).strict().superRefine((plan, context) => {
  reportDuplicates([...plan.partitions.development, ...plan.partitions.holdout], 'partition case id', context)
  reportDuplicates(plan.candidates.map((candidate) => candidate.id), 'candidate id', context)
})

export const MemoryFeedbackTiebreakerCandidateLock = z.object({
  schemaVersion: z.literal(1),
  evaluationVersion: z.literal(MEMORY_FEEDBACK_TIEBREAKER_EVALUATION_VERSION),
  decisionId: z.string().regex(/^kun-memory-[a-z0-9-]+$/u),
  status: z.literal('locked'),
  artifactHashes: ArtifactHashes.extend({ decisionPlanSha256: Hash }).strict(),
  selectedCandidateId: ArtifactId,
  evaluatorIdentity: z.string().min(1),
  bootstrapSeed: z.number().int().nonnegative().max(0xffffffff),
  holdoutRunLimit: z.literal(1),
  lockedAt: z.string().datetime()
}).strict()

const MetricSet = z.object({
  pairAccuracy: z.number().min(0).max(1),
  pairCount: z.number().int().nonnegative(),
  recallAtK: z.number().min(0).max(1),
  precisionAtK: z.number().min(0).max(1),
  meanReciprocalRank: z.number().min(0).max(1),
  abstentionAccuracy: z.number().min(0).max(1),
  explicitForbiddenSelections: z.number().int().nonnegative(),
  authorizationOrLifecycleViolations: z.number().int().nonnegative(),
  rankedCaseCount: z.number().int().nonnegative(),
  noResultCaseCount: z.number().int().nonnegative(),
  caseCount: z.number().int().positive()
}).strict()

const PartitionEvidence = z.object({
  foundation: MetricSet,
  candidate: MetricSet,
  bootstrapLowerBounds: z.object({
    pairAccuracyGain: z.number().min(-1).max(1),
    recallGain: z.number().min(-1).max(1),
    mrrGain: z.number().min(-1).max(1)
  }).strict(),
  gates: z.object({
    localBenefit: z.boolean(),
    globalNonRegression: z.boolean(),
    safety: z.boolean(),
    privacy: z.boolean(),
    determinism: z.boolean(),
    resource: z.boolean(),
    passed: z.boolean()
  }).strict()
}).strict()

export const MemoryFeedbackTiebreakerEvidence = z.object({
  schemaVersion: z.literal(1),
  evaluationVersion: z.literal(MEMORY_FEEDBACK_TIEBREAKER_EVALUATION_VERSION),
  decisionId: z.string().regex(/^kun-memory-[a-z0-9-]+$/u),
  status: z.literal('final'),
  artifactHashes: ArtifactHashes.extend({
    decisionPlanSha256: Hash,
    candidateLockSha256: Hash
  }).strict(),
  selectedCandidateId: ArtifactId,
  holdoutRunCount: z.literal(1),
  development: PartitionEvidence,
  holdout: PartitionEvidence,
  decision: z.enum(['go', 'no-go']),
  reasons: z.array(z.string().min(1)).max(32)
}).strict()

export type MemoryFeedbackTiebreakerFixture = z.infer<typeof MemoryFeedbackTiebreakerFixtureFile>
export type MemoryFeedbackTiebreakerManifestValue = z.infer<typeof MemoryFeedbackTiebreakerManifest>
export type MemoryFeedbackTiebreakerCalibration = z.infer<typeof MemoryFeedbackTiebreakerCalibrationReport>
export type MemoryFeedbackTiebreakerCandidateValue = z.infer<typeof MemoryFeedbackTiebreakerCandidate>
export type MemoryFeedbackTiebreakerSignalRuleValue = z.infer<typeof MemoryFeedbackTiebreakerSignalRule>
export type MemoryFeedbackTiebreakerPlan = z.infer<typeof MemoryFeedbackTiebreakerDecisionPlan>

export function memoryFeedbackTiebreakerArtifactSha256(value: unknown): string {
  return createHash('sha256').update(canonicalJson(value)).digest('hex')
}

function validateCaseReferences(
  item: z.infer<typeof FixtureCase>,
  records: ReadonlyMap<string, unknown>,
  context: z.RefinementCtx
): void {
  reportDuplicates(item.candidateIds, `${item.id} candidate id`, context)
  reportDuplicates(item.expectedIds, `${item.id} expected id`, context)
  reportDuplicates(item.forbiddenIds, `${item.id} forbidden id`, context)
  const candidates = new Set(item.candidateIds)
  for (const id of [...item.candidateIds, ...item.expectedIds, ...item.forbiddenIds]) {
    if (!records.has(id)) addIssue(context, `${item.id} references unknown memory: ${id}`)
  }
  for (const id of item.expectedIds) {
    if (!candidates.has(id)) addIssue(context, `${item.id} expected memory is not a candidate: ${id}`)
    if (item.forbiddenIds.includes(id)) addIssue(context, `${item.id} memory is both expected and forbidden: ${id}`)
  }
  const pairKeys = item.preferredPairs.map((pair) => `${pair.preferredId}->${pair.otherId}`)
  reportDuplicates(pairKeys, `${item.id} preference pair`, context)
  for (const pair of item.preferredPairs) {
    if (pair.preferredId === pair.otherId || !candidates.has(pair.preferredId) || !candidates.has(pair.otherId)) {
      addIssue(context, `${item.id} has an invalid preference pair`)
    }
    if (!item.expectedIds.includes(pair.preferredId)) {
      addIssue(context, `${item.id} preferred memory must be expected: ${pair.preferredId}`)
    }
  }
}

function reportDuplicates(values: readonly string[], label: string, context: z.RefinementCtx): void {
  if (new Set(values).size !== values.length) addIssue(context, `${label}s must be unique`)
}

function addIssue(context: z.RefinementCtx, message: string): void {
  context.addIssue({ code: z.ZodIssueCode.custom, message })
}

function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`
  if (value && typeof value === 'object') {
    const entries = Object.entries(value as Record<string, unknown>)
      .sort(([left], [right]) => left < right ? -1 : left > right ? 1 : 0)
    return `{${entries.map(([key, item]) => `${JSON.stringify(key)}:${canonicalJson(item)}`).join(',')}}`
  }
  return JSON.stringify(value)
}
