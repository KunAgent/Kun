import type { Router } from '../router.js'
import type { ServerRuntime } from './server-runtime.js'
import { authorize } from './route-auth.js'
import { ERRORS } from './runtime-error.js'
import { handoffPreviewResponse } from './handoff-preview.js'

/** Handoff preview route (docs/ade/impl §P0-14). */
export function registerHandoffRoutes(router: Router, runtime: ServerRuntime): void {
  router.add('GET', '/v1/threads/:threadId/handoff-preview', async (request, ctx) => {
    if (!authorize(request, runtime)) return ERRORS.unauthorized()
    return handoffPreviewResponse(
      {
        sessionStore: runtime.sessionStore,
        threadService: runtime.threadService,
        ...(runtime.taskWorkspaces ? { taskWorkspaces: runtime.taskWorkspaces } : {})
      },
      ctx.params.threadId,
      new URL(request.url)
    )
  })
}
