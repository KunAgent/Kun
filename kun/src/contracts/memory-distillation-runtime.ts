import { z } from 'zod'
import { MemoryType } from './memory.js'
import {
  MemoryCandidate,
  MemoryCandidateDraft,
  MemoryCandidateDurability,
  MemoryCandidateRelation
} from './memory-distillation.js'

export const MEMORY_DISTILLATION_STORE_VERSION = 1 as const
export const MEMORY_DISTILLATION_MAX_CANDIDATES = 8
export const MEMORY_DISTILLATION_PENDING_TTL_MS = 7 * 24 * 60 * 60 * 1_000

// Extraction parses raw model output, which is untrusted: a single bad
// value must not reject the whole response and fail the memory run.
// Scalar enum fields fall back to their conservative member at this
// boundary only; the canonical schemas in memory-distillation.ts stay
// strict.
// - durability: anything not exactly 'durable' is treated as 'transient',
//   so the candidate is skipped as non-durable instead of persisted.
// - type: unknown types degrade to the generic 'fact'.
// - confidence / importance: models routinely answer with a numeric
//   string ('0.9') or a percentage (85, '85%') instead of a 0-1 JSON
//   number; both are normalized to the 0-1 number the canonical schema
//   expects. A score that is missing or not numeric at all is NOT
//   replaced with an invented default: it still fails validation and
//   the candidate is dropped with a diagnostic, because a fabricated
//   confidence would silently clear the low-confidence gate.
// Comparisons are different: they carry consolidation intent against
// existing memories, so silently dropping a malformed comparison would
// turn a supersede/update into a plain create that bypasses conflict
// review. parseMemoryDistillationExtractionResponse therefore validates
// candidates one by one and drops a candidate that fails validation,
// reporting it in `dropped` so callers can retain a diagnostic instead
// of writing the candidate as an unrelated new memory.
const ExtractionMemoryType = MemoryType.catch('fact')
const ExtractionDurability = MemoryCandidateDurability.catch('transient')

const ExtractionScore = z.unknown()
  .transform(normalizeExtractionScore)
  .pipe(z.number().min(0).max(1))

export const MemoryDistillationExtractionCandidate = MemoryCandidateDraft.extend({
  type: ExtractionMemoryType,
  confidence: ExtractionScore,
  importance: ExtractionScore,
  durability: ExtractionDurability,
  comparisons: z.array(z.object({
    memoryId: z.string().min(1).max(256),
    relation: MemoryCandidateRelation,
    reason: z.string().trim().min(1).max(1000).optional()
  }).strict()).max(8).default([])
}).strict()
export type MemoryDistillationExtractionCandidate = z.infer<
  typeof MemoryDistillationExtractionCandidate
>

export const MemoryDistillationExtractionResponse = z.object({
  candidates: z.array(MemoryDistillationExtractionCandidate)
    .max(MEMORY_DISTILLATION_MAX_CANDIDATES)
}).strict()
export type MemoryDistillationExtractionResponse = z.infer<
  typeof MemoryDistillationExtractionResponse
>

export type MemoryDistillationExtractionDroppedCandidate = {
  index: number
  error: string
}

export type MemoryDistillationExtractionParseResult = {
  candidates: MemoryDistillationExtractionCandidate[]
  dropped: MemoryDistillationExtractionDroppedCandidate[]
}

const ExtractionEnvelope = z.object({ candidates: z.array(z.unknown()) })

/**
 * Parse raw extraction model output candidate by candidate. A candidate
 * that fails validation (for example a comparison with an out-of-enum
 * relation) is dropped and reported in `dropped` with a compact reason,
 * so one damaged candidate neither fails the whole response nor slips
 * through as an unrelated new memory. A malformed envelope (not an
 * object, or `candidates` not an array) still throws, like
 * MemoryDistillationExtractionResponse.parse did.
 */
export function parseMemoryDistillationExtractionResponse(
  raw: unknown
): MemoryDistillationExtractionParseResult {
  const { candidates: rawCandidates } = ExtractionEnvelope.parse(raw)
  const candidates: MemoryDistillationExtractionCandidate[] = []
  const dropped: MemoryDistillationExtractionDroppedCandidate[] = []
  rawCandidates.forEach((rawCandidate, index) => {
    if (index >= MEMORY_DISTILLATION_MAX_CANDIDATES) {
      dropped.push({
        index,
        error: `exceeds the ${MEMORY_DISTILLATION_MAX_CANDIDATES}-candidate limit`
      })
      return
    }
    const parsed = MemoryDistillationExtractionCandidate.safeParse(rawCandidate)
    if (parsed.success) candidates.push(parsed.data)
    else dropped.push({ index, error: summarizeExtractionIssues(parsed.error) })
  })
  return { candidates, dropped }
}

/**
 * Normalize one raw confidence/importance value to a 0-1 number.
 * Numbers pass through, numeric strings are parsed, and any value in
 * (1, 100] is read as a percentage and rescaled. Anything else becomes
 * NaN, which the piped canonical range check rejects, so the candidate
 * is dropped with a diagnostic instead of being scored by a guess.
 */
