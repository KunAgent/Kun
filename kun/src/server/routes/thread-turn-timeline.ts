import { ThreadTimelineResponseSchema, THREAD_TIMELINE_MAX_ITEM_BYTES, type ThreadRecord } from '../../contracts/threads.js'
import type { SessionStore } from '../../ports/session-store.js'
import { jsonResponse, type JsonResponse } from '../response.js'
import { hydrateThreadItemsFromSession, omitTurnItems, projectTimelineThread, projectTimelineTurn } from './thread-projection.js'

/** Exact history reads never heal, reconcile gates or persist state. */
export async function getExactTurnTimeline(
  thread: ThreadRecord,
  turnId: string,
  options: { before?: string; limit: number },
  sessions: SessionStore,
  latestSeq: number
): Promise<JsonResponse> {
  const turn = thread.turns.find((candidate) => candidate.id === turnId)
  if (!turn) return jsonResponse({ code: 'not_found', message: `turn not found: ${turnId}` }, 404)
  if (!sessions.loadItemPage) {
    return jsonResponse({ code: 'history_unavailable', message: 'exact-turn item paging unavailable' }, 503)
  }
  const page = await sessions.loadItemPage(thread.id, {
    turnId,
    ...(options.before ? { before: options.before } : { anchorTurnId: turnId }),
    maxItems: options.limit,
    maxBytes: THREAD_TIMELINE_MAX_ITEM_BYTES
  })
  const projection = hydrateThreadItemsFromSession({ ...thread, turns: [{ ...turn, items: [] }] }, page.items)
  return jsonResponse(ThreadTimelineResponseSchema.parse({
    ...projectTimelineThread(projection),
    latestSeq: Math.min(latestSeq, page.replayAfterSeq ?? latestSeq),
    activeTurn: null,
    latestTurn: omitTurnItems(projectTimelineTurn(turn, [])),
    pendingUserInputIds: [],
    pendingApprovalIds: [],
    timeline: { hasMore: page.hasMore, nextCursor: page.nextCursor, itemCount: page.items.length, itemBytes: page.itemBytes }
  }))
}
