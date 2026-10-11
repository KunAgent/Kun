import { z } from 'zod'
import { MemoryRecord, MemoryRevision } from './memory.js'

export const MemoryLifecycleRequest = z.object({
  action: z.enum(['disable', 'restore', 'forget', 'erase', 'rollback']),
  expectedRevision: z.number().int().positive(),
  targetRevision: z.number().int().positive().optional(),
  confirmation: z.object({ memoryId: z.string().min(1), irreversible: z.literal(true) }).strict().optional()
}).strict().superRefine((input, ctx) => {
  if (input.action === 'rollback' && input.targetRevision === undefined) {
    ctx.addIssue({ code: 'custom', path: ['targetRevision'], message: 'rollback requires a target revision' })
  }
  if (input.action === 'erase' && !input.confirmation) {
    ctx.addIssue({ code: 'custom', path: ['confirmation'], message: 'irreversible erasure requires explicit confirmation' })
  }
})
export type MemoryLifecycleRequest = z.infer<typeof MemoryLifecycleRequest>
export const MemoryLifecycleResult = z.object({
  memory: MemoryRecord.optional(), erased: z.boolean(), affectedIds: z.array(z.string())
}).strict()
export type MemoryLifecycleResult = z.infer<typeof MemoryLifecycleResult>
export const MemoryHistoryResult = z.object({
  memoryId: z.string(), revision: z.number().int().positive(), history: z.array(MemoryRevision)
}).strict()
export type MemoryHistoryResult = z.infer<typeof MemoryHistoryResult>
