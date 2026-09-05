import type { Router } from '../router.js'
import {
  normalizeThreadRuntimeStateWire,
  type ThreadRuntimeState
} from '../../contracts/threads.js'
import { ThreadStateLoadError } from './thread-state-error.js'
import {
  createThread,
  clearThreadGoal,
  clearThreadTodos,
  deleteThread,
  forkThread,
  getThreadGoal,
  getThreadTodos,
  getThread,
  getThreadState,
  getThreadStates,
  getThreadTimeline,
  loadThreadRuntimeState,
  listThreads,
  setThreadGoal,
  setThreadTodos,
  updateThread
} from './threads.js'
import { getQueuedTurns } from './thread-queued-turns.js'
import { syncThreadTodosFromPlan } from './thread-todos-sync-plan.js'
import { threadTimelineReadKey } from './thread-timeline-read-key.js'
import { patchThreadTodoStatus } from './project-boards.js'
import { deleteThreadsByWorkspace } from './threads-bulk-delete.js'
import { contentSearchThreads } from './thread-content-search.js'
import { summarizeThread } from './threads-summarize.js'
import {
  compactTurn,
  pruneThread,
  previewThreadPrune,
  listThreadSnapshots,
  restoreThreadSnapshot,
  cancelToolCall,
  getSteeringQueue,
  getTurn,
  interruptTurn,
  rewindThread,
  startTurn,
  steerTurn,
  cancelQueuedTurn,
  moveQueuedTurn,
  resumeQueuedTurns,
  replaceSteeringQueue
} from './turns.js'
import { startReview } from './review.js'
import { buildEventStreamResponse, parseEventCursor } from './events.js'
import { decideApproval } from './approvals.js'
import { resolveUserInput } from './user-inputs.js'
import { receiveCanvasReceipt } from './canvas-receipts.js'
import { getResumeSessionMetadata, resumeSession } from './sessions.js'
import { usageJsonResponse } from './usage.js'
import { listProviderQuotas } from './provider-quotas.js'
import { llmDebugRoundsResponse } from './debug-llm.js'
import { modelRequestsResponse } from './model-requests.js'
import {
  trajectoryDetailResponse,
  trajectoryPageResponse,
  trajectorySummaryResponse
} from './trajectory.js'
import { getThreadSummary } from './thread-summary.js'
import { threadActivityResponse } from './thread-activity.js'
import { jsonResponse } from '../response.js'
import { ERRORS } from './runtime-error.js'
import type { ServerRuntime } from './server-runtime.js'
import type { ApprovalConsentVerifier } from '../approval-consent.js'
import { authorize } from './route-auth.js'
import {
  ThreadReadCoordinator,
  ThreadReadOverloadedError
} from '../thread-read-coordinator.js'
import {
  getThreadKnowledgeBases,
  reindexThreadKnowledgeBase
} from './knowledge-bases.js'

export const THREAD_RUNTIME_STATE_OWNER_TIMEOUT_MS = 3_000

