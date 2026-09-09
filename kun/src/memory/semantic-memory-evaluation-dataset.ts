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

export const SEMANTIC_MEMORY_DATASET_ID = 'kun-memory-semantic-retrieval-anonymous-v1'
export const SEMANTIC_MEMORY_DATASET_VERSION = 1

const EvaluationRecord = z.object({
  id: z.string().regex(/^p2a_[a-z0-9_]+$/u),
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

const QuerySplit = z.enum(['development', 'holdout'])
const QueryLanguage = z.enum(['en', 'zh'])
const QueryCategory = z.enum([
  'lexical-control',
  'semantic-paraphrase',
  'cross-lingual',
  'project-scope-negative',
  'workspace-scope-negative',
  'lifecycle-negative',
  'temporal-current',
  'authority-safety',
  'no-result',
  'multi-relevant'
])
const EvaluationQuery = z.object({
  id: z.string().regex(/^p2a_q[0-9]{2}_[a-z0-9_]+$/u),
  split: QuerySplit,
  queryLanguage: QueryLanguage,
  category: QueryCategory,
  query: z.string().min(1).max(1_000),
  workspace: z.string().min(1).optional(),
  project: z.string().min(1).optional(),
  expectedIds: z.array(z.string().min(1)).max(16),
  forbiddenIds: z.array(z.string().min(1)).max(32),
  rationale: z.string().min(1).max(1_000)
}).strict().superRefine((query, context) => {
  reportDuplicates(query.expectedIds, 'expectedIds', context)
  reportDuplicates(query.forbiddenIds, 'forbiddenIds', context)
})

const RecordsFile = z.object({
  schemaVersion: z.literal(SEMANTIC_MEMORY_DATASET_VERSION),
  datasetId: z.literal(SEMANTIC_MEMORY_DATASET_ID),
  status: z.literal('frozen'),
  evaluationNow: z.string().datetime(),
  records: z.array(EvaluationRecord)
}).strict()
const QueriesFile = z.object({
  schemaVersion: z.literal(SEMANTIC_MEMORY_DATASET_VERSION),
  datasetId: z.literal(SEMANTIC_MEMORY_DATASET_ID),
  status: z.literal('frozen'),
  defaultK: z.number().int().positive().max(64),
  queries: z.array(EvaluationQuery)
}).strict()

const Thresholds = z.object({
  scopeLeaks: z.literal(0),
  lifecycleLeaks: z.literal(0),
  authorityViolations: z.literal(0),
  networkAttempts: z.literal(0),
  fallbackMismatches: z.literal(0),
  emptyResultAccuracy: z.literal(1),
  semanticHoldoutRecallGain: z.number().min(0).max(1),
  semanticHoldoutMrrGain: z.number().min(0).max(1),
  maximumOverallPrecisionDecline: z.number().min(0).max(1),
  maximumLexicalControlRegression: z.number().min(0).max(1),
  deterministicRuns: z.number().int().min(2),
  maximumCompressedModelBytes: z.number().int().positive(),
  maximumWarmQueryP95Ms: z.number().positive(),
  maximumColdReadinessMs: z.number().positive(),
  maximumTenThousandRecordBuildMs: z.number().positive(),
  maximumAdditionalPeakRssBytes: z.number().int().positive(),
  maximumTenThousandRecordIndexBytes: z.number().int().positive()
}).strict()
const Manifest = z.object({
  schemaVersion: z.literal(SEMANTIC_MEMORY_DATASET_VERSION),
  datasetId: z.literal(SEMANTIC_MEMORY_DATASET_ID),
  status: z.literal('frozen'),
  evaluationNow: z.string().datetime(),
  defaultK: z.number().int().positive().max(64),
  promptCharacterBudget: z.number().int().positive(),
  scoringVersion: z.literal(1),
  hashes: z.object({
    recordsSha256: z.string().regex(/^[a-f0-9]{64}$/u),
    queriesSha256: z.string().regex(/^[a-f0-9]{64}$/u)
  }).strict(),
  counts: z.object({
    records: z.number().int().positive(),
    queries: z.number().int().positive(),
    development: z.number().int().positive(),
    holdout: z.number().int().positive(),
    english: z.number().int().positive(),
    chinese: z.number().int().positive(),
    emptyExpected: z.number().int().nonnegative()
  }).strict(),
  thresholds: Thresholds,
  referenceMachine: z.object({
    platform: z.string().min(1),
    architecture: z.string().min(1),
    os: z.string().min(1),
    osBuild: z.string().min(1),
    cpu: z.string().min(1),
    physicalCores: z.number().int().positive(),
    logicalProcessors: z.number().int().positive(),
    physicalMemoryBytes: z.number().int().positive(),
    nodeVersion: z.string().min(1),
    nodeModuleAbi: z.string().min(1)
  }).strict(),
  review: z.object({
    privacyPatternsChecked: z.array(z.string().min(1)).min(1),
    zeroOverlapSemanticOrCrossLingualQueries: z.number().int().nonnegative(),
    zeroOverlapHoldoutQueries: z.number().int().nonnegative(),
    notes: z.string().min(1)
  }).strict(),
  candidateLock: z.object({
    status: z.literal('locked'),
    lockedAt: z.string().datetime(),
    selectedOnSplit: z.literal('development'),
    candidate: z.object({
      id: z.string().min(1),
      kind: z.literal('hybrid'),
      modelId: z.string().min(1),
      version: z.string().min(1),
      runtime: z.string().min(1),
      license: z.string().min(1),
      artifact: z.string().min(1),
      artifactSha256: z.string().regex(/^[a-f0-9]{64}$/u),
      dimensions: z.number().int().positive(),
      normalization: z.string().min(1),
      parameters: z.record(z.string(), z.union([z.string(), z.number(), z.boolean()])),
      platforms: z.array(z.string().min(1)).min(1)
    }).strict(),
    numericTolerance: z.number().positive().max(0.001),
    developmentEvidence: z.string().min(1),
    resourceEvidence: z.string().min(1)
  }).strict()
}).strict()

export type SemanticMemoryEvaluationQuery = z.infer<typeof EvaluationQuery>
export type SemanticMemoryEvaluationManifest = z.infer<typeof Manifest>
export type SemanticMemoryEvaluationDataset = {
  manifest: SemanticMemoryEvaluationManifest
  records: MemoryRecordValue[]
  queries: SemanticMemoryEvaluationQuery[]
}

export const DEFAULT_SEMANTIC_MEMORY_DATASET_PATHS = Object.freeze({
  records: fileURLToPath(new URL('./fixtures/semantic-memory-records.v1.json', import.meta.url)),
  queries: fileURLToPath(new URL('./fixtures/semantic-memory-queries.v1.json', import.meta.url)),
  manifest: fileURLToPath(new URL('./fixtures/semantic-memory-manifest.v1.json', import.meta.url))
})

export async function loadSemanticMemoryEvaluationDataset(
  paths = DEFAULT_SEMANTIC_MEMORY_DATASET_PATHS
): Promise<SemanticMemoryEvaluationDataset> {
  const [recordsText, queriesText, manifestText] = await Promise.all([
    readFile(paths.records, 'utf8'),
    readFile(paths.queries, 'utf8'),
    readFile(paths.manifest, 'utf8')
  ])
  return parseSemanticMemoryEvaluationDataset({ recordsText, queriesText, manifestText })
}

export function parseSemanticMemoryEvaluationDataset(input: {
  recordsText: string
  queriesText: string
  manifestText: string
}): SemanticMemoryEvaluationDataset {
  const recordsFile = RecordsFile.parse(parseJson(input.recordsText, 'records'))
  const queriesFile = QueriesFile.parse(parseJson(input.queriesText, 'queries'))
  const manifest = Manifest.parse(parseJson(input.manifestText, 'manifest'))
  const records = recordsFile.records.map(materializeRecord)
  const errors: string[] = []

  requireEqual(recordsFile.evaluationNow, manifest.evaluationNow, 'evaluationNow', errors)
  requireEqual(queriesFile.defaultK, manifest.defaultK, 'defaultK', errors)
  requireEqual(sha256(input.recordsText), manifest.hashes.recordsSha256, 'records hash', errors)
  requireEqual(sha256(input.queriesText), manifest.hashes.queriesSha256, 'queries hash', errors)
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

  const development = queriesFile.queries.filter((query) => query.split === 'development').length
  const holdout = queriesFile.queries.length - development
  const english = queriesFile.queries.filter((query) => query.queryLanguage === 'en').length
  const chinese = queriesFile.queries.length - english
  const emptyExpected = queriesFile.queries.filter((query) => query.expectedIds.length === 0).length
  const actualCounts = { records: records.length, queries: queriesFile.queries.length, development, holdout, english, chinese, emptyExpected }
  for (const [key, value] of Object.entries(actualCounts)) {
    requireEqual(value, manifest.counts[key as keyof typeof manifest.counts], `${key} count`, errors)
  }
  if (errors.length > 0) throw new Error(`invalid semantic memory evaluation dataset: ${errors.join('; ')}`)
  return { manifest, records, queries: queriesFile.queries }
}

function materializeRecord(record: z.infer<typeof EvaluationRecord>): MemoryRecordValue {
  return MemoryRecord.parse({
    ...record,
    provenance: { kind: 'inference', origin: 'anonymous-evaluation-fixture' },
    sources: [{ id: 'semantic-memory-fixture', kind: 'inference', trust: 'inferred' }],
    createdAt: record.observedAt,
    updatedAt: record.observedAt
  })
}

function parseJson(text: string, name: string): unknown {
  try {
    return JSON.parse(text) as unknown
  } catch {
    throw new Error(`invalid semantic memory ${name} JSON`)
  }
}

function sha256(text: string): string {
  return createHash('sha256').update(text).digest('hex')
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
