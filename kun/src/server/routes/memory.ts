import { MemoryRevisionConflictError } from '../../memory/memory-revisions.js'
import { MemoryForgottenError } from '../../memory/memory-forgetting.js'
import { MemoryNotFoundError } from '../../memory/memory-not-found-error.js'
import { MemoryAuthority, MemoryCreateRequest, MemoryType, MemoryUpdateRequest } from '../../contracts/memory.js'
import { MemoryFeedbackDiagnostics } from '../../contracts/memory-feedback.js'
import type { MemoryStore } from '../../memory/memory-store.js'
import {
  MemoryConfirmRequest,
  MemoryCorrectRequest
} from '../../contracts/memory-feedback.js'
import { MemoryFeedbackServiceError } from '../../memory/memory-feedback-service.js'
import type { MemoryFeedbackRuntime } from '../../memory/memory-feedback-runtime.js'
import { jsonResponse, type JsonResponse } from '../response.js'
import { readJsonBody } from '../read-json-body.js'
import { ERRORS } from './runtime-error.js'

export async function listMemories(store: MemoryStore | undefined, request: Request): Promise<JsonResponse> {
  if (!store) return ERRORS.unavailable('memory store is unavailable')
  const url = new URL(request.url)
  const authority = url.searchParams.get('authority') ?? undefined
  const type = url.searchParams.get('type') ?? undefined
  if (authority !== undefined && !MemoryAuthority.options.includes(authority as never)) {
    return ERRORS.validation('invalid memory authority filter')
  }
  if (type !== undefined && !MemoryType.options.includes(type as never)) {
    return ERRORS.validation('invalid memory type filter')
  }
  return jsonResponse({
    memories: (await store.list({
      workspace: url.searchParams.get('workspace') ?? undefined,
      project: url.searchParams.get('project') ?? undefined,
      includeDeleted: url.searchParams.get('include_deleted') === 'true',
      all: url.searchParams.get('all') === 'true',
      authority: authority as MemoryAuthority | undefined,
      type: type as MemoryType | undefined
    })).map((memory) => ({ ...memory, history: [] }))
  })
}

export async function createMemory(store: MemoryStore | undefined, request: Request): Promise<JsonResponse | Response> {
  if (!store) return ERRORS.unavailable('memory store is unavailable')
  const body = await readJsonBody(request)
  if (!body.ok) return body.response
  const parsed = MemoryCreateRequest.safeParse(body.value)
  if (!parsed.success) return ERRORS.validation('invalid memory create body', parsed.error.issues)
  if (hasHostEvidence(parsed.data)) return ERRORS.validation('execution receipts and consolidation are host-owned evidence')
  if (parsed.data.agentContext) return ERRORS.validation('use the scoped agent memory endpoint')
  if (parsed.data.supersedes && parsed.data.supersedesExpectedRevision === undefined) return ERRORS.validation('supersession requires supersedesExpectedRevision')
  try { return jsonResponse({ memory: await store.create(parsed.data) }, 201) }
  catch (error) {
    if (error instanceof MemoryRevisionConflictError || error instanceof MemoryForgottenError) return ERRORS.conflict(error.message)
    if (error instanceof MemoryNotFoundError) return ERRORS.notFound(error.message)
    throw error
  }
}

export async function updateMemory(store: MemoryStore | undefined, id: string, request: Request): Promise<JsonResponse | Response> {
  if (!store) return ERRORS.unavailable('memory store is unavailable')
  const body = await readJsonBody(request)
  if (!body.ok) return body.response
  const parsed = MemoryUpdateRequest.safeParse(body.value)
  if (!parsed.success) return ERRORS.validation('invalid memory update body', parsed.error.issues)
  if (hasHostEvidence(parsed.data)) return ERRORS.validation('execution receipts and consolidation are host-owned evidence')
  if (parsed.data.agentContext) return ERRORS.validation('use the scoped agent memory endpoint')
  if (parsed.data.expectedRevision === undefined) return ERRORS.validation('memory edits require expectedRevision; reload before editing')
  try {
    const url = new URL(request.url)
    const workspace = url.searchParams.get('workspace') ?? undefined
    const project = url.searchParams.get('project') ?? undefined
    return jsonResponse({ memory: await store.update(id, parsed.data, { workspace, project }) })
  } catch (error) {
    if (error instanceof MemoryRevisionConflictError || error instanceof MemoryForgottenError) return ERRORS.conflict(error.message)
    if (error instanceof MemoryNotFoundError) return ERRORS.notFound(error.message)
    throw error
  }
}

