import { z } from 'zod'
import { MemoryConsolidation, MemoryRevisionSnapshot, MemoryScope } from './memory.js'

export const MEMORY_RELATION_MAX_RECORD_CHARS = 2000
const MemoryId = z.string().regex(/^[A-Za-z][A-Za-z0-9_-]{0,127}$/u)
export const MemoryRelationKind = z.enum(['confirms', 'contradicts', 'extends'])
export const MemoryRelationBinding = z.object({
  id: MemoryId,
  revision: z.number().int().positive(),
  fingerprint: z.string().regex(/^[a-f0-9]{64}$/u)
}).strict()
export type MemoryRelationBinding = z.infer<typeof MemoryRelationBinding>

export const MemoryRelationSpan = z.object({
  start: z.number().int().min(0).max(32_000),
  end: z.number().int().min(1).max(32_000)
}).strict().refine((span) => span.end > span.start && span.end - span.start <= 512)

export const MemoryRelationProposal = z.object({
  source: MemoryRelationBinding,
  target: MemoryRelationBinding,
  kind: MemoryRelationKind,
  sourceEvidence: MemoryRelationSpan,
  targetEvidence: MemoryRelationSpan
}).strict().refine((entry) => entry.source.id !== entry.target.id)
export type MemoryRelationProposal = z.infer<typeof MemoryRelationProposal>

export const MemoryRelationSuggestion = z.object({
  id: z.string().regex(/^relation_[a-f0-9]{64}$/u),
  proposal: MemoryRelationProposal,
  generator: z.literal('model-relations-v1'),
  status: z.enum(['pending', 'accepted', 'rejected']),
  createdAt: z.string().datetime(),
  decidedAt: z.string().datetime().optional()
}).strict()
export type MemoryRelationSuggestion = z.infer<typeof MemoryRelationSuggestion>

// Never accept agent management privileges or all:true from this UI/API surface.
export const MemoryRelationAccess = z.object({
  workspace: z.string().min(1).max(4096).optional(),
  project: z.string().min(1).max(4096).optional()
}).strict()

export const MemoryRelationCommand = z.discriminatedUnion('action', [
  z.object({ action: z.literal('list'), memoryId: MemoryId, access: MemoryRelationAccess }).strict(),
  z.object({
    action: z.literal('propose'),
    proposals: z.array(MemoryRelationProposal).max(8),
    access: MemoryRelationAccess
  }).strict(),
  z.object({
    action: z.literal('review'),
    id: MemoryRelationSuggestion.shape.id,
    decision: z.enum(['accepted', 'rejected']),
    access: MemoryRelationAccess
  }).strict(),
  z.object({
    action: z.literal('withdraw'),
    id: MemoryRelationSuggestion.shape.id,
    access: MemoryRelationAccess
  }).strict()
])
export type MemoryRelationCommand = z.infer<typeof MemoryRelationCommand>

const MemoryRelationEndpoint = z.object({
  id: MemoryId, revision: z.number().int().positive(), scope: MemoryScope,
  content: z.string().max(MEMORY_RELATION_MAX_RECORD_CHARS),
  sources: MemoryRevisionSnapshot.shape.sources, consolidation: MemoryConsolidation.optional()
}).strict()
export const MemoryRelationView = z.object({
  suggestion: MemoryRelationSuggestion,
  stale: z.boolean(),
  source: MemoryRelationEndpoint,
  target: MemoryRelationEndpoint
}).strict()
export const MemoryRelationResult = z.object({ relations: z.array(MemoryRelationView).max(200) }).strict()
export type MemoryRelationResult = z.infer<typeof MemoryRelationResult>

export const MemoryRelationAnalyzeRequest = z.object({
  memoryId: MemoryId,
  expectedRevision: z.number().int().positive(),
  access: MemoryRelationAccess
}).strict()
export type MemoryRelationAnalyzeRequest = z.infer<typeof MemoryRelationAnalyzeRequest>

export const MemoryRelationModelOutput = z.object({
  relations: z.array(z.object({
    targetId: MemoryId,
    kind: MemoryRelationKind,
    sourceQuote: z.string().trim().min(1).max(512),
    targetQuote: z.string().trim().min(1).max(512)
  }).strict()).max(8)
}).strict()