function normalizeExtractionScore(value: unknown): number {
  let numeric: number
  let percent = false
  if (typeof value === 'number') {
    numeric = value
  } else if (typeof value === 'string') {
    const raw = value.trim()
    percent = raw.endsWith('%')
    const text = percent ? raw.slice(0, -1).trim() : raw
    if (!/^[+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:e[+-]?\d+)?$/i.test(text)) return Number.NaN
    numeric = Number(text)
  } else {
    return Number.NaN
  }
  if (!Number.isFinite(numeric)) return Number.NaN
  return percent || (numeric > 1 && numeric <= 100) ? numeric / 100 : numeric
}

function summarizeExtractionIssues(error: z.ZodError): string {
  return error.issues
    .slice(0, 3)
    .map((issue) => {
      const path = issue.path.join('.')
      return path ? `${path}: ${issue.code}` : issue.code
    })
    .join('; ')
    .slice(0, 200)
}

export const MemoryDistillationTarget = z.object({
  scope: z.literal('workspace'),
  workspace: z.string().min(1)
}).strict()
export type MemoryDistillationTarget = z.infer<typeof MemoryDistillationTarget>

export const MemoryDistillationProposedAction = z.discriminatedUnion('action', [
  z.object({ action: z.literal('create') }).strict(),
  z.object({
    action: z.literal('update'),
    memoryId: z.string().min(1),
    targetUpdatedAt: z.string().min(1).max(128),
    targetFingerprint: z.string().regex(/^[a-f0-9]{64}$/).optional()
  }).strict(),
  z.object({
    action: z.literal('supersede'),
    memoryId: z.string().min(1),
    targetUpdatedAt: z.string().min(1).max(128),
    targetFingerprint: z.string().regex(/^[a-f0-9]{64}$/).optional()
  }).strict()
])
export type MemoryDistillationProposedAction = z.infer<
  typeof MemoryDistillationProposedAction
>

export const MemoryDistillationCandidateStatus = z.enum([
  'pending',
  'applying',
  'allowed',
  'denied',
  'timed-out',
  'expired',
  'withdrawn',
  'conflicted',
  'failed'
])
export type MemoryDistillationCandidateStatus = z.infer<
  typeof MemoryDistillationCandidateStatus
>

export const MemoryDistillationHistoryEntry = z.object({
  status: MemoryDistillationCandidateStatus,
  at: z.string().datetime(),
  reason: z.string().min(1).max(512).optional()
}).strict()

export const MemoryDistillationApplyReceipt = z.object({
  operationId: z.string().min(1).max(128),
  expectedMemoryId: z.string().min(1).max(256),
  targetUpdatedAt: z.string().min(1).max(128).optional()
}).strict()
export type MemoryDistillationApplyReceipt = z.infer<
  typeof MemoryDistillationApplyReceipt
>

export const PendingMemoryCandidate = z.object({
  schemaVersion: z.literal(MEMORY_DISTILLATION_STORE_VERSION),
  id: z.string().min(1),
  fingerprint: z.string().regex(/^[a-f0-9]{64}$/),
  threadId: z.string().min(1),
  turnId: z.string().min(1),
  target: MemoryDistillationTarget,
  candidate: MemoryCandidate,
  proposedAction: MemoryDistillationProposedAction,
  status: MemoryDistillationCandidateStatus,
  createdAt: z.string().datetime(),
  expiresAt: z.string().datetime(),
  history: z.array(MemoryDistillationHistoryEntry).min(1),
  applyReceipt: MemoryDistillationApplyReceipt.optional(),
  memoryId: z.string().min(1).optional()
}).strict()
export type PendingMemoryCandidate = z.infer<typeof PendingMemoryCandidate>

export const MemoryDistillationRunStatus = z.enum(['processing', 'completed', 'failed'])
export const MemoryDistillationRun = z.object({
  schemaVersion: z.literal(MEMORY_DISTILLATION_STORE_VERSION),
  id: z.string().min(1),
  threadId: z.string().min(1),
  turnId: z.string().min(1),
  status: MemoryDistillationRunStatus,
  createdAt: z.string().datetime(),
  completedAt: z.string().datetime().optional(),
  candidateCount: z.number().int().nonnegative().max(MEMORY_DISTILLATION_MAX_CANDIDATES)
    .optional(),
  diagnostic: z.string().min(1).max(512).optional()
}).strict()
export type MemoryDistillationRun = z.infer<typeof MemoryDistillationRun>

export const MemoryDistillationStoreState = z.object({
  schemaVersion: z.literal(MEMORY_DISTILLATION_STORE_VERSION),
  runs: z.array(MemoryDistillationRun).default([]),
  candidates: z.array(PendingMemoryCandidate).default([])
}).strict()
export type MemoryDistillationStoreState = z.infer<typeof MemoryDistillationStoreState>

export const MemoryDistillationDecisionRequest = z.object({
  decision: z.enum(['allow', 'deny', 'withdraw'])
}).strict()
export type MemoryDistillationDecisionRequest = z.infer<
  typeof MemoryDistillationDecisionRequest
>
