import { z } from 'zod'
import {
  MEMORY_MAX_SOURCES,
  MemorySourceEvidence,
  MemoryType
} from './memory.js'

export const MEMORY_CANDIDATE_MAX_CONTENT_CHARS = 4_096
export const MEMORY_CANDIDATE_MAX_TAGS = 16
export const MEMORY_CANDIDATE_MAX_TAG_CHARS = 64
export const MEMORY_CANDIDATE_MAX_COMPARISONS = 8
export const MEMORY_CANDIDATE_MIN_CONFIDENCE = 0.6

const CandidateContent = z.string()
  .max(MEMORY_CANDIDATE_MAX_CONTENT_CHARS)
  .transform(normalizeMemoryCandidateContent)
  .pipe(z.string().min(1).max(MEMORY_CANDIDATE_MAX_CONTENT_CHARS))

const CandidateTag = z.string()
  .max(MEMORY_CANDIDATE_MAX_TAG_CHARS)
  .transform(normalizeMemoryCandidateTag)
  .pipe(z.string().min(1).max(MEMORY_CANDIDATE_MAX_TAG_CHARS))

const CandidateTags = z.array(CandidateTag)
  .max(MEMORY_CANDIDATE_MAX_TAGS)
  .transform((tags) => [...new Set(tags)].sort(compareText))

const CandidateSource = MemorySourceEvidence.transform(normalizeCandidateSource)
  .pipe(MemorySourceEvidence)

const CandidateSources = z.array(CandidateSource)
  .min(1)
  .max(MEMORY_MAX_SOURCES)
  .superRefine((sources, context) => reportDuplicateValues(
    sources.map((source) => source.id),
    'source id',
    context
  ))
  .transform((sources) => [...sources].sort((left, right) => compareText(left.id, right.id)))

const CandidateSourceId = z.string()
  .max(128)
  .transform(normalizeIdentifier)
  .pipe(z.string().min(1).max(128))

const CandidateSourceIds = z.array(CandidateSourceId)
  .min(1)
  .max(MEMORY_MAX_SOURCES)
  .superRefine((sourceIds, context) => reportDuplicateValues(
    sourceIds,
    'source id',
    context
  ))
  .transform((sourceIds) => [...sourceIds].sort(compareText))

export const MemoryCandidateDraft = z.object({
  content: CandidateContent,
  type: MemoryType,
  confidence: z.number().min(0).max(1),
  importance: z.number().min(0).max(1),
  tags: CandidateTags,
  sourceIds: CandidateSourceIds
}).strict()
export type MemoryCandidateDraft = z.output<typeof MemoryCandidateDraft>
export type MemoryCandidateDraftInput = z.input<typeof MemoryCandidateDraft>

export const MemoryCandidate = z.object({
  content: CandidateContent,
  type: MemoryType,
  confidence: z.number().min(0).max(1),
  importance: z.number().min(0).max(1),
  observedAt: z.string().datetime(),
  tags: CandidateTags,
  sources: CandidateSources
}).strict()
export type MemoryCandidate = z.output<typeof MemoryCandidate>
export type MemoryCandidateInput = z.input<typeof MemoryCandidate>

export const MemoryCandidateEvidenceContext = z.object({
  observedAt: z.string().datetime(),
  sources: CandidateSources
}).strict()
export type MemoryCandidateEvidenceContext = z.output<typeof MemoryCandidateEvidenceContext>
export type MemoryCandidateEvidenceContextInput = z.input<typeof MemoryCandidateEvidenceContext>

export const MemoryCandidateDurability = z.enum(['durable', 'transient'])
export type MemoryCandidateDurability = z.infer<typeof MemoryCandidateDurability>

export const MemoryCandidateRelation = z.enum(['duplicate', 'update', 'supersede'])
export type MemoryCandidateRelation = z.infer<typeof MemoryCandidateRelation>

const MemoryCandidateComparison = z.object({
  memoryId: z.string()
    .max(256)
    .transform(normalizeIdentifier)
    .pipe(z.string().min(1).max(256)),
  relation: MemoryCandidateRelation
}).strict()

const MemoryCandidateComparisons = z.array(MemoryCandidateComparison)
  .max(MEMORY_CANDIDATE_MAX_COMPARISONS)
  .superRefine((comparisons, context) => reportDuplicateValues(
    comparisons.map((comparison) => comparison.memoryId),
    'comparison memory id',
    context
  ))
  .transform((comparisons) => [...comparisons].sort(compareComparisons))

export const MemoryCandidateAssessment = z.object({
  candidate: MemoryCandidateDraft,
  durability: MemoryCandidateDurability,
  comparisons: MemoryCandidateComparisons.default([])
}).strict()
export type MemoryCandidateAssessment = z.output<typeof MemoryCandidateAssessment>
export type MemoryCandidateAssessmentInput = z.input<typeof MemoryCandidateAssessment>

export const DistillationSkipReason = z.enum([
  'duplicate',
  'low-confidence',
  'non-durable',
  'sensitive'
])
export type DistillationSkipReason = z.infer<typeof DistillationSkipReason>

export const DistillationDecision = z.discriminatedUnion('action', [
  z.object({ action: z.literal('create'), candidate: MemoryCandidate }).strict(),
  z.object({
    action: z.literal('update'),
    memoryId: z.string().min(1),
    candidate: MemoryCandidate
  }).strict(),
  z.object({
    action: z.literal('supersede'),
    memoryId: z.string().min(1),
    candidate: MemoryCandidate
  }).strict(),
  z.object({ action: z.literal('skip'), reason: DistillationSkipReason }).strict()
])
export type DistillationDecision = z.infer<typeof DistillationDecision>

export function normalizeMemoryCandidateContent(value: string): string {
  return value.normalize('NFKC').replace(/\r\n?/g, '\n').replace(/\s+/gu, ' ').trim()
}

function normalizeMemoryCandidateTag(value: string): string {
  return value.normalize('NFKC').trim().toLocaleLowerCase('en-US')
}

function normalizeCandidateSource(source: z.infer<typeof MemorySourceEvidence>) {
  return {
    ...source,
    id: normalizeIdentifier(source.id),
    ...(source.threadId ? { threadId: normalizeIdentifier(source.threadId) } : {}),
    ...(source.turnId ? { turnId: normalizeIdentifier(source.turnId) } : {}),
    ...(source.itemId ? { itemId: normalizeIdentifier(source.itemId) } : {}),
    ...(source.locator ? { locator: normalizeEvidenceText(source.locator) } : {}),
    ...(source.excerpt ? { excerpt: normalizeEvidenceText(source.excerpt) } : {}),
    ...(source.contentHash ? { contentHash: source.contentHash.trim() } : {})
  }
}

function normalizeIdentifier(value: string): string {
  return value.normalize('NFKC').trim()
}

function normalizeEvidenceText(value: string): string {
  return value.normalize('NFKC').replace(/\r\n?/g, '\n').trim()
}

function compareComparisons(
  left: z.infer<typeof MemoryCandidateComparison>,
  right: z.infer<typeof MemoryCandidateComparison>
): number {
  return compareText(left.relation, right.relation) || compareText(left.memoryId, right.memoryId)
}

function compareText(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0
}

function reportDuplicateValues(
  values: readonly string[],
  label: string,
  context: z.RefinementCtx
): void {
  const seen = new Set<string>()
  values.forEach((value, index) => {
    if (seen.has(value)) {
      context.addIssue({
        code: 'custom',
        path: [index],
        message: `duplicate ${label}: ${value}`
      })
    }
    seen.add(value)
  })
}
