import { z } from 'zod'
import { MemoryRecord } from './memory.js'
import { MemoryRelationContextResult } from './memory-working-context.js'

export const MemoryWorkingContextPreview = z.object({
  memories: z.array(MemoryRecord).max(64),
  relations: MemoryRelationContextResult,
  referenceBlocks: z.array(z.string()).max(2),
  characterCount: z.number().int().nonnegative(),
  characterBudget: z.number().int().positive()
}).strict()
export type MemoryWorkingContextPreview = z.infer<typeof MemoryWorkingContextPreview>
