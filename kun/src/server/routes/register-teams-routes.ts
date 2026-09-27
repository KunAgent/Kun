import type { Router } from '../router.js'
import type { ServerRuntime } from './server-runtime.js'
import { authorize } from './route-auth.js'
import { ERRORS } from './runtime-error.js'
import type { JsonResponse } from '../response.js'
import type { ManagerRuntime } from '../../ade/manager-runtime.js'
import type { RaceServiceDeps } from '../../ade/race.js'
import {
  dispatchVerdictResponse,
  noticeHoldResponse,
  pendingNoticesResponse,
  questionAnswerResponse,
  raceDecideResponse,
  raceDiscardOthersResponse,
  raceResponse,
  teamOverviewResponse,
  workerByIdResponse,
  workerDetachResponse,
  workerDispatchResponse,
  workerHandBackResponse,
  workerRunChecksResponse,
  workerStopResponse,
  workerTakeOverResponse
} from './teams.js'

/** ADE team routes (09 §6.2, §9): notice hold/readback + worker control. */
export function registerTeamsRoutes(router: Router, runtime: ServerRuntime): void {
  const manager = (request: Request): JsonResponse | ManagerRuntime => {
    if (!authorize(request, runtime)) return ERRORS.unauthorized()
    return runtime.ade?.manager ?? ERRORS.unavailable('ade manager runtime is unavailable')
  }
  const denied = <T extends object>(resolved: JsonResponse | T): resolved is JsonResponse =>
    'status' in resolved
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
  router.add('GET', '/v1/teams/by-manager/:threadId', async (request, ctx) => {
    const resolved = manager(request)
    if (denied(resolved)) return resolved
    return teamOverviewResponse(resolved, ctx.params.threadId)
  })
  router.add('GET', '/v1/teams/workers/:workerId', async (request, ctx) => {
    const resolved = manager(request)
    if (denied(resolved)) return resolved
    return workerByIdResponse(resolved, ctx.params.workerId)
  })
  router.add('POST', '/v1/teams/workers/:workerId/stop', async (request, ctx) => {
    const resolved = manager(request)
    if (denied(resolved)) return resolved
    return workerStopResponse(resolved, ctx.params.workerId)
  })
  router.add('POST', '/v1/teams/workers/:workerId/take-over', async (request, ctx) => {
    const resolved = manager(request)
    if (denied(resolved)) return resolved
    return workerTakeOverResponse(resolved, ctx.params.workerId)
  })
  router.add('POST', '/v1/teams/workers/:workerId/hand-back', async (request, ctx) => {
    const resolved = manager(request)
    if (denied(resolved)) return resolved
    return workerHandBackResponse(resolved, ctx.params.workerId)
  })
  router.add('POST', '/v1/teams/workers/:workerId/detach', async (request, ctx) => {
    const resolved = manager(request)
    if (denied(resolved)) return resolved
    return workerDetachResponse(resolved, ctx.params.workerId)
  })
  router.add('POST', '/v1/teams/questions/:questionId/answer', async (request, ctx) => {
    const resolved = manager(request)
    if (denied(resolved)) return resolved
    return questionAnswerResponse(resolved, ctx.params.questionId, request)
  })
  router.add('POST', '/v1/teams/workers/:workerId/dispatch', async (request, ctx) => {
    const resolved = manager(request)
    if (denied(resolved)) return resolved
    return workerDispatchResponse(resolved, ctx.params.workerId, request)
  })
  router.add('POST', '/v1/teams/workers/:workerId/run-checks', async (request, ctx) => {
    const resolved = manager(request)
    if (denied(resolved)) return resolved
    return workerRunChecksResponse(resolved, ctx.params.workerId, request)
  })
  router.add('POST', '/v1/teams/dispatches/:dispatchId/verdict', async (request, ctx) => {
    const resolved = manager(request)
    if (denied(resolved)) return resolved
    return dispatchVerdictResponse(resolved, ctx.params.dispatchId, request)
  })
  const races = (request: Request): JsonResponse | RaceServiceDeps => {
    if (!authorize(request, runtime)) return ERRORS.unauthorized()
    return runtime.ade?.races ?? ERRORS.unavailable('ade races are unavailable')
  }
  router.add('GET', '/v1/teams/races/:raceId', async (request, ctx) => {
    const resolved = races(request)
    if (denied(resolved)) return resolved
    return raceResponse(resolved, ctx.params.raceId)
  })
  router.add('POST', '/v1/teams/races/:raceId/decide', async (request, ctx) => {
    const resolved = races(request)
    if (denied(resolved)) return resolved
    return raceDecideResponse(resolved, ctx.params.raceId, request)
  })
  router.add('POST', '/v1/teams/races/:raceId/discard-others', async (request, ctx) => {
    const resolved = races(request)
    if (denied(resolved)) return resolved
    return raceDiscardOthersResponse(resolved, ctx.params.raceId, request)
  })
}
