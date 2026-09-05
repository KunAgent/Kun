import { z } from 'zod'

export const MEMORY_SCHEMA_VERSION = 2 as const
export const MEMORY_MAX_SOURCES = 8
export const MEMORY_MAX_SOURCE_EXCERPT_CHARS = 512
export const MEMORY_MAX_SOURCE_LOCATOR_CHARS = 1_024
export const MEMORY_MAX_TRACE_RANKINGS = 64

export const MemoryScope = z.enum(['user', 'workspace', 'project'])
export type MemoryScope = z.infer<typeof MemoryScope>

export const MemorySourceKind = z.enum(['user', 'tool', 'inference', 'file', 'web'])
export type MemorySourceKind = z.infer<typeof MemorySourceKind>

export const MemoryType = z.enum([
  'fact',
  'preference',
  'decision',
  'episode',
  'relationship',
  'insight'
])
export type MemoryType = z.infer<typeof MemoryType>

export const MemoryAuthority = z.literal('reference')
export type MemoryAuthority = z.infer<typeof MemoryAuthority>

export const MemoryEvidenceKind = z.enum([
  'user',
  'tool',
  'inference',
  'file',
  'web',
  'imported',
  'legacy'
])
export const MemoryEvidenceTrust = z.enum([
  'explicit-user',
  'observed',
  'inferred',
  'imported',
  'legacy'
])

export const MemorySourceEvidence = z.object({
  id: z.string().min(1).max(128),
  kind: MemoryEvidenceKind,
  threadId: z.string().min(1).max(256).optional(),
  turnId: z.string().min(1).max(256).optional(),
  itemId: z.string().min(1).max(256).optional(),
  locator: z.string().min(1).max(MEMORY_MAX_SOURCE_LOCATOR_CHARS).optional(),
  excerpt: z.string().min(1).max(MEMORY_MAX_SOURCE_EXCERPT_CHARS).optional(),
  contentHash: z.string().min(1).max(128).optional(),
  trust: MemoryEvidenceTrust
}).strict()
export type MemorySourceEvidence = z.infer<typeof MemorySourceEvidence>

const MemorySourceEvidenceList = z.array(MemorySourceEvidence)
  .max(MEMORY_MAX_SOURCES)
  .superRefine(reportDuplicateSourceIds)

export const MemoryProvenance = z.object({
  kind: MemorySourceKind,
  turnId: z.string().optional(),
  file: z.string().optional(),
  origin: z.string().optional()
}).strict()
export type MemoryProvenance = z.infer<typeof MemoryProvenance>

const MemoryRecordInput = z.object({
  id: z.string().min(1),
  content: z.string().min(1),
  scope: MemoryScope,
  workspace: z.string().optional(),
  project: z.string().optional(),
  sourceThreadId: z.string().optional(),
  sourceTurnId: z.string().optional(),
  provenance: MemoryProvenance.optional(),
  tags: z.array(z.string()).default([]),
  confidence: z.number().min(0).max(1).default(1),
  createdAt: z.string(),
  updatedAt: z.string(),
  expiresAt: z.string().datetime().optional(),
  supersedes: z.string().optional(),
  supersededAt: z.string().optional(),
  correctedFrom: z.string().optional(),
  disabledAt: z.string().optional(),
  deletedAt: z.string().optional(),
  schemaVersion: z.literal(MEMORY_SCHEMA_VERSION).optional(),
  type: MemoryType.optional(),
  authority: MemoryAuthority.optional(),
  importance: z.number().min(0).max(1).optional(),
  observedAt: z.string().datetime().optional(),
  validFrom: z.string().datetime().optional(),
  validTo: z.string().datetime().optional(),
  sources: MemorySourceEvidenceList.optional()
}).strict().superRefine(reportInvalidValidityInterval)

/** Parse legacy or V2 JSON into a complete V2 view without rewriting disk. */
export const MemoryRecord = MemoryRecordInput.transform((record) => ({
  ...record,
  schemaVersion: MEMORY_SCHEMA_VERSION,
  type: record.type ?? inferLegacyMemoryType(record.tags),
  authority: 'reference' as const,
  importance: record.importance ?? defaultImportance(record.provenance?.kind),
  observedAt: record.observedAt ?? validTimestamp(record.updatedAt, record.createdAt),
  sources: record.sources ?? legacyEvidence(record)
}))
export type MemoryRecord = z.infer<typeof MemoryRecord>

