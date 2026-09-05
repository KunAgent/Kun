import { QueuedTurnsResponseSchema } from '../../contracts/turns.js'
import type { ThreadService } from '../../services/thread-service.js'
import { jsonResponse, type JsonResponse } from '../response.js'
import { loadThreadMetadata } from './thread-projection.js'

/**
 * List the durable turns still waiting in a thread's queue. The renderer uses
 * this to reconcile locally-persisted rows after a crash between admission and
 * local persistence: each row matched by clientRequestId (or turn id) is
 * promoted back to in_flight so cancel/reorder keeps working.
 */
export async function getQueuedTurns(
  service: ThreadService,
  threadId: string
): Promise<JsonResponse> {
  const thread = await loadThreadMetadata(service, threadId)
  if (!thread) {
    return jsonResponse(
      { code: 'not_found', message: `thread not found: ${threadId}` },
      404
    )
  }
  const queuedTurns = thread.turns
    .filter((turn) => turn.status === 'queued')
    .map((turn, index) => ({
      turnId: turn.id,
      ...(turn.clientRequestId ? { clientRequestId: turn.clientRequestId } : {}),
      position: index,
      createdAt: turn.createdAt
    }))
  return jsonResponse(QueuedTurnsResponseSchema.parse({ queuedTurns }))
}
