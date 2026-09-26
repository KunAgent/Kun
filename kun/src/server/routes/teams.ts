import { jsonResponse, type JsonResponse } from '../response.js'
import { ERRORS } from './runtime-error.js'
import { WorkerNoticeHoldRequestSchema } from '../../contracts/ade.js'
import type { FileWorkerNoticeStore } from '../../ade/worker-notice-store.js'
import type { WorkerNoticeCoordinator } from '../../ade/worker-notice-coordinator.js'
import { renderWorkerUpdates } from '../../ade/notice-render.js'
import { readJsonBody } from '../read-json-body.js'

/**
 * ADE team routes (09 §6.2): composer hold + pending-notice readback for
 * manager threads. `teamId` is the manager thread id.
 */

/** POST /v1/teams/:managerThreadId/notice-hold — `{ holdMs ≤ 60000 }`. */
export async function noticeHoldResponse(
  coordinator: WorkerNoticeCoordinator,
  managerThreadId: string,
  request: Request
): Promise<JsonResponse> {
  const body = await readJsonBody(request)
  if (!body.ok) return body.response
  const parsed = WorkerNoticeHoldRequestSchema.safeParse(body.value)
  if (!parsed.success) {
    return ERRORS.validation('invalid notice-hold request', parsed.error.issues)
  }
  const result = coordinator.holdNotices(managerThreadId, parsed.data.holdMs)
  return jsonResponse({ ...result, holdMs: parsed.data.holdMs }, 200)
}

/**
 * GET /v1/teams/:managerThreadId/pending-notices — notices + the exact
 * `<kun_worker_updates>` text so the renderer can attach them verbatim to
 * the next user message instead of duplicating the render rules.
 */
export async function pendingNoticesResponse(
  notices: FileWorkerNoticeStore,
  managerThreadId: string,
  language?: string
): Promise<JsonResponse> {
  const pending = await notices.pending(managerThreadId)
  const rendered = renderWorkerUpdates(pending, language)
  return jsonResponse(
    pending.length
      ? { notices: pending, text: rendered.prompt, displayText: rendered.displayText }
      : { notices: [] }
  )
}
