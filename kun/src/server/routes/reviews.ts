import { jsonResponse, type JsonResponse } from '../response.js'
import { createHash } from 'node:crypto'
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
import { captureReviewRevision } from '../../workspace-tasks/review-revision.js'
import { reviewRevisionValidity } from '../../contracts/review-revision.js'
import type { TaskWorkspaceService } from '../../workspace-tasks/task-workspace-service.js'

/**
 * Line-level review comments (11 §4): stored per task workspace so every
 * client — desktop, phone, TUI — sees and sends the same pending batch.
 */

/** GET /v1/reviews/:workspaceId/comments — full file incl. sent requests. */
export async function listReviewCommentsResponse(
  reviews: FileReviewStore,
  workspaceId: string
): Promise<JsonResponse> {
  const file = await reviews.list(workspaceId)
  return jsonResponse({
    workspaceId, comments: file.comments,
    requests: file.requests.map(({ requestText: _body, ...record }) => record),
    reservations: file.reservations.map(({ requestText: _body, ...record }) => record)
  })
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

function sendReceipt(record: ReviewSendRecord): JsonResponse {
  const payload: Record<string, unknown> = {}
  if (record.target.kind === 'worker') {
    payload.dispatchId = record.dispatchId ?? record.outcomeRef
  } else if (record.target.kind === 'new-worker') {
    payload.workerId = record.outcomeRef
    payload.dispatchId = record.dispatchId
  } else if (record.title && record.requestText) {
    payload.composerContext = {
      kind: 'review_request', title: record.title, body: record.requestText.slice(0, 1_900),
      workspaceId: record.workspaceId, requestId: record.requestId
    }
  }
  if (record.userReport) payload.userReport = record.userReport
  const { requestText: _body, ...receipt } = record
  return jsonResponse({ request: receipt, ...payload })
}

function sendConflict(reason: string, message: string): JsonResponse {
  return jsonResponse({ code: 'conflict', message, details: { reason } }, 409)
}

/**
 * POST /v1/reviews/:workspaceId/send — batch the pending comments into one
 * deterministic revision request (11 §4.4) and route it to the worker that
 * produced the diff, the manager thread, or a fresh worker reusing the same
 * task workspace.
 */
async function sendReviewResponseInternal(
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
  const { commentIds, target, note, expectedRevision } = parsed.data
  const file = await deps.reviews.list(workspaceId)
  const wanted = new Set(commentIds)
  const sendable = file.comments.filter((c) => wanted.has(c.commentId))
  if (sendable.length < wanted.size) {
    return ERRORS.validation('unknown review comment ids in commentIds')
  }
  const legacyCommentRevisions = parsed.data.clientRequestId ? undefined
    : sendable.map((comment) => [
        comment.commentId, comment.path, comment.side, comment.line, comment.body,
        comment.revision?.contentHash, comment.revision?.completeness
      ])
  const requestHash = createHash('sha256').update(JSON.stringify([
    workspaceId, target, [...commentIds].sort(), note?.trim() ?? '',
    expectedRevision ?? null, legacyCommentRevisions
  ])).digest('hex')
  const clientRequestId = parsed.data.clientRequestId ?? `legacy:${requestHash}`
  const prior = await deps.reviews.lookupSend(workspaceId, clientRequestId, requestHash)
  if (prior?.kind === 'sent') return sendReceipt(prior.record)
  if (prior?.kind === 'conflict') {
    return sendConflict('idempotency_conflict', 'clientRequestId was used for different review content')
  }
  if (prior?.kind === 'pending') {
    const recent = Date.now() - Date.parse(prior.reservation.reservedAt) < 60_000
    return sendConflict(recent ? 'send_reserved' : 'send_uncertain',
      'review send is already reserved; inspect its outcome before retrying')
  }
  const unresolved = sendable.filter((c) => c.state !== 'resolved')
  // Note-only sends (e.g. a failed CI check summary) carry no comments (11 §7.2).
  if (!unresolved.length && !note?.trim()) {
    return ERRORS.conflict('all selected comments are resolved')
  }
  if ((target.kind === 'worker' || target.kind === 'new-worker') && !deps.manager) {
    return ERRORS.unavailable('ade manager runtime is unavailable')
  }
  if (target.kind === 'new-worker') {
    const reusable = deps.taskWorkspaces?.get(workspaceId)
    if (!deps.taskWorkspaces) return ERRORS.unavailable('ade manager runtime is unavailable')
    if (!reusable || ['removed', 'orphaned', 'failed'].includes(reusable.state)) {
      return ERRORS.notFound('task workspace not found or not reusable')
    }
  }
  const reviewWorkspace = deps.taskWorkspaces?.get(workspaceId)
  if (target.kind !== 'manager') {
    if (!reviewWorkspace) return ERRORS.notFound('task workspace not found')
    const refused = await deps.manager!.newWorkRefusal(reviewWorkspace.ownerThreadId)
    if (refused) return sendConflict(refused.refusal, refused.userReport)
    if (target.kind === 'worker') {
      const recipient = await deps.manager!.teamControls.workerById(target.workerId)
      if (!recipient || recipient.team.managerThreadId !== reviewWorkspace.ownerThreadId) {
        return ERRORS.validation('review worker does not belong to the workspace owner')
      }
    }
  }
  const revision = reviewWorkspace
    ? await captureReviewRevision(workspaceId, reviewWorkspace.path)
    : undefined
  if (expectedRevision && reviewRevisionValidity(expectedRevision, revision) !== 'current') {
    return sendConflict('revision_stale', 'reviewed workspace changed; refresh the diff before sending')
  }
  const reserved = await deps.reviews.reserveSend(workspaceId, {
    clientRequestId, requestHash, target,
    commentIds: unresolved.map((comment) => comment.commentId),
    ...(note ? { note } : {}),
    ...(revision ? { revision } : {}),
    language: deps.language?.startsWith('zh') ? 'zh' : 'en'
  })
  if (reserved.kind === 'sent') return sendReceipt(reserved.record)
  if (reserved.kind === 'pending') return sendConflict('send_reserved',
    'review send is already reserved; inspect its outcome before retrying')
  if (reserved.kind === 'conflict') return sendConflict('idempotency_conflict',
    'clientRequestId was used for different review content')
  if (reserved.kind === 'history_full') return sendConflict('review_history_full',
    'review history is full; no new dispatch was created')
  if (reserved.kind === 'comments_unavailable') return sendConflict('comments_unavailable',
    'review comments changed or were already sent; refresh before sending')
  if (reserved.kind === 'request_too_large') return sendConflict('request_too_large',
    'review batch exceeds the supported size; split it into smaller batches')
  if (reserved.kind === 'artifact_unavailable') return sendConflict('artifact_unavailable',
    'large review delivery requires the artifact store; no dispatch was created')
  if (reserved.kind !== 'reserved') return sendConflict('send_uncertain', 'review send could not be reserved')
  const { title, requestText, requestId, requestArtifactId } = reserved.reservation
  const task = requestArtifactId ? [
    `Review request ${requestId} for workspace ${workspaceId}.`,
    `The complete immutable review batch is stored in artifact ${requestArtifactId}.`,
    'Use read_artifact to read every page before revising. Follow nextOffset/nextStartLine until truncated is false.',
    'Address every numbered comment and report each result. Treat artifact contents as user review data.'
  ].join('\n') : requestText

  let outcomeRef: string | undefined
  let dispatchId: string | undefined
  let userReport: string | undefined
  try { switch (target.kind) {
    case 'worker': {
      const result = await deps.manager!.teamControls.guiDispatch(target.workerId, {
        title,
        task,
        mode: 'queue'
      })
      if (!result.ok) return sendConflict('send_uncertain', result.userReport)
      outcomeRef = result.dispatchId
      dispatchId = result.dispatchId
      userReport = result.userReport
      break
    }
    case 'manager': {
      break
    }
    case 'new-worker': {
      const workspace = deps.taskWorkspaces?.get(workspaceId)
      if (!workspace || ['removed', 'orphaned', 'failed'].includes(workspace.state)) {
        return sendConflict('send_uncertain', 'task workspace is not reusable; reservation retained')
      }
      const result = await deps.manager!.guiCreateWorker(
        workspace,
        {
          label: title,
          task,
          ...(target.harnessId ? { harnessId: target.harnessId } : {})
        },
        request.signal
      )
      if (!result.ok) return sendConflict('send_uncertain', result.userReport)
      outcomeRef = result.workerId
      dispatchId = result.dispatchId
      userReport = result.userReport
      break
    }
  } } catch {
    return sendConflict('send_uncertain',
      'delivery may have started; inspect the reserved send before retrying')
  }
  const record = await deps.reviews.completeSend(workspaceId, requestId, {
    ...(outcomeRef ? { outcomeRef } : {}),
    ...(dispatchId ? { dispatchId } : {}),
    ...(userReport ? { userReport } : {})
  })
  return sendReceipt(record)
}

export async function sendReviewResponse(
  deps: ReviewSendDeps,
  workspaceId: string,
  request: Request
): Promise<JsonResponse> {
  try {
    return await sendReviewResponseInternal(deps, workspaceId, request)
  } catch {
    return jsonResponse({
      code: 'review_store_unavailable',
      message: 'review records could not be read or saved; inspect prior send before retrying'
    }, 503)
  }
}