const MemorySourceEvidenceInput = MemorySourceEvidence.omit({ id: true }).extend({
  id: z.string().min(1).max(128).optional()
}).strict()
const MemorySourceEvidenceInputList = z.array(MemorySourceEvidenceInput)
  .max(MEMORY_MAX_SOURCES)
  .superRefine(reportDuplicateSourceIds)

export const MemoryCreateRequest = z.object({
  content: z.string().min(1),
  scope: MemoryScope.default('workspace'),
  workspace: z.string().optional(),
  project: z.string().optional(),
  sourceThreadId: z.string().optional(),
  sourceTurnId: z.string().optional(),
  provenance: MemoryProvenance.optional(),
  ttlMs: z.number().int().positive().optional(),
  expiresAt: z.string().datetime().optional(),
  disabled: z.boolean().optional(),
  supersedes: z.string().min(1).optional(),
  tags: z.array(z.string()).default([]),
  confidence: z.number().min(0).max(1).optional(),
  type: MemoryType.optional(),
  importance: z.number().min(0).max(1).optional(),
  observedAt: z.string().datetime().optional(),
  validFrom: z.string().datetime().optional(),
  validTo: z.string().datetime().optional(),
  sources: MemorySourceEvidenceInputList.optional()
}).strict()
  .superRefine(reportInvalidValidityInterval)
  .superRefine(reportConflictingExpiry)
export type MemoryCreateRequest = z.input<typeof MemoryCreateRequest>

export const MemoryUpdateRequest = z.object({
  content: z.string().min(1).optional(),
  tags: z.array(z.string()).optional(),
  confidence: z.number().min(0).max(1).optional(),
  importance: z.number().min(0).max(1).optional(),
  type: MemoryType.optional(),
  observedAt: z.string().datetime().optional(),
  validFrom: z.string().datetime().nullable().optional(),
  validTo: z.string().datetime().nullable().optional(),
  sources: MemorySourceEvidenceInputList.optional(),
  expiresAt: z.string().datetime().nullable().optional(),
  disabled: z.boolean().optional()
}).strict().superRefine(reportInvalidValidityInterval)
export type MemoryUpdateRequest = z.input<typeof MemoryUpdateRequest>

export const MemoryFreshnessClass = z.enum(['fresh', 'recent', 'aging', 'stale'])
export type MemoryFreshnessClass = z.infer<typeof MemoryFreshnessClass>
export const MemoryRetrievalMode = z.enum(['sqlite-fts5', 'filesystem-fallback'])
export type MemoryRetrievalMode = z.infer<typeof MemoryRetrievalMode>
export const MemoryRankingFeatures = z.object({
  lexical: z.number().min(0).max(1),
  scopeAffinity: z.number().min(0).max(1),
  typeAffinity: z.number().min(0).max(1),
  freshness: z.number().min(0).max(1),
  importance: z.number().min(0).max(1),
  confidence: z.number().min(0).max(1),
  finalScore: z.number().min(0).max(1)
}).strict()
export type MemoryRankingFeatures = z.infer<typeof MemoryRankingFeatures>

export const MemoryRetrievalTrace = z.object({
  timestamp: z.string(),
  mode: MemoryRetrievalMode,
  queryTokenCount: z.number().int().nonnegative(),
  queryTokensTruncated: z.boolean(),
  candidateCount: z.number().int().nonnegative(),
  filtered: z.object({
    scope: z.number().int().nonnegative(),
    lifecycle: z.number().int().nonnegative(),
    irrelevant: z.number().int().nonnegative()
  }).strict(),
  rankings: z.array(z.object({
    memoryId: z.string(),
    channel: z.enum(['fts5', 'type-affinity', 'filesystem']),
    features: MemoryRankingFeatures,
    selected: z.boolean()
  }).strict()).max(MEMORY_MAX_TRACE_RANKINGS),
  selectedIds: z.array(z.string()).max(MEMORY_MAX_TRACE_RANKINGS),
  excludedByPromptBudget: z.array(z.string()).max(MEMORY_MAX_TRACE_RANKINGS),
  truncatedIds: z.array(z.string()).max(MEMORY_MAX_TRACE_RANKINGS),
  selectedCharacters: z.number().int().nonnegative(),
  recordLimit: z.number().int().nonnegative(),
  promptCharacterBudget: z.number().int().nonnegative(),
  rankingWeights: z.record(z.string(), z.number())
}).strict()
export type MemoryRetrievalTrace = z.infer<typeof MemoryRetrievalTrace>

