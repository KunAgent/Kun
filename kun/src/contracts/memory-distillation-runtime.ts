import { z } from 'zod'
import {
  MemoryCandidate,
  MemoryCandidateDraft,
  MemoryCandidateDurability,
  MemoryCandidateRelation
} from './memory-distillation.js'

export const MEMORY_DISTILLATION_STORE_VERSION = 1 as const
export const MEMORY_DISTILLATION_MAX_CANDIDATES = 8
export const MEMORY_DISTILLATION_PENDING_TTL_MS = 7 * 24 * 60 * 60 * 1_000

export const MemoryDistillationExtractionCandidate = MemoryCandidateDraft.extend({
  durability: MemoryCandidateDurability,
  comparisons: z.array(z.object({
    memoryId: z.string().min(1).max(256),
    relation: MemoryCandidateRelation
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
    targetUpdatedAt: z.string().min(1).max(128)
  }).strict(),
  z.object({
    action: z.literal('supersede'),
    memoryId: z.string().min(1),
    targetUpdatedAt: z.string().min(1).max(128)
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
