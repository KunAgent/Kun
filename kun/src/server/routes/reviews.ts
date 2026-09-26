import { jsonResponse, type JsonResponse } from '../response.js'
import { ERRORS } from './runtime-error.js'
import { readJsonBody } from '../read-json-body.js'
import {
  CreateReviewCommentSchema,
  SendReviewRequestSchema,
  UpdateReviewCommentSchema,
  type ReviewSendRecord
} from '../../contracts/review.js'
import type { FileReviewStore } from '../../ade/review-store.js'
import type { ManagerRuntime } from '../../ade/manager-runtime.js'
import type { TaskWorkspaceService } from '../../workspace-tasks/task-workspace-service.js'
import { renderRevisionRequest } from '../../ade/revision-request.js'

/**
 * Line-level review comments (11 §4): stored per task workspace so every
 * client — desktop, phone, TUI — sees and sends the same pending batch.
 */

/** GET /v1/reviews/:workspaceId/comments — full file incl. sent requests. */
export async function listReviewCommentsResponse(
  reviews: FileReviewStore,
  workspaceId: string
): Promise<JsonResponse> {
  return jsonResponse(await reviews.list(workspaceId))
}

/** POST /v1/reviews/:workspaceId/comments — create one draft comment. */
export async function createReviewCommentResponse(
  reviews: FileReviewStore,
  workspaceId: string,
  request: Request
): Promise<JsonResponse> {
  const body = await readJsonBody(request)
  if (!body.ok) return body.response
  const parsed = CreateReviewCommentSchema.safeParse(body.value)
  if (!parsed.success) {
    return ERRORS.validation('invalid review comment', parsed.error.issues)
  }
  return jsonResponse({ comment: await reviews.create(workspaceId, parsed.data) }, 201)
}

/** PATCH /v1/reviews/:workspaceId/comments/:commentId — edit or resolve. */
export async function updateReviewCommentResponse(
  reviews: FileReviewStore,
  workspaceId: string,
  commentId: string,
  request: Request
): Promise<JsonResponse> {
  const body = await readJsonBody(request)
  if (!body.ok) return body.response
  const parsed = UpdateReviewCommentSchema.safeParse(body.value)
  if (!parsed.success) {
    return ERRORS.validation('invalid review comment update', parsed.error.issues)
  }
  const comment = await reviews.update(workspaceId, commentId, parsed.data)
  if (!comment) return ERRORS.notFound('review comment not found')
  return jsonResponse({ comment })
}

export type ReviewSendDeps = {
  reviews: FileReviewStore
  manager?: ManagerRuntime
  taskWorkspaces?: TaskWorkspaceService
  nowIso: () => string
  /** zh/en for the dispatch title + user report (client-supplied). */
  language?: string
}

/**
 * POST /v1/reviews/:workspaceId/send — batch the pending comments into one
 * deterministic revision request (11 §4.4) and route it to the worker that
 * produced the diff, the manager thread, or a fresh worker reusing the same
 * task workspace.
 */
export async function sendReviewResponse(
  deps: ReviewSendDeps,
  workspaceId: string,
  request: Request
): Promise<JsonResponse> {
  const body = await readJsonBody(request)
  if (!body.ok) return body.response
  const parsed = SendReviewRequestSchema.safeParse(body.value)
  if (!parsed.success) {
    return ERRORS.validation('invalid review send request', parsed.error.issues)
  }
  const { commentIds, target, note } = parsed.data
  const file = await deps.reviews.list(workspaceId)
  const wanted = new Set(commentIds)
  const sendable = file.comments.filter((c) => wanted.has(c.commentId))
  if (sendable.length < wanted.size) {
    return ERRORS.validation('unknown review comment ids in commentIds')
  }
  const unresolved = sendable.filter((c) => c.state !== 'resolved')
  if (!unresolved.length) return ERRORS.conflict('all selected comments are resolved')
  const round = file.requests.length + 1
  const zh = deps.language?.startsWith('zh') ?? false
  const title = zh ? `审查意见 第 ${round} 轮` : `Review comments round ${round}`
  const requestText = renderRevisionRequest({ workspaceId, round, comments: unresolved, note })

  let outcomeRef: string | undefined
  let payload: Record<string, unknown>
  switch (target.kind) {
    case 'worker': {
      const manager = deps.manager
      if (!manager) return ERRORS.unavailable('ade manager runtime is unavailable')
      const result = await manager.teamControls.guiDispatch(target.workerId, {
        title,
        task: requestText,
        mode: 'queue'
      })
      if (!result.ok) return ERRORS.conflict(result.userReport)
      outcomeRef = result.dispatchId
      payload = { dispatchId: result.dispatchId, userReport: result.userReport }
      break
    }
    case 'manager': {
      // The renderer attaches the rendered context to the manager thread's
      // next user message; kun only assembles + records the batch (11 §4.4).
      payload = {
        composerContext: { kind: 'review_request', title, body: requestText }
      }
      break
    }
    case 'new-worker': {
      const manager = deps.manager
      const workspace = deps.taskWorkspaces?.get(workspaceId)
      if (!manager || !deps.taskWorkspaces) {
        return ERRORS.unavailable('ade manager runtime is unavailable')
      }
      if (!workspace || ['removed', 'orphaned', 'failed'].includes(workspace.state)) {
        return ERRORS.notFound('task workspace not found or not reusable')
      }
      const result = await manager.guiCreateWorker(
        workspace,
        {
          label: title,
          task: requestText,
          ...(target.harnessId ? { harnessId: target.harnessId } : {})
        },
        request.signal
      )
      if (!result.ok) return ERRORS.conflict(result.userReport)
      outcomeRef = result.workerId
      payload = {
        workerId: result.workerId,
        dispatchId: result.dispatchId,
        userReport: result.userReport
      }
      break
    }
  }

  const record: ReviewSendRecord = {
    requestId: deps.reviews.nextRequestId(),
    round,
    target,
    commentIds: unresolved.map((c) => c.commentId),
    ...(note ? { note } : {}),
    ...(outcomeRef ? { outcomeRef } : {}),
    sentAt: deps.nowIso()
  }
  await deps.reviews.markSent(workspaceId, record)
  return jsonResponse({ request: record, ...payload })
}
