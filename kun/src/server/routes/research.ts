/**
 * [INPUT]: 依赖 server runtime 的 research service 和 shared research DTO parser
 * [OUTPUT]: 对外提供 /v1/research/runs 系列 HTTP handler
 * [POS]: server/routes 的 DeepResearch HTTP 接入层，只做认证后请求解析和 service 调用
 * [PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
 */
import { readJsonBody } from '../read-json-body.js'
import { jsonResponse, type JsonResponse } from '../response.js'
import { ERRORS } from './runtime-error.js'
import type { ServerRuntime } from './server-runtime.js'
import type {
  AnswerResearchScopeRequest,
  ApproveResearchRunRequest,
  ConfirmResearchScopeRequest,
  CreateResearchRunRequest
} from '../../research/index.js'

export async function createResearchRun(runtime: ServerRuntime, request: Request): Promise<JsonResponse> {
  const service = runtime.research
  if (!service) return ERRORS.unavailable('research runtime is not available')
  const body = await readJsonBody(request)
  if (!body.ok) return body.response
  const parsed = parseCreateRunRequest(body.value)
  if (!parsed.ok) return ERRORS.validation(parsed.message)
  try {
    return jsonResponse(await service.createRun(parsed.value))
  } catch (error) {
    return ERRORS.validation(errorMessage(error))
  }
}

export async function approveResearchRun(
  runtime: ServerRuntime,
  runId: string,
  request: Request
): Promise<JsonResponse> {
  const service = runtime.research
  if (!service) return ERRORS.unavailable('research runtime is not available')
  const body = await readJsonBody(request)
  if (!body.ok) return body.response
  const parsed = parseApproveRunRequest(body.value)
  if (!parsed.ok) return ERRORS.validation(parsed.message)
  try {
    return jsonResponse(await service.approveRun(runId, parsed.value))
  } catch (error) {
    return errorMessage(error).startsWith('Unknown research run')
      ? ERRORS.notFound(errorMessage(error))
      : ERRORS.validation(errorMessage(error))
  }
}

export async function confirmResearchScope(
  runtime: ServerRuntime,
  runId: string,
  request: Request
): Promise<JsonResponse> {
  const service = runtime.research
  if (!service) return ERRORS.unavailable('research runtime is not available')
  const body = await readJsonBody(request)
  if (!body.ok) return body.response
  const parsed = parseConfirmScopeRequest(body.value)
  if (!parsed.ok) return ERRORS.validation(parsed.message)
  try {
    return jsonResponse(await service.confirmScope(runId, parsed.value))
  } catch (error) {
    const message = errorMessage(error)
    return message.startsWith('Unknown research run')
      ? ERRORS.notFound(message)
      : ERRORS.validation(message)
  }
}

export async function answerResearchScope(
  runtime: ServerRuntime,
  runId: string,
  request: Request
): Promise<JsonResponse> {
  const service = runtime.research
  if (!service) return ERRORS.unavailable('research runtime is not available')
  const body = await readJsonBody(request)
  if (!body.ok) return body.response
  const parsed = parseAnswerScopeRequest(body.value)
  if (!parsed.ok) return ERRORS.validation(parsed.message)
  try {
    return jsonResponse(await service.answerScope(runId, parsed.value))
  } catch (error) {
    const message = errorMessage(error)
    return message.startsWith('Unknown research run')
      ? ERRORS.notFound(message)
      : ERRORS.validation(message)
  }
}

export function getResearchRun(runtime: ServerRuntime, runId: string): JsonResponse {
  const service = runtime.research
  if (!service) return ERRORS.unavailable('research runtime is not available')
  try {
    return jsonResponse(service.getRun(runId))
  } catch (error) {
    return ERRORS.notFound(errorMessage(error))
  }
}

export async function cancelResearchRun(
  runtime: ServerRuntime,
  runId: string,
  request: Request
): Promise<JsonResponse> {
  const service = runtime.research
  if (!service) return ERRORS.unavailable('research runtime is not available')
  const body = await readJsonBody(request)
  if (!body.ok) return body.response
  const reason = isRecord(body.value) && typeof body.value.reason === 'string' ? body.value.reason : undefined
  try {
    return jsonResponse(await service.cancelRun(runId, reason))
  } catch (error) {
    const message = errorMessage(error)
    return message.startsWith('Unknown research run')
      ? ERRORS.notFound(message)
      : ERRORS.conflict(message)
  }
}

function parseCreateRunRequest(value: unknown): { ok: true; value: CreateResearchRunRequest } | { ok: false; message: string } {
  if (!isRecord(value)) return { ok: false, message: 'request body must be an object' }
  if (typeof value.topic !== 'string' || value.topic.trim().length === 0) {
    return { ok: false, message: 'topic is required' }
  }
  const request: CreateResearchRunRequest = {
    topic: value.topic,
    ...(typeof value.workspaceRoot === 'string' ? { workspaceRoot: value.workspaceRoot } : {}),
    ...(typeof value.autoApprove === 'boolean' ? { autoApprove: value.autoApprove } : {}),
    ...(isResearchReasoningEffort(value.reasoningEffort) ? { reasoningEffort: value.reasoningEffort } : {}),
    ...(isRecord(value.brief) ? { brief: value.brief as CreateResearchRunRequest['brief'] } : {}),
    ...(isRecord(value.frame) ? { frame: value.frame as CreateResearchRunRequest['frame'] } : {}),
    ...(isRecord(value.budget) ? { budget: value.budget as CreateResearchRunRequest['budget'] } : {})
  }
  return { ok: true, value: request }
}

function parseApproveRunRequest(value: unknown): { ok: true; value: ApproveResearchRunRequest } | { ok: false; message: string } {
  if (!isRecord(value)) return { ok: true, value: {} }
  return {
    ok: true,
    value: {
      ...(typeof value.briefHash === 'string' ? { briefHash: value.briefHash } : {}),
      ...(typeof value.approvalMessageId === 'string' ? { approvalMessageId: value.approvalMessageId } : {}),
      ...(typeof value.autoRun === 'boolean' ? { autoRun: value.autoRun } : {})
    }
  }
}

function parseConfirmScopeRequest(value: unknown): { ok: true; value: ConfirmResearchScopeRequest } | { ok: false; message: string } {
  if (!isRecord(value)) return { ok: true, value: {} }
  return {
    ok: true,
    value: {
      ...(typeof value.confirmationMessageId === 'string' ? { confirmationMessageId: value.confirmationMessageId } : {}),
      ...(typeof value.autoApprove === 'boolean' ? { autoApprove: value.autoApprove } : {})
    }
  }
}

function parseAnswerScopeRequest(value: unknown): { ok: true; value: AnswerResearchScopeRequest } | { ok: false; message: string } {
  if (!isRecord(value)) return { ok: false, message: 'request body must be an object' }
  if (typeof value.message !== 'string' || value.message.trim().length === 0) {
    return { ok: false, message: 'message is required' }
  }
  return {
    ok: true,
    value: {
      message: value.message,
      ...(typeof value.autoApprove === 'boolean' ? { autoApprove: value.autoApprove } : {})
    }
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function isResearchReasoningEffort(value: unknown): value is NonNullable<CreateResearchRunRequest['reasoningEffort']> {
  return value === 'auto'
    || value === 'off'
    || value === 'low'
    || value === 'medium'
    || value === 'high'
    || value === 'max'
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}
