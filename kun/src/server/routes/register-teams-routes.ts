import type { Router } from '../router.js'
import type { ServerRuntime } from './server-runtime.js'
import { authorize } from './route-auth.js'
import { ERRORS } from './runtime-error.js'
import { noticeHoldResponse, pendingNoticesResponse } from './teams.js'

/** ADE team routes (09 §6.2): composer notice hold + pending-notice readback. */
export function registerTeamsRoutes(router: Router, runtime: ServerRuntime): void {
  router.add('POST', '/v1/teams/:managerThreadId/notice-hold', async (request, ctx) => {
    if (!authorize(request, runtime)) return ERRORS.unauthorized()
    const coordinator = runtime.ade?.noticeCoordinator
    if (!coordinator) return ERRORS.unavailable('ade notice coordination is unavailable')
    return noticeHoldResponse(coordinator, ctx.params.managerThreadId, request)
  })
  router.add('GET', '/v1/teams/:managerThreadId/pending-notices', async (request, ctx) => {
    if (!authorize(request, runtime)) return ERRORS.unauthorized()
    const notices = runtime.ade?.stores.notices
    if (!notices) return ERRORS.unavailable('ade notice store is unavailable')
    const language = new URL(request.url).searchParams.get('language') ?? undefined
    return pendingNoticesResponse(notices, ctx.params.managerThreadId, language)
  })
}