export function registerThreadRoutes(
  router: Router,
  runtime: ServerRuntime,
  approvalConsent: ApprovalConsentVerifier
): void {
  const timelineReads = new ThreadReadCoordinator()
  router.add('GET', '/v1/thread-activity/events', async (request) => {
    if (!authorize(request, runtime)) return ERRORS.unauthorized()
    if (!runtime.threadActivity) return ERRORS.unavailable('thread activity is unavailable')
    return threadActivityResponse(runtime.threadActivity, request)
  })
  router.add('GET', '/v1/threads', async (request) => {
    if (!authorize(request, runtime)) return ERRORS.unauthorized()
    return listThreads(runtime.threadService, request)
  })
  router.add('POST', '/v1/threads', async (request) => {
    if (!authorize(request, runtime)) return ERRORS.unauthorized()
    return createThread(runtime.threadService, request)
  })
  router.add('POST', '/v1/threads/bulk-delete', async (request) => {
    if (!authorize(request, runtime)) return ERRORS.unauthorized()
    return deleteThreadsByWorkspace(runtime.threadService, request)
  })
  // Static content-search suffix must be registered before `/:id`.
  router.add('GET', '/v1/threads/content-search', async (request) => {
    if (!authorize(request, runtime)) return ERRORS.unauthorized()
    return contentSearchThreads(runtime.threadService, runtime.sessionStore, request)
  })
  // Static batch suffix must stay before the generic `/:id` detail route.
  router.add('POST', '/v1/threads/states', async (request) => {
    if (!authorize(request, runtime)) return ERRORS.unauthorized()
    return getThreadStates(request, (threadId) =>
      loadOwnerAwareThreadState(runtime, request, threadId))
  })
  // Static summary suffix must stay before the generic `/:id` detail route.
  router.add('GET', '/v1/threads/:id/summary', async (request, ctx) => {
    if (!authorize(request, runtime)) return ERRORS.unauthorized()
    return getThreadSummary(runtime.threadService, ctx.params.id, runtime.sessionStore)
  })
  // This static suffix must be registered before `/:id`, because Router uses
  // first-match ordering for parameterized paths.
  router.add('GET', '/v1/threads/:id/state', async (request, ctx) => {
    if (!authorize(request, runtime)) return ERRORS.unauthorized()
    const forwarded = await runtime.forwardThreadControl?.(request, ctx.params.id)
    if (forwarded) return forwarded
    return getThreadState(
      runtime.threadService,
      ctx.params.id,
      runtime.sessionStore,
      runtime.userInputGate
    )
  })
  router.add('GET', '/v1/threads/:id/timeline', async (request, ctx) => {
    if (!authorize(request, runtime)) return ERRORS.unauthorized()
    const forwarded = await runtime.forwardThreadControl?.(request, ctx.params.id)
    if (forwarded) return forwarded
    const priority = request.headers.get('x-kun-request-priority') === 'background'
      ? 'background' : 'foreground'
    const key = threadTimelineReadKey(ctx.params.id, new URL(request.url))
    try {
      return await timelineReads.run(key, priority, () => getThreadTimeline(
        runtime.threadService,
        ctx.params.id,
        request,
        runtime.sessionStore,
        runtime.userInputGate,
        runtime.approvalGate,
        runtime.delegationRuntime
      ))
    } catch (error) {
      if (!(error instanceof ThreadReadOverloadedError)) throw error
      const response = jsonResponse({
        code: 'thread_read_overloaded',
        message: error.message,
        retryAfterSeconds: error.retryAfterSeconds
      }, 503)
      response.headers['retry-after'] = String(error.retryAfterSeconds)
      return response
    }
  })
  router.add('GET', '/v1/threads/:id/knowledge-bases', async (request, ctx) => {
    if (!authorize(request, runtime)) return ERRORS.unauthorized()
    return getThreadKnowledgeBases(runtime.knowledgeBaseService, ctx.params.id)
  })
  router.add('POST', '/v1/threads/:id/knowledge-bases/:knowledgeBaseId/reindex', async (request, ctx) => {
    if (!authorize(request, runtime)) return ERRORS.unauthorized()
    return reindexThreadKnowledgeBase(
      runtime.knowledgeBaseService,
      ctx.params.id,
      ctx.params.knowledgeBaseId
    )
  })
  router.add('GET', '/v1/threads/:id', async (request, ctx) => {
    if (!authorize(request, runtime)) return ERRORS.unauthorized()
    // The active approval gate is process-local. When a manager lease belongs
    // to another runtime, obtain the detail snapshot from that execution owner
    // so its live approval state cannot be mistaken for expired locally.
    const forwarded = await runtime.forwardThreadControl?.(request, ctx.params.id)
    if (forwarded) return forwarded
    return getThread(
      runtime.threadService,
      ctx.params.id,
      runtime.sessionStore,
      runtime.userInputGate,
      runtime.approvalGate
    )
  })
  router.add('GET', '/v1/threads/:id/model-requests', async (request, ctx) => {
    if (!authorize(request, runtime)) return ERRORS.unauthorized()
    return modelRequestsResponse(runtime, ctx.params.id, request)
  })
  router.add('GET', '/v1/threads/:id/trajectory', async (request, ctx) => {
    if (!authorize(request, runtime)) return ERRORS.unauthorized()
    return trajectoryPageResponse(runtime, ctx.params.id, request)
  })
  router.add('GET', '/v1/threads/:id/trajectory/summary', async (request, ctx) => {
    if (!authorize(request, runtime)) return ERRORS.unauthorized()
    return trajectorySummaryResponse(runtime, ctx.params.id)
  })
  router.add('GET', '/v1/threads/:id/trajectory/:recordId/detail', async (request, ctx) => {
    if (!authorize(request, runtime)) return ERRORS.unauthorized()
    return trajectoryDetailResponse(runtime, ctx.params.id, ctx.params.recordId, request)
  })
  router.add('PATCH', '/v1/threads/:id', async (request, ctx) => {
    if (!authorize(request, runtime)) return ERRORS.unauthorized()
    return updateThread(runtime.threadService, ctx.params.id, request)
  })
  router.add('DELETE', '/v1/threads/:id', async (request, ctx) => {
    if (!authorize(request, runtime)) return ERRORS.unauthorized()
    return deleteThread(runtime.threadService, ctx.params.id)
  })
  router.add('POST', '/v1/threads/:id/fork', async (request, ctx) => {
    if (!authorize(request, runtime)) return ERRORS.unauthorized()
    return forkThread(runtime.threadService, ctx.params.id, request)
  })
  router.add('POST', '/v1/threads/:id/summarize', async (request, ctx) => {
    if (!authorize(request, runtime)) return ERRORS.unauthorized()
    return summarizeThread(runtime, ctx.params.id, request)
  })
  router.add('GET', '/v1/threads/:id/goal', async (request, ctx) => {
    if (!authorize(request, runtime)) return ERRORS.unauthorized()
    return getThreadGoal(runtime.threadService, ctx.params.id)
  })
  router.add('POST', '/v1/threads/:id/goal', async (request, ctx) => {
    if (!authorize(request, runtime)) return ERRORS.unauthorized()
    return setThreadGoal(runtime.threadService, ctx.params.id, request)
  })
  router.add('DELETE', '/v1/threads/:id/goal', async (request, ctx) => {
    if (!authorize(request, runtime)) return ERRORS.unauthorized()
    return clearThreadGoal(runtime.threadService, ctx.params.id)
  })
  router.add('GET', '/v1/threads/:id/todos', async (request, ctx) => {
    if (!authorize(request, runtime)) return ERRORS.unauthorized()
    return getThreadTodos(runtime.threadService, ctx.params.id)
  })
  router.add('POST', '/v1/threads/:id/todos', async (request, ctx) => {
    if (!authorize(request, runtime)) return ERRORS.unauthorized()
    return setThreadTodos(runtime.threadService, ctx.params.id, request)
  })
  router.add('POST', '/v1/threads/:id/todos/sync-plan', async (request, ctx) => {
    if (!authorize(request, runtime)) return ERRORS.unauthorized()
    return syncThreadTodosFromPlan(runtime.threadService, ctx.params.id, request)
  })
  router.add('PATCH', '/v1/threads/:id/todos/:todoId', async (request, ctx) => {
    if (!authorize(request, runtime)) return ERRORS.unauthorized()
    return patchThreadTodoStatus(
      runtime.threadService,
      runtime.projectBoardService,
      ctx.params.id,
      ctx.params.todoId,
      request
    )
  })
  router.add('DELETE', '/v1/threads/:id/todos', async (request, ctx) => {
    if (!authorize(request, runtime)) return ERRORS.unauthorized()
    return clearThreadTodos(runtime.threadService, ctx.params.id)
  })
  router.add('POST', '/v1/threads/:id/turns', async (request, ctx) => {
    if (!authorize(request, runtime)) return ERRORS.unauthorized()
    return startTurn(
      runtime.turnService,
      ctx.params.id,
      request,
      ({ threadId, turnId }) => {
        runtime.runTurn(threadId, turnId)
      },
      () => runtime.graph?.config().enabled === true
    )
  })
  router.add('POST', '/v1/threads/:id/rewind', async (request, ctx) => {
    if (!authorize(request, runtime)) return ERRORS.unauthorized()
    return rewindThread(runtime.turnService, ctx.params.id, request)
  })
  router.add('POST', '/v1/threads/:id/turns/:turnId/cancel-queued', async (request, ctx) => {
    if (!authorize(request, runtime)) return ERRORS.unauthorized()
    return cancelQueuedTurn(runtime.turnService, ctx.params.id, ctx.params.turnId)
  })
  router.add('PATCH', '/v1/threads/:id/turns/:turnId/queue-position', async (request, ctx) => {
    if (!authorize(request, runtime)) return ERRORS.unauthorized()
    return moveQueuedTurn(runtime.turnService, ctx.params.id, ctx.params.turnId, request)
  })
  router.add('POST', '/v1/threads/:id/queue/resume', async (request, ctx) => {
    if (!authorize(request, runtime)) return ERRORS.unauthorized()
    return resumeQueuedTurns(runtime.turnService, ctx.params.id, (threadId, turnId) => {
      runtime.runTurn(threadId, turnId)
    })
  })
  router.add('GET', '/v1/threads/:id/queued-turns', async (request, ctx) => {
    if (!authorize(request, runtime)) return ERRORS.unauthorized()
    const forwarded = await runtime.forwardThreadControl?.(request, ctx.params.id)
    if (forwarded) return forwarded
    return getQueuedTurns(runtime.threadService, ctx.params.id)
  })
  router.add('POST', '/v1/threads/:id/review', async (request, ctx) => {
    if (!authorize(request, runtime)) return ERRORS.unauthorized()
    if (!runtime.reviewService || !runtime.runReview) {
      return ERRORS.unavailable('review is not available')
    }
    return startReview(
      runtime.turnService,
      ctx.params.id,
      request,
      ({ threadId, turnId, reviewItemId }, target, model, providerId, accountId, reasoningEffort) => {
        runtime.runReview?.({
          threadId,
          turnId,
          reviewItemId,
          target,
          model,
          providerId,
          accountId,
          reasoningEffort
        })
      }
    )
  })
  router.add('GET', '/v1/threads/:id/turns/:turnId', async (request, ctx) => {
    if (!authorize(request, runtime)) return ERRORS.unauthorized()
    return getTurn(runtime.turnService, ctx.params.id, ctx.params.turnId)
  })
  router.add('POST', '/v1/threads/:id/turns/:turnId/steer', async (request, ctx) => {
    if (!authorize(request, runtime)) return ERRORS.unauthorized()
    const forwarded = await runtime.forwardThreadControl?.(request, ctx.params.id)
    if (forwarded) return forwarded
    return steerTurn(
      runtime.turnService,
      ctx.params.id,
      ctx.params.turnId,
      request,
      ({ threadId, turnId }) => {
        runtime.runTurn(threadId, turnId)
      }
    )
  })
  router.add('GET', '/v1/threads/:id/turns/:turnId/steering', async (request, ctx) => {
    if (!authorize(request, runtime)) return ERRORS.unauthorized()
    const forwarded = await runtime.forwardThreadControl?.(request, ctx.params.id)
    if (forwarded) return forwarded
    return getSteeringQueue(runtime.turnService, ctx.params.id, ctx.params.turnId)
  })
  router.add('PATCH', '/v1/threads/:id/turns/:turnId/steering', async (request, ctx) => {
    if (!authorize(request, runtime)) return ERRORS.unauthorized()
    const forwarded = await runtime.forwardThreadControl?.(request, ctx.params.id)
    if (forwarded) return forwarded
    return replaceSteeringQueue(runtime.turnService, ctx.params.id, ctx.params.turnId, request)
  })
  router.add('POST', '/v1/threads/:id/turns/:turnId/interrupt', async (request, ctx) => {
    if (!authorize(request, runtime)) return ERRORS.unauthorized()
    const forwarded = await runtime.forwardThreadControl?.(request, ctx.params.id)
    if (forwarded) return forwarded
    return interruptTurn(runtime.turnService, ctx.params.id, ctx.params.turnId, request)
  })
  router.add('POST', '/v1/threads/:id/turns/:turnId/tool-calls/:callId/cancel', async (request, ctx) => {
    if (!authorize(request, runtime)) return ERRORS.unauthorized()
    const forwarded = await runtime.forwardThreadControl?.(request, ctx.params.id)
    if (forwarded) return forwarded
    return cancelToolCall(
      runtime.toolCancellationService,
      ctx.params.id,
      ctx.params.turnId,
      ctx.params.callId
    )
  })
  router.add('POST', '/v1/threads/:id/prune', async (request, ctx) => {
    if (!authorize(request, runtime)) return ERRORS.unauthorized()
    return pruneThread(runtime.turnService, ctx.params.id, request)
  })
  router.add('POST', '/v1/threads/:id/prune/preview', async (request, ctx) => {
    if (!authorize(request, runtime)) return ERRORS.unauthorized()
    return previewThreadPrune(runtime.turnService, ctx.params.id, request)
  })
  router.add('GET', '/v1/threads/:id/snapshots', async (request, ctx) => {
    if (!authorize(request, runtime)) return ERRORS.unauthorized()
    return listThreadSnapshots(runtime.turnService, ctx.params.id)
  })
  router.add('GET', '/v1/threads/:id/health', async (request, ctx) => {
    if (!authorize(request, runtime)) return ERRORS.unauthorized()
    if (!runtime.sessionGuardian) return ERRORS.unavailable('session guardian is not available')
    return jsonResponse(await runtime.sessionGuardian.scanThread(ctx.params.id))
  })
  router.add('GET', '/v1/session-health', async (request) => {
    if (!authorize(request, runtime)) return ERRORS.unauthorized()
    if (!runtime.sessionGuardian) return ERRORS.unavailable('session guardian is not available')
    return jsonResponse({ threads: await runtime.sessionGuardian.scanAll() })
  })
  router.add('POST', '/v1/threads/:id/snapshots/:snapshotId/restore', async (request, ctx) => {
    if (!authorize(request, runtime)) return ERRORS.unauthorized()
    return restoreThreadSnapshot(runtime.turnService, ctx.params.id, ctx.params.snapshotId)
  })
  router.add('POST', '/v1/threads/:id/compact', async (request, ctx) => {
    if (!authorize(request, runtime)) return ERRORS.unauthorized()
    return compactTurn(runtime.turnService, ctx.params.id, request)
  })
  router.add('GET', '/v1/threads/:id/events', async (request, ctx) => {
    if (!authorize(request, runtime)) return ERRORS.unauthorized()
    const sinceSeq = parseEventCursor(request)
    if (sinceSeq === null) return ERRORS.validation('since_seq must be a non-negative safe integer')
    if (!await runtime.threadService.getMetadata(ctx.params.id)) {
      return ERRORS.notFound(`thread not found: ${ctx.params.id}`)
    }
    return buildEventStreamResponse({
      request,
      threadId: ctx.params.id,
      eventBus: runtime.eventBus,
      sessionStore: runtime.sessionStore,
      streamRegistry: runtime.eventStreamRegistry,
      sinceSeq
    })
  })
  router.add('POST', '/v1/approvals/:id', async (request, ctx) => {
    if (!authorize(request, runtime)) return ERRORS.unauthorized()
    const forwarded = await runtime.forwardControlById?.(request, 'approval', ctx.params.id)
    if (forwarded) return forwarded
    return decideApproval({
      approvalId: ctx.params.id,
      request,
      gate: runtime.approvalGate,
      events: runtime.events,
      consent: approvalConsent
    })
  })
  router.add('POST', '/v1/user-inputs/:id', async (request, ctx) => {
    if (!authorize(request, runtime)) return ERRORS.unauthorized()
    const forwarded = await runtime.forwardControlById?.(request, 'user-input', ctx.params.id)
    if (forwarded) return forwarded
    return resolveUserInput({
      inputId: ctx.params.id,
      request,
      gate: runtime.userInputGate,
      events: runtime.events
    })
  })
  router.add('POST', '/v1/user-input/:id', async (request, ctx) => {
    if (!authorize(request, runtime)) return ERRORS.unauthorized()
    const forwarded = await runtime.forwardControlById?.(request, 'user-input', ctx.params.id)
    if (forwarded) return forwarded
    return resolveUserInput({
      inputId: ctx.params.id,
      request,
      gate: runtime.userInputGate,
      events: runtime.events
    })
  })
  router.add('POST', '/v1/threads/:id/canvas-receipts', async (request, ctx) => {
    if (!authorize(request, runtime)) return ERRORS.unauthorized()
    if (!runtime.canvasReceipts) return ERRORS.unavailable('canvas receipt registry is not available')
    return receiveCanvasReceipt({
      threadId: ctx.params.id,
      request,
      receipts: runtime.canvasReceipts
    })
  })
  router.add('GET', '/v1/sessions/:id/resume-metadata', async (request, ctx) => {
    if (!authorize(request, runtime)) return ERRORS.unauthorized()
    return getResumeSessionMetadata(runtime.threadService, ctx.params.id)
  })
  router.add('POST', '/v1/sessions/:id/resume-thread', async (request, ctx) => {
    if (!authorize(request, runtime)) return ERRORS.unauthorized()
    return resumeSession(runtime.threadService, ctx.params.id, request)
  })
  router.add('GET', '/v1/usage', async (request) => {
    if (!authorize(request, runtime)) return ERRORS.unauthorized()
    return usageJsonResponse(request, runtime)
  })
  router.add('GET', '/v1/provider-quotas', async (request) => {
    if (!authorize(request, runtime)) return ERRORS.unauthorized()
    if (!runtime.providerQuotaService) {
      return ERRORS.unavailable('provider quota service is not available')
    }
    return listProviderQuotas(runtime.providerQuotaService)
  })
  router.add('GET', '/v1/debug/llm-rounds', async (request) => {
    if (!authorize(request, runtime)) return ERRORS.unauthorized()
    return llmDebugRoundsResponse(runtime)
  })
}

