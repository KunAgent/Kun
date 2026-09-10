import { readFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import { z } from 'zod'

const Hash = z.string().regex(/^[a-f0-9]{64}$/u)
const CandidateMetadata = z.object({
  id: z.string().min(1),
  kind: z.enum(['lexical', 'semantic', 'hybrid']),
  version: z.string().min(1),
  runtime: z.string().min(1),
  license: z.string().min(1),
  artifactSha256: Hash.optional(),
  dimensions: z.number().int().positive().optional(),
  normalization: z.string().min(1).optional(),
  parameters: z.record(z.string(), z.union([z.string(), z.number(), z.boolean()])),
  platforms: z.array(z.string().min(1))
}).strict()

const MetricSummary = z.object({
  queryCount: z.number().int().nonnegative(),
  rankedQueryCount: z.number().int().nonnegative(),
  emptyExpectedQueryCount: z.number().int().nonnegative(),
  recallAtK: z.number(),
  precisionAtK: z.number(),
  meanReciprocalRank: z.number(),
  abstentionAccuracy: z.number(),
  falsePositiveSelections: z.number().int().nonnegative(),
  explicitForbiddenSelections: z.number().int().nonnegative(),
  scopeLeaks: z.number().int().nonnegative(),
  lifecycleLeaks: z.number().int().nonnegative(),
  authorityViolations: z.number().int().nonnegative(),
  unknownSelections: z.number().int().nonnegative(),
  selectedCharacters: z.number().int().nonnegative(),
  latencyP50Ms: z.number().nonnegative(),
  latencyP95Ms: z.number().nonnegative()
}).strict()

const CategoryMetric = z.object({
  queryCount: z.number().int().nonnegative(),
  recallAtK: z.number(),
  precisionAtK: z.number(),
  meanReciprocalRank: z.number(),
  abstentionAccuracy: z.number()
}).strict()

const BootstrapInterval = z.object({
  method: z.literal('paired-percentile'),
  pointEstimate: z.number(),
  lowerBound: z.number(),
  upperBound: z.number(),
  confidenceLevel: z.number().gt(0).lt(1),
  seed: z.number().int().min(0).max(0xffffffff),
  resamples: z.number().int().positive(),
  sampleSize: z.number().int().nonnegative()
}).strict()

const ComparisonMetrics = z.object({
  recallAtKDelta: BootstrapInterval,
  meanReciprocalRankDelta: BootstrapInterval,
  abstentionAccuracyDelta: z.number(),
  abstentionSampleSize: z.number().int().nonnegative()
}).strict()

const Determinism = z.object({
  runHashes: z.array(Hash).length(3).refine((hashes) => new Set(hashes).size === 1, {
    message: 'deterministic run hashes must match'
  })
}).strict()

const SelectedIds = z.record(z.string(), z.array(z.string()))
const ReportSummary = z.object({
  candidate: CandidateMetadata,
  metrics: MetricSummary,
  categoryBreakdowns: z.record(z.string(), MetricSummary),
  safetyGatePassed: z.boolean(),
  selectedIds: SelectedIds
}).strict()

const GridConfiguration = z.object({
  id: z.string().min(1),
  minimumSimilarity: z.number().min(-1).max(1),
  semanticWeight: z.number().positive(),
  lexicalWeight: z.number().positive(),
  rankConstant: z.number().int().positive()
}).strict()

const GridEntry = z.object({
  configuration: GridConfiguration,
  candidateId: z.string().min(1),
  metrics: MetricSummary,
  categories: z.record(z.string(), CategoryMetric),
  safetyGatePassed: z.boolean(),
  comparison: ComparisonMetrics
}).strict()

export const SemanticMemoryV2DevelopmentEvidenceSchema = z.object({
  schemaVersion: z.literal(2),
  reportKind: z.literal('semantic-memory-development-screening'),
  generatedAt: z.string().datetime(),
  holdoutResultsEmitted: z.literal(false),
  dataset: z.object({
    id: z.literal('kun-memory-semantic-retrieval-anonymous-v2'),
    sourceHashes: z.object({ records: Hash, queries: Hash, manifest: Hash }).strict(),
    developmentQueries: z.literal(40)
  }).strict(),
  terminology: z.object({ mapId: z.string().min(1), artifactSha256: Hash }).strict(),
  model: z.object({
    id: z.string().min(1),
    revision: z.string().min(1),
    artifact: z.string().min(1),
    artifactSha256: Hash,
    resourceEvidenceReference: z.string().min(1)
  }).strict(),
  offline: z.object({ networkAttempts: z.literal(0) }).strict(),
  coldReadinessMs: z.number().nonnegative(),
  lexical: ReportSummary.extend({
    determinism: Determinism,
    additionalModelBytes: z.literal(0),
    additionalIndexBytes: z.literal(0)
  }),
  terminologyCandidate: ReportSummary.extend({
    comparison: ComparisonMetrics,
    additionalModelBytes: z.literal(0),
    additionalIndexBytes: z.literal(0),
    determinism: Determinism
  }),
  gridSha256: Hash,
  grid: z.array(GridEntry).length(18),
  selected: z.null(),
  developmentDecision: z.object({
    status: z.literal('no-candidate'),
    reason: z.string().min(1),
    failedGateIds: z.array(z.string().min(1)).min(1),
    expectedEmptyResultAccuracy: z.literal(1),
    observedE5EmptyResultAccuracy: z.object({
      minimum: z.number().min(0).max(1),
      maximum: z.number().min(0).max(1)
    }).strict(),
    terminologyEmptyResultAccuracy: z.number().min(0).max(1),
    holdoutRun: z.literal(false)
  }).strict()
}).strict().superRefine((evidence, context) => {
  const ids = evidence.grid.map((entry) => entry.configuration.id)
  if (new Set(ids).size !== ids.length) {
    context.addIssue({ code: 'custom', path: ['grid'], message: 'grid configuration ids must be unique' })
  }
  if (evidence.grid.some((entry) => entry.metrics.queryCount !== evidence.dataset.developmentQueries)) {
    context.addIssue({ code: 'custom', path: ['grid'], message: 'grid entry query counts must be development-only' })
  }
  const resultIds = [
    ...Object.keys(evidence.lexical.selectedIds),
    ...Object.keys(evidence.terminologyCandidate.selectedIds)
  ]
  if (resultIds.some((id) => !/^p2a_v2_q(?:0[0-3][0-9]|040)_/u.test(id))) {
    context.addIssue({ code: 'custom', message: 'development evidence contains a holdout query id' })
  }
})

export type SemanticMemoryV2DevelopmentEvidence = z.infer<typeof SemanticMemoryV2DevelopmentEvidenceSchema>

export const DEFAULT_SEMANTIC_MEMORY_V2_DEVELOPMENT_EVIDENCE_PATH = fileURLToPath(new URL(
  './fixtures/semantic-memory-v2-development-screening.v2.json',
  import.meta.url
))

export async function loadSemanticMemoryV2DevelopmentEvidence(
  path = DEFAULT_SEMANTIC_MEMORY_V2_DEVELOPMENT_EVIDENCE_PATH
): Promise<SemanticMemoryV2DevelopmentEvidence> {
  let input: unknown
  try {
    input = JSON.parse(await readFile(path, 'utf8')) as unknown
  } catch {
    throw new Error('invalid semantic Memory v2 development evidence JSON')
  }
  return SemanticMemoryV2DevelopmentEvidenceSchema.parse(input)
}
