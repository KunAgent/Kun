import { z } from 'zod'

/**
 * Host-written provenance for a `relation: 'task'` thread: which suggestion
 * card started it and where it sits on that card. Never accepted from a
 * request body; the sidebar nests the thread under `parentThreadId` with it.
 */
export const ThreadTaskOriginSchema = z.object({
  intentId: z.string().min(1).max(256),
  taskId: z.string().min(1).max(64),
  index: z.number().int().min(1).max(64),
  total: z.number().int().min(1).max(64)
}).strict()
export type ThreadTaskOrigin = z.infer<typeof ThreadTaskOriginSchema>
