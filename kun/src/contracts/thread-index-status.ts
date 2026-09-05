import { z } from 'zod'

/** Rebuildable SQLite thread-index lifecycle. `unavailable` is synthesized by stores without an index. */
export const ThreadIndexStatusSchema = z.enum([
  'not_started',
  'running',
  'ready',
  'failed',
  'unavailable'
])
export type ThreadIndexStatus = z.infer<typeof ThreadIndexStatusSchema>

/**
 * Progress projection for the rebuildable thread index. `total` is the
 * filesystem snapshot taken when backfill started; threads created afterwards
 * are indexed live and do not grow `total`.
 */
export const ThreadIndexStatusInfoSchema = z.object({
  status: ThreadIndexStatusSchema,
  indexed: z.number().int().nonnegative(),
  total: z.number().int().nonnegative()
})
export type ThreadIndexStatusInfo = z.infer<typeof ThreadIndexStatusInfoSchema>
