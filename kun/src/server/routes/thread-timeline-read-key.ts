import { z } from 'zod'
import { THREAD_TIMELINE_MAX_ITEMS } from '../../contracts/threads.js'

/**
 * Query parsing for the timeline endpoint is shared between the route handler
 * (validation / 400s) and the read-coalescing key so both always agree on what
 * constitutes the same logical read.
 */
export const ThreadTimelineQuerySchema = z.object({
  /** Client projection epoch: a Labs toggle must not join an older in-flight history read. */
  historyRevision: z.preprocess((value) => value === undefined ? undefined : Number(value),
    z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER).optional()),
  turnId: z.string().min(1).max(256).optional(),
  itemId: z.string().min(1).max(512).optional(),
  before: z.string().min(1).max(4096).optional(),
  limit: z.preprocess((value) => {
    if (typeof value !== 'string' || value.trim() === '') return THREAD_TIMELINE_MAX_ITEMS
    return Number(value)
  }, z.number().int().positive().max(THREAD_TIMELINE_MAX_ITEMS))
}).refine((value) => !value.itemId || Boolean(value.turnId), {
  message: 'An item anchor requires its turnId'
})

export type ThreadTimelineQuery = z.infer<typeof ThreadTimelineQuerySchema>

export function parseThreadTimelineQuery(url: URL) {
  return ThreadTimelineQuerySchema.safeParse({
    historyRevision: url.searchParams.get('historyRevision') ?? undefined,
    turnId: url.searchParams.get('turnId') ?? undefined,
    itemId: url.searchParams.get('itemId') ?? undefined,
    before: url.searchParams.get('before') ?? undefined,
    limit: url.searchParams.get('limit') ?? undefined
  })
}

/**
 * Semantic coalescing key for timeline reads. Priority is deliberately not part
 * of the key: a foreground open and a background warm-up reading the same thread
 * with the same query must share one physical read. Query parameters are
 * normalized (default limit, order-insensitive) so `?limit=300` and no params
 * collapse to the same key. Invalid queries fall back to the raw search string
 * so they are only coalesced among themselves (each yields a 400 anyway).
 */
export function threadTimelineReadKey(threadId: string, url: URL): string {
  const parsed = parseThreadTimelineQuery(url)
  if (!parsed.success) {
    return `${threadId}|raw:${url.search}`
  }
  const before = parsed.data.before ? encodeURIComponent(parsed.data.before) : ''
  const turn = parsed.data.turnId ? `|turn:${encodeURIComponent(parsed.data.turnId)}` : ''
  const item = parsed.data.itemId ? `|item:${encodeURIComponent(parsed.data.itemId)}` : ''
  const history = parsed.data.historyRevision === undefined ? '' : `|history:${parsed.data.historyRevision}`
  return `${threadId}|before:${before}|limit:${parsed.data.limit}${turn}${item}${history}`
}
