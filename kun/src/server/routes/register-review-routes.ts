import type { Router } from '../router.js'
import type { ServerRuntime } from './server-runtime.js'
import { authorize } from './route-auth.js'
import { ERRORS } from './runtime-error.js'
import type { JsonResponse } from '../response.js'
import type { FileReviewStore } from '../../ade/review-store.js'
import {
  createReviewCommentResponse,
  listReviewCommentsResponse,
  sendReviewResponse,
  updateReviewCommentResponse
} from './reviews.js'

/** Review-comment routes (11 §4): per-workspace, shared across clients. */
export function registerReviewRoutes(router: Router, runtime: ServerRuntime): void {
  const reviews = (request: Request): JsonResponse | FileReviewStore => {
    if (!authorize(request, runtime)) return ERRORS.unauthorized()
    const store = runtime.ade?.stores.reviews
    return store ?? ERRORS.unavailable('ade review store is unavailable')
  }
  const denied = (resolved: JsonResponse | FileReviewStore): resolved is JsonResponse =>
    'status' in resolved

  router.add('GET', '/v1/reviews/:workspaceId/comments', async (request, ctx) => {
    const store = reviews(request)
    if (denied(store)) return store
    return listReviewCommentsResponse(store, ctx.params.workspaceId)
  })
  router.add('POST', '/v1/reviews/:workspaceId/comments', async (request, ctx) => {
    const store = reviews(request)
    if (denied(store)) return store
    return createReviewCommentResponse(store, ctx.params.workspaceId, request)
  })
  router.add('PATCH', '/v1/reviews/:workspaceId/comments/:commentId', async (request, ctx) => {
    const store = reviews(request)
    if (denied(store)) return store
    return updateReviewCommentResponse(store, ctx.params.workspaceId, ctx.params.commentId, request)
  })
  router.add('POST', '/v1/reviews/:workspaceId/send', async (request, ctx) => {
    if (!authorize(request, runtime)) return ERRORS.unauthorized()
    const store = runtime.ade?.stores.reviews
    if (!store) return ERRORS.unavailable('ade review store is unavailable')
    return sendReviewResponse(
      {
        reviews: store,
        ...(runtime.ade?.manager ? { manager: runtime.ade.manager } : {}),
        ...(runtime.taskWorkspaces ? { taskWorkspaces: runtime.taskWorkspaces } : {}),
        nowIso: runtime.nowIso,
        language: new URL(request.url).searchParams.get('language') ?? undefined
      },
      ctx.params.workspaceId,
      request
    )
  })
}
