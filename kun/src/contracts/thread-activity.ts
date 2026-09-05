import { z } from 'zod'

export const ThreadActivityKindSchema = z.enum([
  'created',
  'metadata',
  'runtime',
  'deleted'
])
export type ThreadActivityKind = z.infer<typeof ThreadActivityKindSchema>

export const ThreadActivityChangeSchema = z.object({
  threadId: z.string().min(1),
  kind: ThreadActivityKindSchema,
  threadSeq: z.number().int().nonnegative().optional()
}).strict()
export type ThreadActivityChange = z.infer<typeof ThreadActivityChangeSchema>

export const ThreadActivityBatchSchema = z.object({
  cursor: z.string().min(1),
  changes: z.array(ThreadActivityChangeSchema)
}).strict()
export type ThreadActivityBatch = z.infer<typeof ThreadActivityBatchSchema>
