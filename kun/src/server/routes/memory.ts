import { MemoryCreateRequest, MemoryUpdateRequest } from '../../contracts/memory.js'
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
  return jsonResponse({
    memories: await store.list({
      workspace: url.searchParams.get('workspace') ?? undefined,
      project: url.searchParams.get('project') ?? undefined,
      includeDeleted: url.searchParams.get('include_deleted') === 'true',
      all: url.searchParams.get('all') === 'true'
    })
  })
}

export async function createMemory(store: MemoryStore | undefined, request: Request): Promise<JsonResponse | Response> {
  if (!store) return ERRORS.unavailable('memory store is unavailable')
  const body = await readJsonBody(request)
  if (!body.ok) return body.response
  const parsed = MemoryCreateRequest.safeParse(body.value)
  if (!parsed.success) return ERRORS.validation('invalid memory create body', parsed.error.issues)
  return jsonResponse({ memory: await store.create(parsed.data) }, 201)
}

export async function updateMemory(store: MemoryStore | undefined, id: string, request: Request): Promise<JsonResponse | Response> {
  if (!store) return ERRORS.unavailable('memory store is unavailable')
  const body = await readJsonBody(request)
  if (!body.ok) return body.response
  const parsed = MemoryUpdateRequest.safeParse(body.value)
  if (!parsed.success) return ERRORS.validation('invalid memory update body', parsed.error.issues)
  try {
    const url = new URL(request.url)
    const workspace = url.searchParams.get('workspace') ?? undefined
    const project = url.searchParams.get('project') ?? undefined
    return jsonResponse({ memory: await store.update(id, parsed.data, { workspace, project }) })
  } catch (error) {
    return ERRORS.notFound(errorMessage(error))
  }
}

export async function deleteMemory(store: MemoryStore | undefined, id: string, request: Request): Promise<JsonResponse> {
  if (!store) return ERRORS.unavailable('memory store is unavailable')
  try {
    const url = new URL(request.url)
    const workspace = url.searchParams.get('workspace') ?? undefined
    const project = url.searchParams.get('project') ?? undefined
    return jsonResponse({ memory: await store.delete(id, { workspace, project }) })
  } catch (error) {
    return ERRORS.notFound(errorMessage(error))
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

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
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
