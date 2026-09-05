import {
  CreateManualProjectBoardCardRequestSchema,
  DeleteManualProjectBoardCardRequestSchema,
  PatchManualProjectBoardCardRequestSchema,
  PatchProjectBoardCardStatusesRequestSchema,
  PatchProjectBoardTodoOverlayRequestSchema,
  PatchThreadTodoRequestSchema,
  PatchThreadTodoResponseSchema,
  ProjectBoardBulkStatusResponseSchema,
  ProjectBoardSnapshotResponseSchema,
  ProjectBoardSummariesRequestSchema,
  ProjectBoardSummariesResponseSchema
} from '../../contracts/project-board.js'
import { ProjectBoardRevisionConflictError } from '../../ports/project-board-store.js'
import {
  ProjectBoardBulkConflictError,
  ProjectBoardNotFoundError,
  type ProjectBoardService
} from '../../services/project-board-service.js'
import type { ThreadService } from '../../services/thread-service.js'
import { readJsonBody } from '../read-json-body.js'
import { jsonResponse, type JsonResponse } from '../response.js'
import { ERRORS } from './runtime-error.js'

export async function getProjectBoardSnapshot(
  service: ProjectBoardService,
  request: Request
): Promise<JsonResponse> {
  const url = new URL(request.url)
  const workspace = url.searchParams.get('workspace')?.trim() ?? ''
  if (!workspace) return ERRORS.validation('project board workspace is required')
  const includeArchived = url.searchParams.get('includeArchived') === 'true'
  try {
    const snapshot = await service.snapshot({
      workspace,
      includeArchived,
      ...(url.searchParams.get('cursor') ? { cursor: url.searchParams.get('cursor') ?? undefined } : {})
    })
    return jsonResponse(ProjectBoardSnapshotResponseSchema.parse(snapshot))
  } catch (error) {
    return boardError(error)
  }
}

export async function getProjectBoardSummaries(
  service: ProjectBoardService,
  request: Request
): Promise<JsonResponse | Response> {
  const parsed = await parseBody(request, ProjectBoardSummariesRequestSchema)
  if (!parsed.ok) return parsed.response
  try {
    return jsonResponse(ProjectBoardSummariesResponseSchema.parse({
      summaries: await service.summaries(parsed.data.workspaces)
    }))
  } catch (error) {
    return boardError(error)
  }
}

export async function createProjectBoardCard(
  service: ProjectBoardService,
  request: Request
): Promise<JsonResponse | Response> {
  const parsed = await parseBody(request, CreateManualProjectBoardCardRequestSchema)
  if (!parsed.ok) return parsed.response
  try {
    return jsonResponse(await service.createManualCard(parsed.data), 201)
  } catch (error) {
    return boardMutationError(service, parsed.data.workspace, error)
  }
}

export async function patchProjectBoardCard(
  service: ProjectBoardService,
  cardId: string,
  request: Request
): Promise<JsonResponse | Response> {
  const parsed = await parseBody(request, PatchManualProjectBoardCardRequestSchema)
  if (!parsed.ok) return parsed.response
  try {
    return jsonResponse(await service.patchManualCard(cardId, parsed.data))
  } catch (error) {
    return boardMutationError(service, parsed.data.workspace, error)
  }
}

export async function patchProjectBoardCardStatuses(
  service: ProjectBoardService,
  request: Request
): Promise<JsonResponse | Response> {
  const parsed = await parseBody(request, PatchProjectBoardCardStatusesRequestSchema)
  if (!parsed.ok) return parsed.response
  try {
    const result = ProjectBoardBulkStatusResponseSchema.parse(
      await service.patchCardStatuses(parsed.data)
    )
    return jsonResponse(result, result.failures.length > 0 ? 207 : 200)
  } catch (error) {
    if (error instanceof ProjectBoardRevisionConflictError) {
      return jsonResponse({
        code: 'conflict',
        message: 'Project board was updated in another window.',
        expectedRevision: error.expectedRevision,
        actualRevision: error.actualRevision
      }, 409)
    }
    if (error instanceof ProjectBoardBulkConflictError) {
      return jsonResponse({ code: error.code, message: error.message }, 409)
    }
    return boardError(error)
  }
}

export async function deleteProjectBoardCard(
  service: ProjectBoardService,
  cardId: string,
  request: Request
): Promise<JsonResponse | Response> {
  const parsed = await parseBody(request, DeleteManualProjectBoardCardRequestSchema)
  if (!parsed.ok) return parsed.response
  try {
    return jsonResponse(await service.deleteManualCard(cardId, parsed.data))
  } catch (error) {
    return boardMutationError(service, parsed.data.workspace, error)
  }
}

export async function patchProjectBoardTodoOverlay(
  service: ProjectBoardService,
  threadId: string,
  todoId: string,
  request: Request
): Promise<JsonResponse | Response> {
  const parsed = await parseBody(request, PatchProjectBoardTodoOverlayRequestSchema)
  if (!parsed.ok) return parsed.response
  try {
    return jsonResponse(await service.patchTodoOverlay(threadId, todoId, parsed.data))
  } catch (error) {
    return boardMutationError(service, parsed.data.workspace, error)
  }
}

export async function patchThreadTodoStatus(
  threadService: ThreadService,
  _projectBoardService: ProjectBoardService | undefined,
  threadId: string,
  todoId: string,
  request: Request
): Promise<JsonResponse | Response> {
  const parsed = await parseBody(request, PatchThreadTodoRequestSchema)
  if (!parsed.ok) return parsed.response
  try {
    const todos = await threadService.patchTodoStatus(threadId, todoId, parsed.data.status)
    return jsonResponse(PatchThreadTodoResponseSchema.parse({ todos }))
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    if (/not found/i.test(message)) return ERRORS.notFound(message)
    if (/plan|path/i.test(message)) return ERRORS.validation(message)
    throw error
  }
}

async function parseBody<T>(
  request: Request,
  schema: { safeParse(value: unknown): { success: true; data: T } | { success: false; error: { issues: unknown } } }
): Promise<{ ok: true; data: T } | { ok: false; response: JsonResponse | Response }> {
  const body = await readJsonBody(request)
  if (!body.ok) return { ok: false, response: body.response }
  const parsed = schema.safeParse(body.value)
  if (!parsed.success) {
    return { ok: false, response: ERRORS.validation('invalid project board request', parsed.error.issues) }
  }
  return { ok: true, data: parsed.data }
}

async function boardMutationError(
  service: ProjectBoardService,
  workspace: string,
  error: unknown
): Promise<JsonResponse> {
  if (error instanceof ProjectBoardRevisionConflictError) {
    const snapshot = await service.snapshot({ workspace, includeArchived: true }).catch(() => undefined)
    return jsonResponse({
      code: 'conflict',
      message: 'Project board was updated in another window.',
      ...(snapshot ? { snapshot } : {})
    }, 409)
  }
  return boardError(error)
}

function boardError(error: unknown): JsonResponse {
  if (error instanceof ProjectBoardNotFoundError) return ERRORS.notFound(error.message)
  const message = error instanceof Error ? error.message : String(error)
  if (/workspace|cursor|absolute path|ENOENT|EACCES|permission/i.test(message)) {
    return ERRORS.validation(message)
  }
  throw error
}
