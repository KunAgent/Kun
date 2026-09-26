import { jsonResponse, type JsonResponse } from '../response.js'
import { ERRORS } from './runtime-error.js'
import {
  CreateTaskWorkspaceRequestSchema,
  DiscardTaskWorkspaceRequestSchema,
  IntegrateTaskWorkspaceRequestSchema
} from '../../contracts/task-workspace.js'
import { TaskWorkspaceError, type TaskWorkspaceService } from '../../workspace-tasks/task-workspace-service.js'
import {
  TaskWorkspaceConflictError,
  TaskWorkspaceDiscardPending
} from '../../workspace-tasks/task-workspace-integration.js'

/** Task-workspace HTTP handlers (docs/ade/07 §11). */

function serviceError(error: unknown): JsonResponse {
  if (error instanceof TaskWorkspaceDiscardPending) {
    return jsonResponse(
      { error: error.message, preview: error.preview },
      409
    )
  }
  if (error instanceof TaskWorkspaceError) {
    return error.code === 'not_found'
      ? ERRORS.notFound(error.message)
      : ERRORS.conflict(error.message)
  }
  if (error instanceof TaskWorkspaceConflictError) {
    return error.message === 'task workspace not found'
      ? ERRORS.notFound(error.message)
      : ERRORS.conflict(error.message)
  }
  return ERRORS.validation('invalid task workspace request')
}

/** POST /v1/task-workspaces — create returns the `creating` record at once. */
export async function createTaskWorkspaceResponse(
  service: TaskWorkspaceService,
  request: Request
): Promise<JsonResponse> {
  const body = await request.json().catch(() => undefined)
  const parsed = CreateTaskWorkspaceRequestSchema.safeParse(body)
  if (!parsed.success) {
    return ERRORS.validation('invalid task workspace create request', parsed.error.issues)
  }
  try {
    return jsonResponse({ record: service.create(parsed.data, request.signal) }, 201)
  } catch (error) {
    return serviceError(error)
  }
}

/** GET /v1/task-workspaces?ownerThreadId=… */
export function listTaskWorkspacesResponse(
  service: TaskWorkspaceService,
  request: Request
): JsonResponse {
  const ownerThreadId = new URL(request.url).searchParams.get('ownerThreadId') ?? undefined
  return jsonResponse({
    records: service.list(ownerThreadId ? { ownerThreadId } : undefined)
  })
}

export function getTaskWorkspaceResponse(
  service: TaskWorkspaceService,
  workspaceId: string
): JsonResponse {
  const record = service.get(workspaceId)
  if (!record) return ERRORS.notFound('task workspace not found')
  return jsonResponse({ record })
}

export function retryTaskWorkspaceResponse(
  service: TaskWorkspaceService,
  workspaceId: string
): JsonResponse {
  try {
    return jsonResponse({ record: service.retry(workspaceId) })
  } catch (error) {
    return serviceError(error)
  }
}

export function markReadyTaskWorkspaceResponse(
  service: TaskWorkspaceService,
  workspaceId: string
): JsonResponse {
  try {
    return jsonResponse({ record: service.markReady(workspaceId) })
  } catch (error) {
    return serviceError(error)
  }
}

export function cancelTaskWorkspaceResponse(
  service: TaskWorkspaceService,
  workspaceId: string
): JsonResponse {
  try {
    return jsonResponse({ record: service.cancel(workspaceId) })
  } catch (error) {
    return serviceError(error)
  }
}

/** GET /v1/task-workspaces/:id/setup-log — read the stored setup artifact. */
export async function taskWorkspaceSetupLogResponse(
  service: TaskWorkspaceService,
  artifacts: { get(id: string): Promise<string | null> },
  workspaceId: string
): Promise<JsonResponse> {
  const record = service.get(workspaceId)
  if (!record) return ERRORS.notFound('task workspace not found')
  const logArtifactId = record.setup.logArtifactId
  if (!logArtifactId) {
    return jsonResponse({ log: '', status: record.setup.status })
  }
  const content = await artifacts.get(logArtifactId).catch(() => null)
  if (content === null) return ERRORS.notFound('setup log artifact not found')
  return jsonResponse({ log: content, status: record.setup.status })
}

/** POST /v1/task-workspaces/:id/capture — snapshot worktree changes. */
export async function captureTaskWorkspaceResponse(
  service: TaskWorkspaceService,
  workspaceId: string
): Promise<JsonResponse> {
  try {
    return jsonResponse({ record: await service.capture(workspaceId) })
  } catch (error) {
    return serviceError(error)
  }
}

/** POST /v1/task-workspaces/:id/integrate — apply-patch or merge-branch. */
export async function integrateTaskWorkspaceResponse(
  service: TaskWorkspaceService,
  request: Request,
  workspaceId: string
): Promise<JsonResponse> {
  const body = await request.json().catch(() => undefined)
  const parsed = IntegrateTaskWorkspaceRequestSchema.safeParse(body ?? {})
  if (!parsed.success) {
    return ERRORS.validation('invalid task workspace integrate request', parsed.error.issues)
  }
  try {
    const result = await service.integrate(workspaceId, parsed.data.mode)
    return jsonResponse({
      record: result.record,
      outcome: result.outcome,
      ...(result.reason ? { reason: result.reason } : {}),
      ...(result.recovery ? { recovery: result.recovery } : {})
    })
  } catch (error) {
    return serviceError(error)
  }
}

/** POST /v1/task-workspaces/:id/discard — 409 + preview unless confirmed. */
export async function discardTaskWorkspaceResponse(
  service: TaskWorkspaceService,
  request: Request,
  workspaceId: string
): Promise<JsonResponse> {
  const body = await request.json().catch(() => undefined)
  const parsed = DiscardTaskWorkspaceRequestSchema.safeParse(body ?? {})
  if (!parsed.success) {
    return ERRORS.validation('invalid task workspace discard request', parsed.error.issues)
  }
  try {
    return jsonResponse({ record: await service.discard(workspaceId, parsed.data.confirm === true) })
  } catch (error) {
    return serviceError(error)
  }
}

/** POST /v1/task-workspaces/:id/cleanup — non-force remove after integrate. */
export async function cleanupTaskWorkspaceResponse(
  service: TaskWorkspaceService,
  workspaceId: string
): Promise<JsonResponse> {
  try {
    return jsonResponse({ record: await service.cleanupIntegrated(workspaceId) })
  } catch (error) {
    return serviceError(error)
  }
}

/** GET /v1/task-workspaces/preserved-branches?repo=... */
export async function preservedBranchesResponse(
  service: TaskWorkspaceService,
  request: Request
): Promise<JsonResponse> {
  const repo = new URL(request.url).searchParams.get('repo')
  if (!repo) return ERRORS.validation('missing repo query parameter')
  return jsonResponse({ branches: await service.preservedBranches(repo) })
}
