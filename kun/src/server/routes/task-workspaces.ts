import { readFile } from 'node:fs/promises'
import { isAbsolute, relative, resolve } from 'node:path'
import { jsonResponse, type JsonResponse } from '../response.js'
import { ERRORS } from './runtime-error.js'
import type { AttributionLedger } from '../../ade/attribution-ledger.js'
import type { ChangeRequestService } from '../../ade/change-request-service.js'
import type { FileTeamStore } from '../../ade/team-store.js'
import {
  CreateChangeRequestSchema,
  CreateTaskWorkspaceRequestSchema,
  DiscardTaskWorkspaceRequestSchema,
  IntegrateTaskWorkspaceRequestSchema
} from '../../contracts/task-workspace.js'
import { TaskWorkspaceError, type TaskWorkspaceService } from '../../workspace-tasks/task-workspace-service.js'
import {
  taskWorkspaceDiffFile,
  taskWorkspaceDiffList
} from '../../workspace-tasks/task-workspace-diff.js'
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

/** GET /v1/task-workspaces?ownerThreadId=…|boundThreadId=… */
export function listTaskWorkspacesResponse(
  service: TaskWorkspaceService,
  request: Request
): JsonResponse {
  const params = new URL(request.url).searchParams
  const ownerThreadId = params.get('ownerThreadId') ?? undefined
  const boundThreadId = params.get('boundThreadId') ?? undefined
  return jsonResponse({
    records: service.list(
      ownerThreadId || boundThreadId ? { ownerThreadId, boundThreadId } : undefined
    )
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

/** GET /v1/task-workspaces/:id/diff — capture, then per-file stats (11 §3). */
export async function taskWorkspaceDiffResponse(
  service: TaskWorkspaceService,
  artifacts: { get(id: string): Promise<string | null> },
  workspaceId: string
): Promise<JsonResponse> {
  try {
    const record = await service.capture(workspaceId)
    return jsonResponse(await taskWorkspaceDiffList(record, artifacts))
  } catch (error) {
    return serviceError(error)
  }
}

/** GET /v1/task-workspaces/:id/diff/file?path= — one file's patch + texts. */
export async function taskWorkspaceDiffFileResponse(
  service: TaskWorkspaceService,
  artifacts: { get(id: string): Promise<string | null> },
  request: Request,
  workspaceId: string
): Promise<JsonResponse> {
  const path = new URL(request.url).searchParams.get('path')
  if (!path) return ERRORS.validation('missing path query parameter')
  try {
    const record = await service.capture(workspaceId)
    const file = await taskWorkspaceDiffFile(record, artifacts, path)
    if (!file) return ERRORS.notFound('file not present in workspace diff')
    return jsonResponse(file)
  } catch (error) {
    return serviceError(error)
  }
}

const ATTRIBUTION_CONTENT_LIMIT = 4 * 1024 * 1024

/**
 * GET /v1/task-workspaces/:id/attribution?path= — per-line authorship for
 * the file's current workspace content (11 §6). Lines without a ledger
 * match are human-or-unknown; `label` enriches worker ids for the hover.
 */
export async function taskWorkspaceAttributionResponse(
  service: TaskWorkspaceService,
  ledger: AttributionLedger,
  teams: Pick<FileTeamStore, 'list'> | undefined,
  request: Request,
  workspaceId: string
): Promise<JsonResponse> {
  const record = service.get(workspaceId)
  if (!record) return ERRORS.notFound('task workspace not found')
  const rawPath = new URL(request.url).searchParams.get('path')
  if (!rawPath) return ERRORS.validation('missing path query parameter')
  const rel = relative(record.path, resolve(record.path, rawPath))
  if (!rel || rel.startsWith('..') || isAbsolute(rel)) {
    return ERRORS.validation('path escapes the task workspace')
  }
  const key = rel.split(/[\\/]+/).join('/')
  let content: string
  try {
    const buffer = await readFile(resolve(record.path, rel))
    if (buffer.byteLength > ATTRIBUTION_CONTENT_LIMIT) {
      return jsonResponse({ workspaceId, path: key, lines: [], tooLarge: true })
    }
    content = buffer.toString('utf8')
  } catch {
    return ERRORS.notFound('file not found in task workspace')
  }
  const lines = await ledger.attribute(workspaceId, key, content)
  const labels = new Map<string, string>()
  if (teams && lines.length) {
    for (const team of await teams.list().catch(() => [])) {
      for (const worker of team.workers) labels.set(worker.workerId, worker.label)
    }
  }
  return jsonResponse({
    workspaceId,
    path: key,
    lines: lines.map((line) => ({
      ...line,
      label: line.unitId ? labels.get(line.unitId) : undefined
    }))
  })
}

/**
 * GET /v1/task-workspaces/:id/change-request — forge availability plus the
 * persisted PR snapshot, refreshed live through `gh` when available (11 §7.2).
 */
export async function taskWorkspaceChangeRequestStatusResponse(
  service: TaskWorkspaceService,
  changeRequests: ChangeRequestService,
  workspaceId: string
): Promise<JsonResponse> {
  if (!service.get(workspaceId)) return ERRORS.notFound('task workspace not found')
  return jsonResponse(await changeRequests.status(workspaceId))
}

/**
 * POST /v1/task-workspaces/:id/change-request — push the workspace branch
 * and open a PR through `gh` (GitHub only; other forges report unsupported).
 */
export async function taskWorkspaceChangeRequestCreateResponse(
  service: TaskWorkspaceService,
  changeRequests: ChangeRequestService,
  request: Request,
  workspaceId: string
): Promise<JsonResponse> {
  if (!service.get(workspaceId)) return ERRORS.notFound('task workspace not found')
  const body = await request.json().catch(() => undefined)
  const parsed = CreateChangeRequestSchema.safeParse(body ?? {})
  if (!parsed.success) {
    return ERRORS.validation('invalid change-request create request', parsed.error.issues)
  }
  const result = await changeRequests.create(workspaceId, parsed.data)
  if (!result.ok) {
    return jsonResponse({ error: result.userReport, reason: result.reason }, 409)
  }
  return jsonResponse({ request: result.request }, 201)
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

/** GET /v1/task-workspaces/:id/integrate-preview — read-only availability. */
export async function taskWorkspaceIntegratePreviewResponse(
  service: TaskWorkspaceService,
  workspaceId: string
): Promise<JsonResponse> {
  if (!service.get(workspaceId)) return ERRORS.notFound('task workspace not found')
  return jsonResponse({ preview: await service.integratePreview(workspaceId) })
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