async function loadOwnerAwareThreadState(
  runtime: ServerRuntime,
  batchRequest: Request,
  threadId: string
): Promise<ThreadRuntimeState | null> {
  const stateUrl = new URL(
    `/v1/threads/${encodeURIComponent(threadId)}/state`,
    batchRequest.url
  )
  const headers = new Headers(batchRequest.headers)
  headers.delete('content-length')
  headers.delete('content-type')
  const signal = AbortSignal.any([
    batchRequest.signal,
    AbortSignal.timeout(THREAD_RUNTIME_STATE_OWNER_TIMEOUT_MS)
  ])
  const stateRequest = new Request(stateUrl, {
    method: 'GET',
    headers,
    signal
  })
  let forwarded: Response | null | undefined
  try {
    forwarded = await runtime.forwardThreadControl?.(stateRequest, threadId)
  } catch (error) {
    throw new ThreadStateLoadError('owner_unreachable', 'owner_forward', { cause: error })
  }
  if (forwarded) {
    if (forwarded.status === 404) return null
    if (!forwarded.ok) {
      throw new ThreadStateLoadError('owner_error', 'owner_response', {
        httpStatus: forwarded.status
      })
    }
    try {
      return normalizeThreadRuntimeStateWire(await forwarded.json())
    } catch (error) {
      throw new ThreadStateLoadError('schema_incompatible', 'schema_parse', { cause: error })
    }
  }
  try {
    return await loadThreadRuntimeState(
      runtime.threadService,
      threadId,
      runtime.sessionStore,
      runtime.userInputGate
    )
  } catch (error) {
    throw new ThreadStateLoadError('storage_error', 'metadata', { cause: error })
  }
}
