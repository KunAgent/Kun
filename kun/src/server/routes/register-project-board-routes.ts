import type { Router } from '../router.js'
import type { ServerRuntime } from './server-runtime.js'
import { authorize } from './route-auth.js'
import { ERRORS } from './runtime-error.js'
import {
  createProjectBoardCard,
  deleteProjectBoardCard,
  getProjectBoardSnapshot,
  getProjectBoardSummaries,
  patchProjectBoardCard,
  patchProjectBoardCardStatuses,
  patchProjectBoardTodoOverlay
} from './project-boards.js'

export function registerProjectBoardRoutes(router: Router, runtime: ServerRuntime): void {
  const service = runtime.projectBoardService
  router.add('GET', '/v1/project-boards/snapshot', (request) => {
    if (!authorize(request, runtime)) return ERRORS.unauthorized()
    return service
      ? getProjectBoardSnapshot(service, request)
      : ERRORS.unavailable('project boards are not available')
  })
  router.add('POST', '/v1/project-boards/summaries', (request) => {
    if (!authorize(request, runtime)) return ERRORS.unauthorized()
    return service
      ? getProjectBoardSummaries(service, request)
      : ERRORS.unavailable('project boards are not available')
  })
  router.add('POST', '/v1/project-boards/cards', (request) => {
    if (!authorize(request, runtime)) return ERRORS.unauthorized()
    return service
      ? createProjectBoardCard(service, request)
      : ERRORS.unavailable('project boards are not available')
  })
  router.add('PATCH', '/v1/project-boards/cards/status', (request) => {
    if (!authorize(request, runtime)) return ERRORS.unauthorized()
    return service
      ? patchProjectBoardCardStatuses(service, request)
      : ERRORS.unavailable('project boards are not available')
  })
  router.add('PATCH', '/v1/project-boards/cards/:cardId', (request, ctx) => {
    if (!authorize(request, runtime)) return ERRORS.unauthorized()
    return service
      ? patchProjectBoardCard(service, ctx.params.cardId, request)
      : ERRORS.unavailable('project boards are not available')
  })
  router.add('DELETE', '/v1/project-boards/cards/:cardId', (request, ctx) => {
    if (!authorize(request, runtime)) return ERRORS.unauthorized()
    return service
      ? deleteProjectBoardCard(service, ctx.params.cardId, request)
      : ERRORS.unavailable('project boards are not available')
  })
  router.add('PATCH', '/v1/project-boards/todo-overlays/:threadId/:todoId', (request, ctx) => {
    if (!authorize(request, runtime)) return ERRORS.unauthorized()
    return service
      ? patchProjectBoardTodoOverlay(service, ctx.params.threadId, ctx.params.todoId, request)
      : ERRORS.unavailable('project boards are not available')
  })
}
