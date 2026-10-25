import { z } from 'zod'
import { MemoryRelationAccess, MemoryRelationBinding, MemoryRelationKind } from './memory-relations.js'

export const MEMORY_CONTEXT_MAX_RELATIONS = 6
export const MEMORY_CONTEXT_MAX_CHARACTERS = 1600

// IDs and versions only: chat metadata must not duplicate relation evidence.
export const MemoryRelationAnnotation = z.object({
  id: z.string().regex(/^relation_[a-f0-9]{64}$/u),
  kind: MemoryRelationKind,
  source: MemoryRelationBinding.pick({ id: true, revision: true }),
  target: MemoryRelationBinding.pick({ id: true, revision: true }),
  reviewedAt: z.string().datetime()
}).strict()
export type MemoryRelationAnnotation = z.infer<typeof MemoryRelationAnnotation>

export const MemoryRelationContextRequest = z.object({
  selected: z.array(z.object({
    id: MemoryRelationBinding.shape.id,
    revision: MemoryRelationBinding.shape.revision,
    // Exact selected text (possibly truncated); never used as new evidence.
    content: z.string().min(1).max(2000)
  }).strict()).max(64),
  access: MemoryRelationAccess,
  remainingCharacters: z.number().int().min(0).max(6000),
  purpose: z.enum(['injection', 'preview'])
}).strict()
export type MemoryRelationContextRequest = z.infer<typeof MemoryRelationContextRequest>

export const MemoryRelationContextResult = z.object({
  automaticEnabled: z.boolean(),
  state: z.enum(['disabled', 'ready', 'unavailable']),
  annotations: z.array(MemoryRelationAnnotation).max(MEMORY_CONTEXT_MAX_RELATIONS),
  block: z.string().max(MEMORY_CONTEXT_MAX_CHARACTERS),
  omittedByBudget: z.number().int().nonnegative()
}).strict()
export type MemoryRelationContextResult = z.infer<typeof MemoryRelationContextResult>

export const MemoryWorkingContextRequest = z.object({
  query: z.string().trim().min(1).max(2000),
  workspace: z.string().trim().min(1).max(4096)
}).strict()

export function emptyMemoryRelationContext(
  state: MemoryRelationContextResult['state'] = 'disabled',
  automaticEnabled = false
): MemoryRelationContextResult {
  return { automaticEnabled, state, annotations: [], block: '', omittedByBudget: 0 }
}
