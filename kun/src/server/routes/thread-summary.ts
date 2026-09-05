import { ThreadListSummarySchema } from '../../contracts/threads.js'
import type { SessionStore } from '../../ports/session-store.js'
import type { ThreadService } from '../../services/thread-service.js'
import { jsonResponse, type JsonResponse } from '../response.js'

export async function getThreadSummary(
  service: ThreadService,
  threadId: string,
  sessionStore?: SessionStore
): Promise<JsonResponse> {
  const [thread, latestSeq] = await Promise.all([
    service.getMetadata(threadId),
    sessionStore ? sessionStore.highestSeq(threadId) : Promise.resolve(0)
  ])
  if (!thread) {
    return jsonResponse(
      { code: 'not_found', message: `thread not found: ${threadId}` },
      404
    )
  }
  return jsonResponse(ThreadListSummarySchema.parse({ ...thread, latestSeq }))
}
