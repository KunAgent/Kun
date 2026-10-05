import { z } from 'zod'
import { jsonResponse, type JsonResponse } from '../response.js'
import { ERRORS } from './runtime-error.js'
import { collectSessionEventsOfKind } from '../../adapters/session-event-query.js'
import { buildHandoffBrief } from '../../handoff/handoff-brief.js'
import { extractWorkState } from '../../handoff/work-state.js'
import type { SessionStore } from '../../ports/session-store.js'
import type { ThreadService } from '../../services/thread-service-core.js'
import type { TaskWorkspaceService } from '../../workspace-tasks/task-workspace-service.js'

/**
 * `GET /v1/threads/:threadId/handoff-preview?turnId=` (docs/ade/impl §P0-14).
 * Rebuilds the deterministic brief recorded by the latest `handoff_injected`
 * event for that turn so clients can render it on demand without persisting
 * the 16 KiB body in the event stream.
 */

const QuerySchema = z.object({
  turnId: z.string().min(1).max(256)
}).strict()

export async function handoffPreviewResponse(
  deps: {
    sessionStore: SessionStore
    threadService: ThreadService
    taskWorkspaces?: TaskWorkspaceService
  },
  threadId: string,
  url: URL
): Promise<JsonResponse> {
  const parsed = QuerySchema.safeParse({
    turnId: url.searchParams.get('turnId') ?? undefined
  })
  if (!parsed.success) {
    return ERRORS.validation('invalid handoff preview query', parsed.error.issues)
  }
  const events = await collectSessionEventsOfKind(
    deps.sessionStore,
    threadId,
    'handoff_injected'
  )
  const event = [...events]
    .reverse()
    .find((candidate) => candidate.turnId === parsed.data.turnId)
  if (!event) {
    return ERRORS.notFound('no handoff was recorded for that turn')
  }
  const thread = await deps.threadService.get(threadId)
  if (!thread) return ERRORS.notFound('thread not found')
  const turnIndex = thread.turns.findIndex((turn) => turn.id === parsed.data.turnId)
  const turns = turnIndex < 0 ? undefined : new Set(thread.turns.slice(0, turnIndex + 1).map((turn) => turn.id))
  const recordedAt = Date.parse(event.timestamp)
  const items = (await deps.sessionStore.loadItems(threadId)).filter((item) =>
    (!turns || turns.has(item.turnId)) && Date.parse(item.createdAt) <= recordedAt)
  const taskWorkspace = deps.taskWorkspaces
    ?.list({ ownerThreadId: threadId })
    .filter((record) => record.path === thread.workspace)
    .at(-1)
  const brief = buildHandoffBrief({
    items,
    currentTurnId: parsed.data.turnId,
    reason: event.reason,
    mode: event.mode,
    ...(event.sinceTurnId ? { sinceTurnId: event.sinceTurnId } : {}),
    from: event.from,
    to: event.to,
    ...(event.workspace ? { workspace: event.workspace } : {}),
    workState: extractWorkState(items, taskWorkspace)
  })
  return jsonResponse({
    turnId: event.turnId,
    reason: event.reason,
    mode: event.mode,
    ...(event.sinceTurnId ? { sinceTurnId: event.sinceTurnId } : {}),
    from: event.from,
    to: event.to,
    ...(event.workspace ? { workspace: event.workspace } : {}),
    stats: brief.stats,
    briefDigest: brief.digest,
    recordedBriefDigest: event.briefDigest,
    brief: brief.text
  })
}
