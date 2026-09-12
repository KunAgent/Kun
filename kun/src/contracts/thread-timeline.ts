import { z } from 'zod'

export const THREAD_TIMELINE_MAX_ITEMS = 300
export const THREAD_TIMELINE_MAX_ITEM_BYTES = 4 * 1024 * 1024

export const ThreadTimelinePageSchema = z.object({
  nextCursor: z.string().min(1).optional(),
  hasMore: z.boolean(),
  itemCount: z.number().int().nonnegative().max(THREAD_TIMELINE_MAX_ITEMS),
  itemBytes: z.number().int().nonnegative().max(THREAD_TIMELINE_MAX_ITEM_BYTES)
})
export type ThreadTimelinePage = z.infer<typeof ThreadTimelinePageSchema>
