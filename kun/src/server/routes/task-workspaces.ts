import { jsonResponse, type JsonResponse } from '../response.js'
import { ERRORS } from './runtime-error.js'
import { CreateTaskWorkspaceRequestSchema } from '../../contracts/task-workspace.js'
import { TaskWorkspaceError, type TaskWorkspaceService } from '../../workspace-tasks/task-workspace-service.js'

/** Task-workspace HTTP handlers (docs/ade/07 §11). */

function serviceError(error: unknown): JsonResponse {
  if (error instanceof TaskWorkspaceError) {
    return error.code === 'not_found'
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
