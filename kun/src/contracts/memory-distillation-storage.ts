import { z } from 'zod'
import { MemoryCandidate } from './memory-distillation.js'
import { MemoryRecord } from './memory.js'
import {
  MemoryDistillationApplyReceipt,
  MemoryDistillationCandidateStatus,
  MemoryDistillationProposedAction,
  MemoryDistillationTarget
} from './memory-distillation-runtime.js'

const id = z.string().min(1).max(256)
export const MemoryDistillationCandidateInsert = z.object({
  threadId: id, turnId: id, target: MemoryDistillationTarget,
  candidate: MemoryCandidate, proposedAction: MemoryDistillationProposedAction
}).strict()
const turn = { threadId: id, turnId: id }
export const MemoryDistillationPendingRequest = z.discriminatedUnion('operation', [
  z.object({ operation: z.literal('ready') }).strict(),
  z.object({ operation: z.literal('beginRun'), ...turn }).strict(),
  z.object({ operation: z.literal('completeRun'), ...turn,
    inserts: z.array(MemoryDistillationCandidateInsert).max(8) }).strict(),
  z.object({ operation: z.literal('failRun'), ...turn,
    diagnostic: z.string().max(512) }).strict(),
  z.object({ operation: z.literal('list'), workspace: z.string().min(1).optional(),
    status: MemoryDistillationCandidateStatus.optional() }).strict(),
  z.object({ operation: z.literal('get'), id }).strict(),
  z.object({ operation: z.literal('expireDue') }).strict(),
  z.object({ operation: z.literal('transition'), id,
    from: z.array(MemoryDistillationCandidateStatus).min(1).max(10),
    to: MemoryDistillationCandidateStatus,
    options: z.object({ reason: z.string().max(512).optional(), memoryId: id.optional(),
      applyReceipt: MemoryDistillationApplyReceipt.optional() }).strict()
  }).strict()
])

export const MemoryDistillationCommitResult = z.discriminatedUnion('ok', [
  z.object({ ok: z.literal(true), record: MemoryRecord }).strict(),
  z.object({ ok: z.literal(false), conflict: z.string().min(1).max(512) }).strict()
])
