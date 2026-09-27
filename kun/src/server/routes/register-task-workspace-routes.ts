import type { Router } from '../router.js'
import type { ServerRuntime } from './server-runtime.js'
import { authorize } from './route-auth.js'
import { ERRORS } from './runtime-error.js'
import {
  cancelTaskWorkspaceResponse,
  captureTaskWorkspaceResponse,
  cleanupTaskWorkspaceResponse,
  createTaskWorkspaceResponse,
  discardTaskWorkspaceResponse,
  getTaskWorkspaceResponse,
  integrateTaskWorkspaceResponse,
  listTaskWorkspacesResponse,
  markReadyTaskWorkspaceResponse,
  preservedBranchesResponse,
  retryTaskWorkspaceResponse,
  taskWorkspaceAttributionResponse,
  taskWorkspaceDiffFileResponse,
  taskWorkspaceDiffResponse,
  taskWorkspaceIntegratePreviewResponse,
  taskWorkspaceSetupLogResponse
} from './task-workspaces.js'

/** Task workspace routes (docs/ade/07 §11). */
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
  // Literal segment must register before :workspaceId — first match wins.
  router.add('GET', '/v1/task-workspaces/preserved-branches', async (request) => {
    if (!authorize(request, runtime)) return ERRORS.unauthorized()
    const svc = service()
    if (!svc) return ERRORS.unavailable('task workspaces are unavailable')
    return preservedBranchesResponse(svc, request)
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
  router.add('GET', '/v1/task-workspaces/:workspaceId/setup-log', async (request, ctx) => {
    if (!authorize(request, runtime)) return ERRORS.unauthorized()
    const svc = service()
    const artifacts = runtime.graph?.artifacts
    if (!svc || !artifacts) return ERRORS.unavailable('task workspaces are unavailable')
    return taskWorkspaceSetupLogResponse(svc, artifacts, ctx.params.workspaceId)
  })
  router.add('GET', '/v1/task-workspaces/:workspaceId/diff', async (request, ctx) => {
    if (!authorize(request, runtime)) return ERRORS.unauthorized()
    const svc = service()
    const artifacts = runtime.graph?.artifacts
    if (!svc || !artifacts) return ERRORS.unavailable('task workspaces are unavailable')
    return taskWorkspaceDiffResponse(svc, artifacts, ctx.params.workspaceId)
  })
  router.add('GET', '/v1/task-workspaces/:workspaceId/diff/file', async (request, ctx) => {
    if (!authorize(request, runtime)) return ERRORS.unauthorized()
    const svc = service()
    const artifacts = runtime.graph?.artifacts
    if (!svc || !artifacts) return ERRORS.unavailable('task workspaces are unavailable')
    return taskWorkspaceDiffFileResponse(svc, artifacts, request, ctx.params.workspaceId)
  })
  router.add('POST', '/v1/task-workspaces/:workspaceId/capture', async (request, ctx) => {
    if (!authorize(request, runtime)) return ERRORS.unauthorized()
    const svc = service()
    if (!svc) return ERRORS.unavailable('task workspaces are unavailable')
    return captureTaskWorkspaceResponse(svc, ctx.params.workspaceId)
  })
  router.add('GET', '/v1/task-workspaces/:workspaceId/attribution', async (request, ctx) => {
    if (!authorize(request, runtime)) return ERRORS.unauthorized()
    const svc = service()
    const ledger = runtime.attribution
    if (!svc || !ledger) return ERRORS.unavailable('attribution is unavailable')
    return taskWorkspaceAttributionResponse(
      svc, ledger, runtime.ade?.stores.teams, request, ctx.params.workspaceId
    )
  })
  router.add('GET', '/v1/task-workspaces/:workspaceId/integrate-preview', async (request, ctx) => {
    if (!authorize(request, runtime)) return ERRORS.unauthorized()
    const svc = service()
    if (!svc) return ERRORS.unavailable('task workspaces are unavailable')
    return taskWorkspaceIntegratePreviewResponse(svc, ctx.params.workspaceId)
  })
  router.add('POST', '/v1/task-workspaces/:workspaceId/integrate', async (request, ctx) => {
    if (!authorize(request, runtime)) return ERRORS.unauthorized()
    const svc = service()
    if (!svc) return ERRORS.unavailable('task workspaces are unavailable')
    return integrateTaskWorkspaceResponse(svc, request, ctx.params.workspaceId)
  })
  router.add('POST', '/v1/task-workspaces/:workspaceId/discard', async (request, ctx) => {
    if (!authorize(request, runtime)) return ERRORS.unauthorized()
    const svc = service()
    if (!svc) return ERRORS.unavailable('task workspaces are unavailable')
    return discardTaskWorkspaceResponse(svc, request, ctx.params.workspaceId)
  })
  router.add('POST', '/v1/task-workspaces/:workspaceId/cleanup', async (request, ctx) => {
    if (!authorize(request, runtime)) return ERRORS.unauthorized()
    const svc = service()
    if (!svc) return ERRORS.unavailable('task workspaces are unavailable')
    return cleanupTaskWorkspaceResponse(svc, ctx.params.workspaceId)
  })
}