export const MemoryIndexState = z.enum(['disabled', 'ready', 'backfilling', 'degraded', 'filesystem'])
export const MemoryDiagnostics = z.object({
  enabled: z.boolean(),
  rootDir: z.string(),
  activeCount: z.number().int().nonnegative(),
  tombstoneCount: z.number().int().nonnegative(),
  lastInjectedIds: z.array(z.string()).default([]),
  canonicalCount: z.number().int().nonnegative().optional(),
  malformedCount: z.number().int().nonnegative().optional(),
  indexState: MemoryIndexState.optional(),
  indexSchemaVersion: z.number().int().nonnegative().optional(),
  indexedCount: z.number().int().nonnegative().optional(),
  staleCount: z.number().int().nonnegative().optional(),
  backfill: z.object({
    running: z.boolean(),
    scanned: z.number().int().nonnegative(),
    remaining: z.number().int().nonnegative()
  }).strict().optional(),
  degradedReason: z.string().max(512).optional(),
  lastRetrieval: MemoryRetrievalTrace.optional()
}).strict()
export type MemoryDiagnostics = z.infer<typeof MemoryDiagnostics>

function inferLegacyMemoryType(tags: string[]): MemoryType {
  const normalized = new Set(tags.map((tag) => tag.trim().toLowerCase()))
  if (normalized.has('preference') || normalized.has('preferences') || normalized.has('偏好')) return 'preference'
  if (normalized.has('decision') || normalized.has('决定')) return 'decision'
  if (normalized.has('episode') || normalized.has('经历')) return 'episode'
  if (normalized.has('relationship') || normalized.has('关系')) return 'relationship'
  if (normalized.has('insight') || normalized.has('洞察')) return 'insight'
  return 'fact'
}

function defaultImportance(kind: MemorySourceKind | undefined): number {
  switch (kind) {
    case 'user': return 0.8
    case 'file': return 0.6
    case 'tool': return 0.5
    case 'web': return 0.4
    case 'inference': return 0.3
    default: return 0.5
  }
}

function validTimestamp(primary: string, fallback: string): string {
  const primaryMs = Date.parse(primary)
  if (Number.isFinite(primaryMs)) return new Date(primaryMs).toISOString()
  const fallbackMs = Date.parse(fallback)
  return Number.isFinite(fallbackMs)
    ? new Date(fallbackMs).toISOString()
    : new Date(0).toISOString()
}

function legacyEvidence(record: z.infer<typeof MemoryRecordInput>): MemorySourceEvidence[] {
  const provenance = record.provenance
  const kind = provenance?.kind ?? 'legacy'
  const locator = provenance?.file ?? provenance?.origin
  const turnId = record.sourceTurnId ?? provenance?.turnId
  return [{
    id: 'source_legacy_1',
    kind,
    ...(record.sourceThreadId ? { threadId: record.sourceThreadId } : {}),
    ...(turnId ? { turnId } : {}),
    ...(locator ? { locator: locator.slice(0, MEMORY_MAX_SOURCE_LOCATOR_CHARS) } : {}),
    trust: kind === 'user' ? 'explicit-user' : kind === 'inference' ? 'inferred' : 'legacy'
  }]
}

function reportDuplicateSourceIds(
  sources: ReadonlyArray<{ id?: string }>,
  context: z.RefinementCtx
): void {
  const seen = new Set<string>()
  for (let index = 0; index < sources.length; index += 1) {
    const id = sources[index]?.id
    if (!id || !seen.has(id)) {
      if (id) seen.add(id)
      continue
    }
    context.addIssue({
      code: 'custom',
      path: [index, 'id'],
      message: 'memory source evidence ids must be unique'
    })
  }
}

function reportInvalidValidityInterval(
  value: { validFrom?: string | null; validTo?: string | null },
  context: z.RefinementCtx
): void {
  if (!value.validFrom || !value.validTo || Date.parse(value.validFrom) <= Date.parse(value.validTo)) return
  context.addIssue({
    code: 'custom',
    path: ['validTo'],
    message: 'memory validFrom must not be after validTo'
  })
}

function reportConflictingExpiry(
  value: { ttlMs?: number; expiresAt?: string },
  context: z.RefinementCtx
): void {
  if (value.ttlMs === undefined || value.expiresAt === undefined) return
  context.addIssue({
    code: 'custom',
    path: ['expiresAt'],
    message: 'memory ttlMs and expiresAt are mutually exclusive'
  })
}
