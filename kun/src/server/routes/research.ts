/**
 * [INPUT]: 依赖 server runtime 的 research service、带字节上限的 JSON reader 和 research 预算/DTO 约束
 * [OUTPUT]: 对外提供严格校验 create/list/get/scope/approve/cancel/retry 与当前模型/Provider 的 /v1/research/runs HTTP handler；旧轮次字段仅兼容接收并由预算解析器丢弃
 * [POS]: server/routes 的 DeepResearch HTTP 边界，拒绝未知字段、活跃极端保护越界和畸形嵌套值后再调用 service
 * [PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
 */
import { readJsonBody } from '../read-json-body.js'
import { jsonResponse, type JsonResponse } from '../response.js'
import { ERRORS } from './runtime-error.js'
import type { ServerRuntime } from './server-runtime.js'
import {
  RESEARCH_BUDGET_LIMITS,
  type AnswerResearchScopeRequest,
  type ApproveResearchRunRequest,
  type ConfirmResearchScopeRequest,
  type CreateResearchRunRequest,
  type ResearchBudget
} from '../../research/index.js'

export async function createResearchRun(runtime: ServerRuntime, request: Request): Promise<JsonResponse> {
  const service = runtime.research
  if (!service) return ERRORS.unavailable('research runtime is not available')
  const body = await readJsonBody(request, { maxBytes: 128 * 1024 })
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
  const body = await readJsonBody(request, { maxBytes: 128 * 1024 })
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
  const body = await readJsonBody(request, { maxBytes: 128 * 1024 })
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
  const body = await readJsonBody(request, { maxBytes: 128 * 1024 })
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

export function listResearchRuns(runtime: ServerRuntime, request: Request): JsonResponse {
  const service = runtime.research
  if (!service) return ERRORS.unavailable('research runtime is not available')
  const rawLimit = new URL(request.url).searchParams.get('limit')
  const limit = rawLimit === null ? 20 : Number(rawLimit)
  if (!Number.isInteger(limit) || limit <= 0 || limit > 50) {
    return ERRORS.validation('limit must be an integer between 1 and 50')
  }
  return jsonResponse({ runs: service.listRuns(limit) })
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
  const body = await readJsonBody(request, { maxBytes: 128 * 1024 })
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

export async function retryResearchRun(runtime: ServerRuntime, runId: string): Promise<JsonResponse> {
  const service = runtime.research
  if (!service) return ERRORS.unavailable('research runtime is not available')
  try {
    return jsonResponse(await service.retryRun(runId))
  } catch (error) {
    const message = errorMessage(error)
    return message.startsWith('Unknown research run')
      ? ERRORS.notFound(message)
      : ERRORS.conflict(message)
  }
}

function parseCreateRunRequest(value: unknown): { ok: true; value: CreateResearchRunRequest } | { ok: false; message: string } {
  if (!isRecord(value)) return { ok: false, message: 'request body must be an object' }
  const unknownField = firstUnknownKey(value, [
    'topic', 'workspaceRoot', 'autoApprove', 'reasoningEffort', 'model', 'providerId', 'brief', 'frame', 'budget'
  ])
  if (unknownField) return { ok: false, message: `unknown request field: ${unknownField}` }
  if (typeof value.topic !== 'string' || value.topic.trim().length === 0) {
    return { ok: false, message: 'topic is required' }
  }
  if (value.topic.length > 4_000) return { ok: false, message: 'topic exceeds 4000 characters' }
  if (value.workspaceRoot !== undefined && (typeof value.workspaceRoot !== 'string' || value.workspaceRoot.length > 4_096)) {
    return { ok: false, message: 'workspaceRoot must be a string no longer than 4096 characters' }
  }
  if (value.autoApprove !== undefined && typeof value.autoApprove !== 'boolean') {
    return { ok: false, message: 'autoApprove must be a boolean' }
  }
  if (value.reasoningEffort !== undefined && !isResearchReasoningEffort(value.reasoningEffort)) {
    return { ok: false, message: 'reasoningEffort is invalid' }
  }
  const model = optionalBoundedString(value.model, 'model', 256)
  if (!model.ok) return model
  const providerId = optionalBoundedString(value.providerId, 'providerId', 128)
  if (!providerId.ok) return providerId
  const brief = parsePartialBrief(value.brief)
  if (!brief.ok) return brief
  const frame = parsePartialFrame(value.frame)
  if (!frame.ok) return frame
  const budget = parseResearchBudget(value.budget)
  if (!budget.ok) return budget
  const request: CreateResearchRunRequest = {
    topic: value.topic.trim(),
    ...(typeof value.workspaceRoot === 'string' && value.workspaceRoot.trim() ? { workspaceRoot: value.workspaceRoot.trim() } : {}),
    ...(typeof value.autoApprove === 'boolean' ? { autoApprove: value.autoApprove } : {}),
    ...(isResearchReasoningEffort(value.reasoningEffort) ? { reasoningEffort: value.reasoningEffort } : {}),
    ...(model.value ? { model: model.value } : {}),
    ...(providerId.value ? { providerId: providerId.value } : {}),
    ...(brief.value ? { brief: brief.value } : {}),
    ...(frame.value ? { frame: frame.value } : {}),
    ...(budget.value ? { budget: budget.value } : {})
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

function parseResearchBudget(value: unknown): { ok: true; value?: Partial<ResearchBudget> } | { ok: false; message: string } {
  if (value === undefined) return { ok: true }
  if (!isRecord(value)) return { ok: false, message: 'budget must be an object' }
  const limits: Partial<Record<keyof ResearchBudget, number>> = {
    maxWorkers: RESEARCH_BUDGET_LIMITS.maxWorkers,
    maxSubagents: RESEARCH_BUDGET_LIMITS.maxSubagents,
    minSources: RESEARCH_BUDGET_LIMITS.maxSources,
    targetSources: RESEARCH_BUDGET_LIMITS.maxSources,
    maxSources: RESEARCH_BUDGET_LIMITS.maxSources,
    maxModelCalls: RESEARCH_BUDGET_LIMITS.maxModelCalls,
    maxTotalTokens: RESEARCH_BUDGET_LIMITS.maxTotalTokens,
    timeoutMs: RESEARCH_BUDGET_LIMITS.timeoutMs
  }
  const ignoredLegacyRoundFields = ['maxRounds', 'maxResearchRounds', 'maxSynthesisRetries'] as const
  const allowed = ['preset', 'reasoningEffort', ...Object.keys(limits), ...ignoredLegacyRoundFields]
  const unknownField = firstUnknownKey(value, allowed)
  if (unknownField) return { ok: false, message: `unknown budget field: ${unknownField}` }
  if (value.preset !== undefined && !['quick', 'standard', 'deep'].includes(String(value.preset))) {
    return { ok: false, message: 'budget.preset is invalid' }
  }
  if (value.reasoningEffort !== undefined && !isResearchReasoningEffort(value.reasoningEffort)) {
    return { ok: false, message: 'budget.reasoningEffort is invalid' }
  }
  for (const [field, maximum] of Object.entries(limits)) {
    const fieldValue = value[field]
    if (fieldValue === undefined) continue
    if (!Number.isInteger(fieldValue) || (fieldValue as number) <= 0 || (fieldValue as number) > maximum!) {
      return { ok: false, message: `budget.${field} must be a positive integer no greater than ${maximum}` }
    }
  }
  for (const field of ignoredLegacyRoundFields) {
    const fieldValue = value[field]
    if (fieldValue === undefined) continue
    if (!Number.isInteger(fieldValue) || (fieldValue as number) <= 0) {
      return { ok: false, message: `budget.${field} must be a positive integer` }
    }
  }
  const minSources = numberValue(value.minSources)
  const targetSources = numberValue(value.targetSources)
  const maxSources = numberValue(value.maxSources)
  if (minSources !== undefined && targetSources !== undefined && minSources > targetSources) {
    return { ok: false, message: 'budget.minSources must not exceed targetSources' }
  }
  if (targetSources !== undefined && maxSources !== undefined && targetSources > maxSources) {
    return { ok: false, message: 'budget.targetSources must not exceed maxSources' }
  }
  if (minSources !== undefined && maxSources !== undefined && minSources > maxSources) {
    return { ok: false, message: 'budget.minSources must not exceed maxSources' }
  }
  if (numberValue(value.maxWorkers) !== undefined && numberValue(value.maxSubagents) !== undefined
    && numberValue(value.maxWorkers)! > numberValue(value.maxSubagents)!) {
    return { ok: false, message: 'budget.maxWorkers must not exceed maxSubagents' }
  }
  return { ok: true, value: value as Partial<ResearchBudget> }
}

function parsePartialBrief(value: unknown): { ok: true; value?: CreateResearchRunRequest['brief'] } | { ok: false; message: string } {
  if (value === undefined) return { ok: true }
  if (!isRecord(value)) return { ok: false, message: 'brief must be an object' }
  const unknownField = firstUnknownKey(value, [
    'id', 'version', 'topic', 'userIntent', 'userClarifications', 'targetAudience', 'outputFormat',
    'sourcePolicy', 'successCriteria', 'constraints', 'createdAt', 'updatedAt'
  ])
  if (unknownField) return { ok: false, message: `unknown brief field: ${unknownField}` }
  for (const field of ['id', 'topic', 'userIntent', 'targetAudience', 'outputFormat', 'createdAt', 'updatedAt']) {
    if (value[field] !== undefined && (typeof value[field] !== 'string' || (value[field] as string).length > 4_000)) {
      return { ok: false, message: `brief.${field} must be a bounded string` }
    }
  }
  if (value.version !== undefined && (!Number.isInteger(value.version) || (value.version as number) <= 0)) {
    return { ok: false, message: 'brief.version must be a positive integer' }
  }
  for (const field of ['userClarifications', 'successCriteria', 'constraints']) {
    if (value[field] !== undefined && !isBoundedStringArray(value[field], 64, 2_000)) {
      return { ok: false, message: `brief.${field} must be a bounded string array` }
    }
  }
  if (value.sourcePolicy !== undefined) {
    if (!isRecord(value.sourcePolicy)) return { ok: false, message: 'brief.sourcePolicy must be an object' }
    const unknownPolicyField = firstUnknownKey(value.sourcePolicy, [
      'allowedSourceTypes', 'allowedDomains', 'preferredDomains', 'minSourceCount', 'maxSourceCount', 'requireCitations'
    ])
    if (unknownPolicyField) return { ok: false, message: `unknown brief.sourcePolicy field: ${unknownPolicyField}` }
    if (value.sourcePolicy.allowedSourceTypes !== undefined
      && (!Array.isArray(value.sourcePolicy.allowedSourceTypes)
        || value.sourcePolicy.allowedSourceTypes.some((item) => item !== 'web'))) {
      return { ok: false, message: 'brief.sourcePolicy.allowedSourceTypes only supports web in this release' }
    }
    for (const field of ['allowedDomains', 'preferredDomains']) {
      if (value.sourcePolicy[field] !== undefined && !isBoundedStringArray(value.sourcePolicy[field], 64, 253)) {
        return { ok: false, message: `brief.sourcePolicy.${field} must be a bounded string array` }
      }
    }
    for (const field of ['minSourceCount', 'maxSourceCount']) {
      const count = value.sourcePolicy[field]
      if (count !== undefined && (!Number.isInteger(count) || (count as number) <= 0 || (count as number) > RESEARCH_BUDGET_LIMITS.maxSources)) {
        return { ok: false, message: `brief.sourcePolicy.${field} is invalid` }
      }
    }
    if (value.sourcePolicy.requireCitations !== undefined && typeof value.sourcePolicy.requireCitations !== 'boolean') {
      return { ok: false, message: 'brief.sourcePolicy.requireCitations must be a boolean' }
    }
  }
  return { ok: true, value: value as CreateResearchRunRequest['brief'] }
}

function parsePartialFrame(value: unknown): { ok: true; value?: CreateResearchRunRequest['frame'] } | { ok: false; message: string } {
  if (value === undefined) return { ok: true }
  if (!isRecord(value)) return { ok: false, message: 'frame must be an object' }
  const stringFields = ['coreResearchThread', 'centralQuestion', 'decisionToSupport', 'targetUserOrActor', 'coreTask', 'interventionHypothesis']
  const arrayFields = ['currentPath', 'keyFriction', 'alternativesToCompare', 'investigationPath', 'evidenceNeeded', 'disconfirmingEvidenceNeeded', 'nonGoals']
  const unknownField = firstUnknownKey(value, [...stringFields, ...arrayFields, 'coreQuestions'])
  if (unknownField) return { ok: false, message: `unknown frame field: ${unknownField}` }
  for (const field of stringFields) {
    if (value[field] !== undefined && (typeof value[field] !== 'string' || (value[field] as string).length > 4_000)) {
      return { ok: false, message: `frame.${field} must be a bounded string` }
    }
  }
  for (const field of arrayFields) {
    if (value[field] !== undefined && !isBoundedStringArray(value[field], 64, 2_000)) {
      return { ok: false, message: `frame.${field} must be a bounded string array` }
    }
  }
  if (value.coreQuestions !== undefined) {
    if (!Array.isArray(value.coreQuestions) || value.coreQuestions.length > 64) {
      return { ok: false, message: 'frame.coreQuestions must be a bounded array' }
    }
    for (const question of value.coreQuestions) {
      if (!isRecord(question) || firstUnknownKey(question, ['id', 'text', 'priority', 'required'])) {
        return { ok: false, message: 'frame.coreQuestions contains an invalid object' }
      }
      if (typeof question.id !== 'string' || typeof question.text !== 'string'
        || question.id.length > 256 || question.text.length > 2_000
        || !['high', 'medium', 'low'].includes(String(question.priority))
        || typeof question.required !== 'boolean') {
        return { ok: false, message: 'frame.coreQuestions contains invalid fields' }
      }
    }
  }
  return { ok: true, value: value as CreateResearchRunRequest['frame'] }
}

function optionalBoundedString(
  value: unknown,
  field: string,
  maxLength: number
): { ok: true; value?: string } | { ok: false; message: string } {
  if (value === undefined) return { ok: true }
  if (typeof value !== 'string' || value.length > maxLength) {
    return { ok: false, message: `${field} must be a string no longer than ${maxLength} characters` }
  }
  return { ok: true, ...(value.trim() ? { value: value.trim() } : {}) }
}

function isBoundedStringArray(value: unknown, maxItems: number, maxLength: number): value is string[] {
  return Array.isArray(value)
    && value.length <= maxItems
    && value.every((item) => typeof item === 'string' && item.length <= maxLength)
}

function firstUnknownKey(value: Record<string, unknown>, allowed: readonly string[]): string | undefined {
  const allowedSet = new Set(allowed)
  return Object.keys(value).find((key) => !allowedSet.has(key))
}

function numberValue(value: unknown): number | undefined {
  return typeof value === 'number' ? value : undefined
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