export async function deleteMemory(store: MemoryStore | undefined, id: string, request: Request): Promise<JsonResponse> {
  if (!store) return ERRORS.unavailable('memory store is unavailable')
  try {
    const url = new URL(request.url)
    const workspace = url.searchParams.get('workspace') ?? undefined
    const project = url.searchParams.get('project') ?? undefined
    const expectedRevision = Number(url.searchParams.get('expected_revision'))
    if (!Number.isSafeInteger(expectedRevision) || expectedRevision < 1) return ERRORS.validation('forget requires expected_revision')
    if (!store.lifecycle) return ERRORS.unavailable('memory lifecycle is unavailable')
    const result = await store.lifecycle(id, { action: 'forget', expectedRevision }, { workspace, project })
    return jsonResponse({ memory: result.memory })
  } catch (error) {
    if (error instanceof MemoryRevisionConflictError || error instanceof MemoryForgottenError) return ERRORS.conflict(error.message)
    if (error instanceof MemoryNotFoundError) return ERRORS.notFound(error.message)
    throw error
  }
}

export async function memoryDiagnostics(
  store: MemoryStore | undefined,
  feedback?: MemoryFeedbackRuntime
): Promise<JsonResponse> {
  if (!store) return jsonResponse({ enabled: false, rootDir: '', activeCount: 0, tombstoneCount: 0, lastInjectedIds: [] })
  const diagnostics = await store.diagnostics()
  if (!feedback) return jsonResponse(diagnostics)
  let feedbackDiagnostics
  try {
    feedbackDiagnostics = await feedback.diagnostics()
  } catch (error) {
    console.warn('[kun] memory feedback diagnostics failed:', error)
    feedbackDiagnostics = degradedFeedbackDiagnostics(feedback)
  }
  return jsonResponse({ ...diagnostics, feedback: feedbackDiagnostics })
}

export async function confirmMemory(
  feedback: MemoryFeedbackRuntime | undefined,
  id: string,
  request: Request
): Promise<JsonResponse | Response> {
  if (!feedback) return ERRORS.unavailable('memory feedback is unavailable')
  const body = await readJsonBody(request)
  if (!body.ok) return body.response
  const parsed = parseFeedbackBody(body.value, id, MemoryConfirmRequest)
  if (!parsed.success) return ERRORS.validation('invalid memory confirmation body', parsed.error.issues)
  try {
    return jsonResponse({ confirmation: await feedback.confirm(parsed.data) })
  } catch (error) {
    return memoryFeedbackError(error)
  }
}

export async function correctMemory(
  feedback: MemoryFeedbackRuntime | undefined,
  id: string,
  request: Request
): Promise<JsonResponse | Response> {
  if (!feedback) return ERRORS.unavailable('memory feedback is unavailable')
  const body = await readJsonBody(request)
  if (!body.ok) return body.response
  const parsed = parseFeedbackBody(body.value, id, MemoryCorrectRequest)
  if (!parsed.success) return ERRORS.validation('invalid memory correction body', parsed.error.issues)
  if (parsed.data.expectedRevision === undefined) return ERRORS.validation('memory corrections require expectedRevision')
  try {
    return jsonResponse({ correction: await feedback.correct(parsed.data) })
  } catch (error) {
    return memoryFeedbackError(error)
  }
}

function memoryFeedbackError(error: unknown): JsonResponse {
  if (!(error instanceof MemoryFeedbackServiceError)) return ERRORS.internal('memory feedback operation failed')
  switch (error.code) {
    case 'not-found': return ERRORS.notFound(error.message)
    case 'inactive':
    case 'id-conflict': return ERRORS.conflict(error.message)
    case 'unavailable': return ERRORS.unavailable(error.message)
    case 'validation': return ERRORS.validation(error.message)
    default: return ERRORS.internal('memory feedback operation failed')
  }
}

function parseFeedbackBody<T extends { memoryId: string }>(
  value: unknown,
  id: string,
  schema: { safeParse(input: unknown): { success: true; data: T } | { success: false; error: { issues: unknown } } }
) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return schema.safeParse({ memoryId: id })
  }
  const body = value as Record<string, unknown>
  if (body.memoryId !== undefined && body.memoryId !== id) {
    return schema.safeParse({ memoryId: id, __pathMemoryIdMismatch: body.memoryId })
  }
  return schema.safeParse({ ...body, memoryId: id })
}

function degradedFeedbackDiagnostics(feedback: MemoryFeedbackRuntime) {
  let enabled = false
  try {
    enabled = feedback.enabled()
  } catch {
    // Keep the diagnostics fallback bounded even if the adapter is unhealthy.
  }
  return MemoryFeedbackDiagnostics.parse({
    enabled,
    state: 'degraded',
    projection: 'degraded',
    eventCount: 0,
    aggregateCount: 0,
    duplicateCount: 0,
    malformedCount: 0,
    degradedReason: 'feedback diagnostics unavailable'
  })
}


function hasHostEvidence(input: { consolidation?: unknown; sources?: ReadonlyArray<{ receiptId?: string;
  repositorySha?: string; artifactIds?: string[]; outcome?: string }> }): boolean {
  return input.consolidation !== undefined || Boolean(input.sources?.some((source) =>
    source.receiptId !== undefined || source.repositorySha !== undefined ||
    source.artifactIds !== undefined || source.outcome !== undefined))
}
