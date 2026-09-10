import { createHash } from 'node:crypto'
import { readFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import { z } from 'zod'
import {
  MemoryRecord,
  MemoryScope,
  MemoryType,
  type MemoryRecord as MemoryRecordValue
} from '../contracts/memory.js'
import { memoryInScope, memoryLifecycleState } from './memory-ranking.js'

export const SEMANTIC_MEMORY_V3_DATASET_ID = 'kun-memory-semantic-retrieval-anonymous-v3'
export const SEMANTIC_MEMORY_V3_DATASET_VERSION = 3
export const SEMANTIC_MEMORY_V3_SPLIT_RULE = 'query ordinals 001-040 development; 041-080 holdout'

export const SemanticMemoryV3QueryCategory = z.enum([
  'lexical-control',
  'semantic-paraphrase',
  'cross-lingual',
  'cross-lingual-zero-overlap-positive',
  'terse-abstract',
  'irrelevant-no-evidence',
  'same-category-near-miss',
  'scope-lifecycle-negative',
  'no-result-authority-safety',
  'multi-relevant'
])

const EvaluationRecord = z.object({
  id: z.string().regex(/^p2a_v3_[a-z0-9_]+$/u),
  content: z.string().min(1).max(2_000),
  scope: MemoryScope,
  workspace: z.string().min(1).optional(),
  project: z.string().min(1).optional(),
  type: MemoryType,
  tags: z.array(z.string().min(1).max(128)).max(32),
  confidence: z.number().min(0).max(1),
  importance: z.number().min(0).max(1),
  observedAt: z.string().datetime(),
  validFrom: z.string().datetime().optional(),
  validTo: z.string().datetime().optional(),
  expiresAt: z.string().datetime().optional(),
  supersedes: z.string().min(1).optional(),
  supersededAt: z.string().datetime().optional(),
  disabledAt: z.string().datetime().optional(),
  deletedAt: z.string().datetime().optional()
}).strict().superRefine((record, context) => {
  if (record.scope === 'user' && (record.workspace || record.project)) {
    context.addIssue({ code: 'custom', message: 'user fixtures cannot declare workspace or project' })
  }
  if (record.scope === 'workspace' && (!record.workspace || record.project)) {
    context.addIssue({ code: 'custom', message: 'workspace fixtures require workspace and cannot declare project' })
  }
  if (record.scope === 'project' && (!record.workspace || !record.project)) {
    context.addIssue({ code: 'custom', message: 'project fixtures require workspace and project' })
  }
})

const EvaluationQuery = z.object({
  id: z.string().regex(/^p2a_v3_q[0-9]{3}_[a-z0-9_]+$/u),
  split: z.enum(['development', 'holdout']),
  queryLanguage: z.enum(['en', 'zh']),
  category: SemanticMemoryV3QueryCategory,
  query: z.string().min(1).max(1_000),
  workspace: z.string().min(1).optional(),
  project: z.string().min(1).optional(),
  expectedIds: z.array(z.string().min(1)).max(16),
  forbiddenIds: z.array(z.string().min(1)).min(1).max(32),
  zeroLexicalOverlap: z.boolean(),
  rationale: z.string().min(20).max(1_000)
}).strict().superRefine((query, context) => {
  reportDuplicates(query.expectedIds, 'expectedIds', context)
  reportDuplicates(query.forbiddenIds, 'forbiddenIds', context)
  if (query.category === 'cross-lingual-zero-overlap-positive' &&
      (!query.zeroLexicalOverlap || query.expectedIds.length === 0)) {
    context.addIssue({ code: 'custom', message: 'zero-overlap positive category requires expected records and zeroLexicalOverlap' })
  }
  if (query.zeroLexicalOverlap && query.category !== 'cross-lingual-zero-overlap-positive') {
    context.addIssue({ code: 'custom', message: 'zeroLexicalOverlap must use the dedicated positive category' })
  }
  if (query.zeroLexicalOverlap && query.expectedIds.length === 0) {
    context.addIssue({ code: 'custom', message: 'zeroLexicalOverlap requires a positive expected set' })
  }
})

const CategoryQuota = z.object({
  development: z.number().int().nonnegative(),
  holdout: z.number().int().nonnegative()
}).strict()

const CategoryQuotas = z.object({
  'lexical-control': CategoryQuota,
  'semantic-paraphrase': CategoryQuota,
  'cross-lingual': CategoryQuota,
  'cross-lingual-zero-overlap-positive': CategoryQuota,
  'terse-abstract': CategoryQuota,
  'irrelevant-no-evidence': CategoryQuota,
  'same-category-near-miss': CategoryQuota,
  'scope-lifecycle-negative': CategoryQuota,
  'no-result-authority-safety': CategoryQuota,
  'multi-relevant': CategoryQuota
}).strict()

const Manifest = z.object({
  schemaVersion: z.literal(SEMANTIC_MEMORY_V3_DATASET_VERSION),
  datasetId: z.literal(SEMANTIC_MEMORY_V3_DATASET_ID),
  status: z.literal('frozen'),
  evaluationNow: z.string().datetime(),
  defaultK: z.number().int().positive().max(64),
  promptCharacterBudget: z.number().int().positive(),
  scoringVersion: z.literal(3),
  splitRule: z.literal(SEMANTIC_MEMORY_V3_SPLIT_RULE),
  hashes: z.object({
    recordsSha256: z.string().regex(/^[a-f0-9]{64}$/u),
    queriesSha256: z.string().regex(/^[a-f0-9]{64}$/u)
  }).strict(),
  counts: z.object({
    records: z.number().int().min(40).max(64),
    queries: z.literal(80),
    development: z.literal(40),
    holdout: z.literal(40),
    english: z.number().int().positive(),
    chinese: z.number().int().positive(),
    emptyExpected: z.number().int().nonnegative(),
    zeroOverlapPositive: z.number().int().positive()
  }).strict(),
  categoryQuotas: CategoryQuotas,
  candidateIdentity: z.object({
    modelId: z.literal('multilingual-e5-small-q8'),
    modelSha256: z.string().regex(/^[a-f0-9]{64}$/u),
    tokenizerSha256: z.string().regex(/^[a-f0-9]{64}$/u),
    queryPrefix: z.string(),
    documentPrefix: z.string(),
    pooling: z.string().min(1),
    normalization: z.string().min(1),
    quantization: z.string().min(1),
    runtime: z.string().min(1),
    dimensions: z.number().int().positive()
  }).strict(),
  normalization: z.object({
    tokenizerVersion: z.string().min(1),
    zeroOverlapRule: z.string().min(20)
  }).strict(),
  bootstrap: z.object({
    method: z.literal('paired-percentile'),
    seed: z.number().int().min(0).max(0xffffffff),
    resamples: z.number().int().positive(),
    confidenceLevel: z.number().gt(0).lt(1)
  }).strict(),
  developmentGrid: z.object({
    minimumSimilarities: z.array(z.number().min(-1).max(1)).min(1),
    marginGaps: z.array(z.number().min(-1).max(1)).min(1),
    semanticWeights: z.array(z.number().positive()).min(1),
    lexicalWeights: z.array(z.number().positive()).min(1),
    rankConstants: z.array(z.number().int().positive()).min(1)
  }).strict(),
  thresholds: z.object({
    scopeLeaks: z.literal(0),
    lifecycleLeaks: z.literal(0),
    authorityViolations: z.literal(0),
    networkAttempts: z.literal(0),
    fallbackMismatches: z.literal(0),
    emptyResultAccuracy: z.literal(1),
    minimumRecallGainLowerBound: z.number().min(-1).max(1),
    minimumMrrGainLowerBound: z.number().min(-1).max(1),
    maximumOverallPrecisionDecline: z.number().min(0).max(1),
    maximumZeroOverlapRecallDecline: z.number().min(0).max(1),
    deterministicRuns: z.number().int().min(2),
    maximumCompressedModelBytes: z.number().int().positive(),
    maximumWarmQueryP95Ms: z.number().positive(),
    maximumColdReadinessMs: z.number().positive(),
    maximumTenThousandRecordBuildMs: z.number().positive(),
    maximumAdditionalPeakRssBytes: z.number().int().positive(),
    maximumTenThousandRecordIndexBytes: z.number().int().positive()
  }).strict(),
  review: z.object({
    privacyPatternsChecked: z.array(z.string().min(1)).min(1),
    labelingRule: z.string().min(1),
    notes: z.string().min(1)
  }).strict()
}).strict()

const ChecksumsFile = z.object({
  schemaVersion: z.literal(SEMANTIC_MEMORY_V3_DATASET_VERSION),
  datasetId: z.literal(SEMANTIC_MEMORY_V3_DATASET_ID),
  algorithm: z.literal('sha256'),
  files: z.object({
    records: z.string().regex(/^[a-f0-9]{64}$/u),
    queries: z.string().regex(/^[a-f0-9]{64}$/u),
    manifest: z.string().regex(/^[a-f0-9]{64}$/u)
  }).strict()
}).strict()

export type SemanticMemoryV3EvaluationQuery = z.infer<typeof EvaluationQuery>
export type SemanticMemoryV3EvaluationManifest = z.infer<typeof Manifest>
export type SemanticMemoryV3EvaluationDataset = {
  manifest: SemanticMemoryV3EvaluationManifest
  records: MemoryRecordValue[]
  queries: SemanticMemoryV3EvaluationQuery[]
  sourceHashes: z.infer<typeof ChecksumsFile>['files']
}

export const DEFAULT_SEMANTIC_MEMORY_V3_DATASET_PATHS = Object.freeze({
  records: fileURLToPath(new URL('./fixtures/semantic-memory-records.v3.json', import.meta.url)),
  queries: fileURLToPath(new URL('./fixtures/semantic-memory-queries.v3.json', import.meta.url)),
  manifest: fileURLToPath(new URL('./fixtures/semantic-memory-manifest.v3.json', import.meta.url)),
  checksums: fileURLToPath(new URL('./fixtures/semantic-memory-checksums.v3.json', import.meta.url))
})

export async function loadSemanticMemoryV3EvaluationDataset(
  paths = DEFAULT_SEMANTIC_MEMORY_V3_DATASET_PATHS
): Promise<SemanticMemoryV3EvaluationDataset> {
  const [recordsText, queriesText, manifestText, checksumsText] = await Promise.all([
    readFile(paths.records, 'utf8'),
    readFile(paths.queries, 'utf8'),
    readFile(paths.manifest, 'utf8'),
    readFile(paths.checksums, 'utf8')
  ])
  return parseSemanticMemoryV3EvaluationDataset({ recordsText, queriesText, manifestText, checksumsText })
}

export function parseSemanticMemoryV3EvaluationDataset(input: {
  recordsText: string
  queriesText: string
  manifestText: string
  checksumsText: string
}): SemanticMemoryV3EvaluationDataset {
  const recordsFile = RecordsFile.parse(parseJson(input.recordsText, 'records'))
  const queriesFile = QueriesFile.parse(parseJson(input.queriesText, 'queries'))
  const manifest = Manifest.parse(parseJson(input.manifestText, 'manifest'))
  const checksums = ChecksumsFile.parse(parseJson(input.checksumsText, 'checksums'))
  const records = recordsFile.records.map(materializeRecord)
  const errors: string[] = []
  const actualHashes = {
    records: sha256(input.recordsText),
    queries: sha256(input.queriesText),
    manifest: sha256(input.manifestText)
  }

  for (const key of ['records', 'queries', 'manifest'] as const) {
    requireEqual(actualHashes[key], checksums.files[key], `${key} checksum`, errors)
  }
  requireEqual(recordsFile.evaluationNow, manifest.evaluationNow, 'evaluationNow', errors)
  requireEqual(queriesFile.defaultK, manifest.defaultK, 'defaultK', errors)
  requireEqual(actualHashes.records, manifest.hashes.recordsSha256, 'records manifest hash', errors)
  requireEqual(actualHashes.queries, manifest.hashes.queriesSha256, 'queries manifest hash', errors)
  requireUnique(records.map((record) => record.id), 'record ids', errors)
  requireUnique(queriesFile.queries.map((query) => query.id), 'query ids', errors)

  const recordsById = new Map(records.map((record) => [record.id, record]))
  const nowMs = Date.parse(manifest.evaluationNow)
  for (const record of records) {
    if (record.supersedes && !recordsById.has(record.supersedes)) {
      errors.push(`record ${record.id} supersedes unknown id ${record.supersedes}`)
    }
  }
  for (const query of queriesFile.queries) {
    requireEqual(query.split, expectedSplit(query.id), `split for ${query.id}`, errors)
    for (const id of [...query.expectedIds, ...query.forbiddenIds]) {
      if (!recordsById.has(id)) errors.push(`query ${query.id} references unknown id ${id}`)
    }
    for (const id of query.expectedIds) {
      if (query.forbiddenIds.includes(id)) errors.push(`query ${query.id} expects and forbids ${id}`)
      const record = recordsById.get(id)
      if (record && (!memoryInScope(record, query) || memoryLifecycleState(record, nowMs) !== 'active')) {
        errors.push(`query ${query.id} expects unavailable record ${id}`)
      }
    }
  }

  validateCounts(records, queriesFile.queries, manifest, errors)
  validateCategoryQuotas(queriesFile.queries, manifest.categoryQuotas, errors)
  if (errors.length > 0) throw new Error(`invalid semantic memory v3 evaluation dataset: ${errors.join('; ')}`)
  return { manifest, records, queries: queriesFile.queries, sourceHashes: checksums.files }
}

function validateCounts(
  records: readonly MemoryRecordValue[],
  queries: readonly SemanticMemoryV3EvaluationQuery[],
  manifest: SemanticMemoryV3EvaluationManifest,
  errors: string[]
): void {
  const development = queries.filter((query) => query.split === 'development').length
  const holdout = queries.length - development
  const english = queries.filter((query) => query.queryLanguage === 'en').length
  const chinese = queries.length - english
  const emptyExpected = queries.filter((query) => query.expectedIds.length === 0).length
  const zeroOverlapPositive = queries.filter((query) => query.zeroLexicalOverlap).length
  const actual = { records: records.length, queries: queries.length, development, holdout, english, chinese, emptyExpected, zeroOverlapPositive }
  for (const [key, value] of Object.entries(actual)) {
    requireEqual(value, manifest.counts[key as keyof typeof manifest.counts], `${key} count`, errors)
  }
}

function validateCategoryQuotas(
  queries: readonly SemanticMemoryV3EvaluationQuery[],
  quotas: SemanticMemoryV3EvaluationManifest['categoryQuotas'],
  errors: string[]
): void {
  for (const category of SemanticMemoryV3QueryCategory.options) {
    for (const split of ['development', 'holdout'] as const) {
      const actual = queries.filter((query) => query.category === category && query.split === split).length
      requireEqual(actual, quotas[category][split], `${category} ${split} quota`, errors)
    }
  }
}

function expectedSplit(id: string): 'development' | 'holdout' {
  const ordinal = Number(/^p2a_v3_q([0-9]{3})_/u.exec(id)?.[1] ?? Number.NaN)
  return ordinal <= 40 ? 'development' : 'holdout'
}

function materializeRecord(record: z.infer<typeof EvaluationRecord>): MemoryRecordValue {
  return MemoryRecord.parse({
    ...record,
    provenance: { kind: 'inference', origin: 'anonymous-evaluation-fixture-v3' },
    sources: [{ id: 'semantic-memory-fixture-v3', kind: 'inference', trust: 'inferred' }],
    createdAt: record.observedAt,
    updatedAt: record.observedAt
  })
}

function parseJson(text: string, name: string): unknown {
  try {
    return JSON.parse(text) as unknown
  } catch {
    throw new Error(`invalid semantic memory v3 ${name} JSON`)
  }
}

export function semanticMemoryV3Sha256(text: string): string {
  return sha256(text)
}

function sha256(text: string): string {
  return createHash('sha256').update(canonicalText(text)).digest('hex')
}

function canonicalText(text: string): string {
  return text.replace(/\r\n?/gu, '\n')
}

function requireUnique(values: readonly string[], name: string, errors: string[]): void {
  if (new Set(values).size !== values.length) errors.push(`${name} must be unique`)
}

function requireEqual(actual: unknown, expected: unknown, name: string, errors: string[]): void {
  if (actual !== expected) errors.push(`${name} mismatch`)
}

function reportDuplicates(values: readonly string[], name: string, context: z.RefinementCtx): void {
  if (new Set(values).size === values.length) return
  context.addIssue({ code: 'custom', path: [name], message: `${name} must be unique` })
}

const RecordsFile = z.object({
  schemaVersion: z.literal(SEMANTIC_MEMORY_V3_DATASET_VERSION),
  datasetId: z.literal(SEMANTIC_MEMORY_V3_DATASET_ID),
  status: z.literal('frozen'),
  evaluationNow: z.string().datetime(),
  records: z.array(EvaluationRecord).min(40).max(64)
}).strict()

const QueriesFile = z.object({
  schemaVersion: z.literal(SEMANTIC_MEMORY_V3_DATASET_VERSION),
  datasetId: z.literal(SEMANTIC_MEMORY_V3_DATASET_ID),
  status: z.literal('frozen'),
  defaultK: z.number().int().positive().max(64),
  queries: z.array(EvaluationQuery).length(80)
}).strict()
