import type { Router } from '../router.js'
import type { ServerRuntime } from './server-runtime.js'
import { authorize } from './route-auth.js'
import { ERRORS } from './runtime-error.js'
import {
  cancelTaskWorkspaceResponse,
  createTaskWorkspaceResponse,
  getTaskWorkspaceResponse,
  listTaskWorkspacesResponse,
  markReadyTaskWorkspaceResponse,
  retryTaskWorkspaceResponse
} from './task-workspaces.js'

/** Task workspace routes (docs/ade/07 §11). capture/integrate/discard land in P0-12. */
export function registerTaskWorkspaceRoutes(router: Router, runtime: ServerRuntime): void {
  const service = () => runtime.taskWorkspaces
  router.add('POST', '/v1/task-workspaces', async (request) => {
    if (!authorize(request, runtime)) return ERRORS.unauthorized()
    const svc = service()
    if (!svc) return ERRORS.unavailable('task workspaces are unavailable')
    return createTaskWorkspaceResponse(svc, request)
  })
  router.add('GET', '/v1/task-workspaces', async (request) => {
    if (!authorize(request, runtime)) return ERRORS.unauthorized()
    const svc = service()
    if (!svc) return ERRORS.unavailable('task workspaces are unavailable')
    return listTaskWorkspacesResponse(svc, request)
  })
  router.add('GET', '/v1/task-workspaces/:workspaceId', async (request, ctx) => {
    if (!authorize(request, runtime)) return ERRORS.unauthorized()
    const svc = service()
    if (!svc) return ERRORS.unavailable('task workspaces are unavailable')
    return getTaskWorkspaceResponse(svc, ctx.params.workspaceId)
  })
  router.add('POST', '/v1/task-workspaces/:workspaceId/retry', async (request, ctx) => {
    if (!authorize(request, runtime)) return ERRORS.unauthorized()
    const svc = service()
    if (!svc) return ERRORS.unavailable('task workspaces are unavailable')
    return retryTaskWorkspaceResponse(svc, ctx.params.workspaceId)
  })
  router.add('POST', '/v1/task-workspaces/:workspaceId/mark-ready', async (request, ctx) => {
    if (!authorize(request, runtime)) return ERRORS.unauthorized()
    const svc = service()
    if (!svc) return ERRORS.unavailable('task workspaces are unavailable')
    return markReadyTaskWorkspaceResponse(svc, ctx.params.workspaceId)
  })
  router.add('POST', '/v1/task-workspaces/:workspaceId/cancel', async (request, ctx) => {
    if (!authorize(request, runtime)) return ERRORS.unauthorized()
    const svc = service()
    if (!svc) return ERRORS.unavailable('task workspaces are unavailable')
    return cancelTaskWorkspaceResponse(svc, ctx.params.workspaceId)
  })
}
