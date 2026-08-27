import type {
  ApprovalStatusPayload,
  ApprovalReviewEventPayload,
  ChatBlock,
  CompactionEventPayload,
  ComponentPrototypeMetadata,
  DelegatedRuntimeState,
  GeneratedFileReference,
  NormalizedThread,
  ReviewBlock,
  ReviewEventPayload,
  ReviewOutput,
  ReviewTarget,
  RequestContextSnapshot,
  RuntimeChildMetadata,
  RuntimeErrorEventPayload,
  RuntimeStatusEventPayload,
  ThreadGoal,
  ThreadTodoList,
  UserInputRequestPayload,
  UserMessageEventPayload,
  ThreadDeltaEvent,
  ThreadEventSink,
  ThreadUsageSnapshot,
  ToolBlock,
  ToolEventPayload,
  UserInputAnswer,
  UserInputQuestion
} from './types'
import { normalizeKunRuntimeEvent, type KunEventNormalizerDeps } from './kun-event-normalizer'
import type { RuntimeProjectionAction } from './runtime-projection-actions'
import { redactSecrets, redactSecretText } from '@shared/secret-redaction'
import { applyClientUserMessageSourceMeta } from '@shared/background-shell-notice'
import {
  PRESENTATION_STUDIO_EXTENSION_ID,
  PRESENTATION_STUDIO_WRITE_TOOL_NAMES,
  presentationStudioCanonicalToolId,
  presentationStudioModelAlias
} from '@shared/presentation-artifact'
import type {
  CoreChildRuntimeMetadataJson,
  CoreRuntimeEventJson,
  CoreThreadGoalJson,
  CoreThreadTodoListJson,
  CoreThreadSummaryJson,
  CoreTurnItemJson,
  CoreReviewOutputJson,
  CoreReviewTargetJson,
  CoreUsageSnapshotJson
} from './kun-contract'
import {
  ComposerContextAttachmentSchema,
  MAX_COMPOSER_CONTEXT_ATTACHMENTS,
  type ComposerContextAttachment
} from '@kun/extension-api'

import { applyRuntimeDisclosureMeta, itemCreatedAt } from './kun-mapper-core'


export function userInputQuestionsFromItem(item: CoreTurnItemJson): UserInputQuestion[] {
  return questionsFromCore(item.questions, item.prompt, item.inputId ?? item.id)
}

export function questionsFromCore(
  questions: CoreTurnItemJson['questions'] | CoreRuntimeEventJson['questions'] | undefined,
  prompt: string | undefined,
  fallbackId: string
): UserInputQuestion[] {
  if (Array.isArray(questions) && questions.length > 0) {
    return questions
      .map((question) => normalizeUserInputQuestion(question))
      .filter((question): question is UserInputQuestion => question !== null)
  }
  const promptText = typeof prompt === 'string' ? prompt.trim() : ''
  if (!promptText) return []
  return [
    {
      header: 'Input',
      id: fallbackId,
      question: promptText,
      options: []
    }
  ]
}

export function firstNonEmptyUserInputText(...values: unknown[]): string | undefined {
  for (const value of values) {
    if (typeof value !== 'string') continue
    const normalized = value.trim()
    if (normalized) return normalized
  }
  return undefined
}

export function normalizeUserInputQuestion(question: unknown): UserInputQuestion | null {
  if (!question || typeof question !== 'object') return null
  const raw = question as Record<string, unknown>
  const text = firstNonEmptyUserInputText(raw.question, raw.prompt, raw.message)
  if (!text) return null
  const options = Array.isArray(raw.options)
    ? raw.options
        .map((option) => normalizeUserInputOption(option))
        .filter((option): option is UserInputQuestion['options'][number] => option !== null)
    : []
  return {
    header: typeof raw.header === 'string' && raw.header.trim() ? raw.header.trim() : 'Input',
    id: typeof raw.id === 'string' && raw.id.trim() ? raw.id.trim() : 'input',
    question: text,
    options,
    selectionMode: raw.selectionMode === 'multiple' && options.length > 0 ? 'multiple' : 'single',
    ...(positiveInteger(raw.minSelections) ? { minSelections: positiveInteger(raw.minSelections) } : {}),
    ...(positiveInteger(raw.maxSelections) ? { maxSelections: positiveInteger(raw.maxSelections) } : {})
  }
}

export function positiveInteger(value: unknown): number | undefined {
  if (typeof value !== 'number' || !Number.isFinite(value)) return undefined
  const normalized = Math.floor(value)
  return normalized > 0 ? normalized : undefined
}

export function nonnegativeInteger(value: unknown): number | undefined {
  if (typeof value !== 'number' || !Number.isFinite(value)) return undefined
  const normalized = Math.floor(value)
  return normalized >= 0 ? normalized : undefined
}

export function normalizeUserInputOption(option: unknown): UserInputQuestion['options'][number] | null {
  if (!option || typeof option !== 'object') return null
  const raw = option as Record<string, unknown>
  const label = typeof raw.label === 'string' && raw.label.trim() ? raw.label.trim() : null
  if (!label) return null
  return {
    label,
    description: typeof raw.description === 'string' ? raw.description : ''
  }
}

export function userInputAnswersFromCore(answers: unknown): UserInputAnswer[] | undefined {
  if (!Array.isArray(answers)) return undefined
  const normalized = answers
    .map((answer) => normalizeUserInputAnswer(answer))
    .filter((answer): answer is UserInputAnswer => answer !== null)
  return normalized.length > 0 ? normalized : undefined
}

export function normalizeUserInputAnswer(answer: unknown): UserInputAnswer | null {
  if (!answer || typeof answer !== 'object') return null
  const raw = answer as Record<string, unknown>
  const id = typeof raw.id === 'string' && raw.id.trim() ? raw.id.trim() : null
  const label = typeof raw.label === 'string' && raw.label.trim() ? raw.label.trim() : null
  if (!id || !label) return null
  const labels = Array.isArray(raw.labels)
    ? raw.labels
        .filter((value): value is string => typeof value === 'string' && value.trim().length > 0)
        .map((value) => value.trim())
    : undefined
  const values = Array.isArray(raw.values)
    ? raw.values.filter((value): value is string => typeof value === 'string')
    : undefined
  return {
    id,
    label,
    value: typeof raw.value === 'string' ? raw.value : label,
    ...(labels && labels.length > 0 ? { labels } : {}),
    ...(values && values.length > 0 ? { values } : {})
  }
}

export function usageFromCore(usage: CoreUsageSnapshotJson, turnId?: string): ThreadUsageSnapshot {
  const inputTokens = usage.promptTokens ?? 0
  const outputTokens = usage.completionTokens ?? 0
  const hasHitTokens = typeof usage.cacheHitTokens === 'number' && Number.isFinite(usage.cacheHitTokens)
  const hasMissTokens = typeof usage.cacheMissTokens === 'number' && Number.isFinite(usage.cacheMissTokens)
  const cachedTokens = hasHitTokens ? usage.cacheHitTokens ?? 0 : 0
  const cacheMissTokens = hasMissTokens ? usage.cacheMissTokens ?? 0 : 0
  const cacheTotal = cachedTokens + cacheMissTokens
  const cacheHitRate = typeof usage.cacheHitRate === 'number' && Number.isFinite(usage.cacheHitRate)
    ? usage.cacheHitRate
    : hasHitTokens && hasMissTokens && cacheTotal > 0
      ? cachedTokens / cacheTotal
      : null
  return {
    inputTokens,
    outputTokens,
    reasoningTokens: 0,
    cachedTokens,
    cacheMissTokens,
    cacheHitRate,
    totalTokens: usage.totalTokens ?? inputTokens + outputTokens,
    costUsd: usage.costUsd ?? 0,
    costCny: usage.costCny ?? null,
    tokenEconomySavingsTokens: usage.tokenEconomySavingsTokens ?? 0,
    turns: usage.turns ?? 0,
    avgTtftMs: nullableFinite(usage.avgTtftMs),
    avgTokensPerSecond: nullableFinite(usage.avgTokensPerSecond),
    turnAvgTtftMs: nullableFinite(usage.turnAvgTtftMs),
    turnAvgTokensPerSecond: nullableFinite(usage.turnAvgTokensPerSecond),
    ...(turnId ? { turnId } : {})
  }
}

/** Pass through a nullable metric, normalizing non-finite values to null. */
export function nullableFinite(value: number | null | undefined): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null
}

export function contextSnapshotFromCore(event: CoreRuntimeEventJson): RequestContextSnapshot | null {
  const threadId = event.threadId?.trim()
  const model = event.model?.trim()
  const contextWindowTokens = positiveInteger(event.contextWindowTokens)
  const softThresholdTokens = positiveInteger(event.softThresholdTokens)
  const hardThresholdTokens = positiveInteger(event.hardThresholdTokens)
  const estimatedInputTokens = nonnegativeInteger(event.estimatedInputTokens)
  const stepIndex = nonnegativeInteger(event.stepIndex)
  const toolCount = nonnegativeInteger(event.toolCount)
  const rawBreakdown = event.breakdown
  const tools = nonnegativeInteger(rawBreakdown?.tools)
  const system = nonnegativeInteger(rawBreakdown?.system)
  const skills = nonnegativeInteger(rawBreakdown?.skills)
  const messages = nonnegativeInteger(rawBreakdown?.messages)
  const other = nonnegativeInteger(rawBreakdown?.other)
  if (
    !threadId ||
    !model ||
    contextWindowTokens === undefined ||
    softThresholdTokens === undefined ||
    hardThresholdTokens === undefined ||
    estimatedInputTokens === undefined ||
    stepIndex === undefined ||
    toolCount === undefined ||
    tools === undefined ||
    system === undefined ||
    skills === undefined ||
    messages === undefined ||
    other === undefined
  ) {
    return null
  }
  if (tools + system + skills + messages + other !== estimatedInputTokens) return null
  return {
    threadId,
    ...(event.turnId?.trim() ? { turnId: event.turnId.trim() } : {}),
    model,
    ...(event.providerId?.trim() ? { providerId: event.providerId.trim() } : {}),
    stepIndex,
    contextWindowTokens,
    softThresholdTokens,
    hardThresholdTokens,
    estimatedInputTokens,
    breakdown: { tools, system, skills, messages, other },
    toolCount,
    activeSkillIds: Array.isArray(event.activeSkillIds)
      ? event.activeSkillIds.filter((id): id is string => typeof id === 'string' && id.trim().length > 0)
          .map((id) => id.trim())
      : [],
    ...(event.contextManagement === 'kun-managed' || event.contextManagement === 'sdk-managed'
      ? { contextManagement: event.contextManagement }
      : {}),
    ...(event.nativeHistory === 'known' ||
      event.nativeHistory === 'unknown' ||
      event.nativeHistory === 'none'
      ? { nativeHistory: event.nativeHistory }
      : {})
  }
}

export function delegatedRuntimeFromCore(event: CoreRuntimeEventJson): DelegatedRuntimeState | null {
  const threadId = event.threadId?.trim()
  const providerId = event.providerId?.trim()
  const providerKind = event.providerKind
  const phase = event.phase
  const capabilities = event.capabilities
  if (
    !threadId ||
    !providerId ||
    (
      providerKind !== 'agent-sdk' &&
      providerKind !== 'cursor-sdk' &&
      providerKind !== 'antigravity-cli'
    ) ||
    (phase !== 'portable' && phase !== 'resumed' && phase !== 'rebased') ||
    !capabilities ||
    ![
      capabilities.nativeResume,
      capabilities.structuredStreaming,
      capabilities.kunTools,
      capabilities.externalApproval,
      capabilities.liveSteering,
      capabilities.nativeContextTelemetry,
      capabilities.fork
    ].every((value) => typeof value === 'boolean')
  ) return null
  const reason = event.reason
  return {
    threadId,
    ...(event.turnId?.trim() ? { turnId: event.turnId.trim() } : {}),
    providerKind,
    providerId,
    phase,
    ...(reason === 'new' ||
      reason === 'route_changed' ||
      reason === 'capabilities_changed' ||
      reason === 'history_changed' ||
      reason === 'native_state_unavailable'
      ? { reason }
      : {}),
    capabilities: {
      nativeResume: capabilities.nativeResume!,
      structuredStreaming: capabilities.structuredStreaming!,
      kunTools: capabilities.kunTools!,
      externalApproval: capabilities.externalApproval!,
      liveSteering: capabilities.liveSteering!,
      nativeContextTelemetry: capabilities.nativeContextTelemetry!,
      fork: capabilities.fork!
    }
  }
}

export function userMessageBlockFromItem(item: CoreTurnItemJson): ChatBlock | null {
  const meta: Record<string, unknown> = {}
  applyRuntimeDisclosureMeta(meta, item)
  return {
    kind: 'user',
    id: item.id,
    turnId: item.turnId,
    createdAt: itemCreatedAt(item),
    text: item.text ?? '',
    ...(Object.keys(meta).length > 0 ? { meta } : {})
  }
}

export function userMessageEventFromItem(item: CoreTurnItemJson): UserMessageEventPayload {
  const meta: Record<string, unknown> = {}
  applyRuntimeDisclosureMeta(meta, item)
  return {
    itemId: item.id,
    turnId: item.turnId,
    createdAt: itemCreatedAt(item),
    text: item.text ?? '',
    ...(Object.keys(meta).length > 0 ? { meta } : {})
  }
}

export function assistantTextBlockFromItem(item: CoreTurnItemJson): ChatBlock | null {
  if (!item.text?.trim()) return null
  return { kind: 'assistant', id: item.id, turnId: item.turnId, createdAt: itemCreatedAt(item), text: item.text }
}

export function reasoningBlockFromItem(item: CoreTurnItemJson): ChatBlock | null {
  if (!item.text?.trim()) return null
  return {
    kind: 'reasoning',
    id: item.id,
    turnId: item.turnId,
    createdAt: itemCreatedAt(item),
    text: item.text
  }
}

export function approvalBlockFromItem(item: CoreTurnItemJson, child?: CoreChildRuntimeMetadataJson): ChatBlock {
  const meta: Record<string, unknown> = {}
  applyRuntimeDisclosureMeta(meta, item, child)
  return {
    kind: 'approval',
    id: item.id,
    turnId: item.turnId,
    createdAt: itemCreatedAt(item),
    approvalId: item.approvalId ?? item.id,
    summary: item.summary?.trim() || 'Approval required',
    toolName: item.toolName,
    status:
      item.status === 'allowed' || item.status === 'denied' || item.status === 'expired'
        ? item.status
        : item.status === 'failed'
          ? 'error'
          : 'pending',
    ...(Object.keys(meta).length > 0 ? { meta } : {})
  }
}

export function approvalStatusFromEvent(event: CoreRuntimeEventJson): ApprovalStatusPayload | null {
  const approvalId = event.approvalId ?? event.itemId ?? ''
  if (!approvalId) return null
  if (event.status !== 'allowed' && event.status !== 'denied' && event.status !== 'expired') {
    return null
  }
  return {
    approvalId,
    status: event.status,
    ...(event.status === 'expired' && event.reason?.trim()
      ? { errorMessage: redactSecretText(event.reason.trim()) }
      : {})
  }
}

export function approvalReviewFromEvent(
  event: CoreRuntimeEventJson
): ApprovalReviewEventPayload | null {
  const reviewId = event.reviewId?.trim() ?? ''
  const approvalId = event.approvalId?.trim() ?? ''
  if (!reviewId || !approvalId || event.reviewer !== 'agent') return null
  const status = event.status
  if (
    status !== 'in-progress' &&
    status !== 'approved' &&
    status !== 'denied' &&
    status !== 'timed-out' &&
    status !== 'failed-closed' &&
    status !== 'aborted'
  ) return null
  const decision =
    event.decision === 'allow' || event.decision === 'deny'
      ? event.decision
      : undefined
  const riskLevel =
    event.riskLevel === 'low' ||
    event.riskLevel === 'medium' ||
    event.riskLevel === 'high' ||
    event.riskLevel === 'critical'
      ? event.riskLevel
      : undefined
  return {
    reviewId,
    approvalId,
    turnId: event.turnId,
    createdAt: event.timestamp,
    summary: redactSecretText(event.summary?.trim() || event.toolName?.trim() || 'Tool action'),
    ...(event.toolName?.trim() ? { toolName: event.toolName.trim() } : {}),
    status,
    ...(decision ? { decision } : {}),
    ...(riskLevel ? { riskLevel } : {}),
    ...(event.rationale?.trim()
      ? { rationale: redactSecretText(event.rationale.trim()) }
      : {})
  }
}

export function userInputBlockFromItem(
  item: CoreTurnItemJson
): Extract<ChatBlock, { kind: 'user_input' }> {
  const answers = userInputAnswersFromCore(item.answers)
  return {
    kind: 'user_input',
    id: item.id,
    turnId: item.turnId,
    createdAt: itemCreatedAt(item),
    requestId: item.inputId ?? item.id,
    questions: userInputQuestionsFromItem(item),
    ...(answers ? { answers } : {}),
    ...(item.timeoutSeconds !== undefined ? { timeoutSeconds: item.timeoutSeconds } : {}),
    status:
      item.status === 'failed'
        ? 'error'
        : item.status === 'timeout'
          ? 'timeout'
          : item.status === 'submitted' || item.status === 'completed'
            ? 'submitted'
            : item.status === 'cancelled' || item.status === 'aborted'
              ? 'cancelled'
          : 'pending'
  }
}

export function userInputRequestFromCore(input: {
  itemId?: string
  inputId?: string
  turnId?: string
  createdAt?: string
  prompt?: string
  questions?: CoreTurnItemJson['questions'] | CoreRuntimeEventJson['questions']
  timeoutSeconds?: number
  seq?: number
}): UserInputRequestPayload {
  const fallbackId = input.inputId ?? input.itemId ?? `input_${input.seq ?? Date.now()}`
  return {
    itemId: input.itemId ?? fallbackId,
    ...(input.turnId ? { turnId: input.turnId } : {}),
    ...(input.createdAt ? { createdAt: input.createdAt } : {}),
    requestId: input.inputId ?? fallbackId,
    questions: questionsFromCore(input.questions, input.prompt, input.inputId ?? fallbackId),
    ...(input.timeoutSeconds !== undefined ? { timeoutSeconds: input.timeoutSeconds } : {})
  }
}

export function compactionBlockFromItem(item: CoreTurnItemJson): ChatBlock {
  return {
    kind: 'compaction',
    id: item.id,
    turnId: item.turnId,
    createdAt: itemCreatedAt(item),
    summary: item.summary?.trim() || 'Context compacted',
    status: item.status === 'failed' ? 'error' : 'success',
    messagesBefore: item.replacedTokens,
    detail: item.pinnedConstraints?.join('\n'),
    auto: item.auto ?? true
  }
}

export function reviewStatus(item: CoreTurnItemJson): ReviewEventPayload['status'] {
  if (item.status === 'pending' || item.status === 'running') return 'running'
  if (item.status === 'failed' || item.status === 'aborted') return 'error'
  return 'success'
}

export function reviewTargetFromCore(target: CoreReviewTargetJson | undefined): ReviewTarget | undefined {
  if (!target || typeof target.kind !== 'string') return undefined
  switch (target.kind) {
    case 'uncommittedChanges':
      return { kind: 'uncommittedChanges' }
    case 'baseBranch':
      return target.branch?.trim() ? { kind: 'baseBranch', branch: target.branch } : undefined
    case 'commit':
      return target.sha?.trim() ? { kind: 'commit', sha: target.sha } : undefined
    case 'custom':
      return target.instructions?.trim()
        ? { kind: 'custom', instructions: target.instructions }
        : undefined
    default:
      return undefined
  }
}

export function reviewOutputFromCore(output: unknown): ReviewOutput | undefined {
  if (!isCoreReviewOutput(output)) return undefined
  return {
    findings: (output.findings ?? []).map((finding) => ({
      title: finding.title,
      body: finding.body,
      confidenceScore: finding.confidenceScore,
      priority: finding.priority,
      codeLocation: {
        absoluteFilePath: finding.codeLocation.absoluteFilePath,
        lineRange: {
          start: finding.codeLocation.lineRange.start,
          end: finding.codeLocation.lineRange.end
        }
      }
    })),
    overallCorrectness: output.overallCorrectness,
    overallExplanation: output.overallExplanation,
    overallConfidenceScore: output.overallConfidenceScore
  }
}

export function isCoreReviewOutput(value: unknown): value is CoreReviewOutputJson {
  if (!value || typeof value !== 'object') return false
  const raw = value as Partial<CoreReviewOutputJson>
  return (
    Array.isArray(raw.findings) &&
    (raw.overallCorrectness === 'patch is correct' || raw.overallCorrectness === 'patch is incorrect') &&
    typeof raw.overallExplanation === 'string' &&
    typeof raw.overallConfidenceScore === 'number'
  )
}

export function reviewBlockFromItem(item: CoreTurnItemJson): ReviewBlock {
  return {
    kind: 'review',
    id: item.id,
    turnId: item.turnId,
    createdAt: itemCreatedAt(item),
    title: item.title?.trim() || 'Code review',
    status: reviewStatus(item),
    target: reviewTargetFromCore(item.target),
    reviewText: item.reviewText,
    output: reviewOutputFromCore(item.output)
  }
}

export function errorSeverity(
  explicit: CoreTurnItemJson['severity'] | CoreRuntimeEventJson['severity'],
  code?: string
): 'info' | 'warning' | 'error' {
  if (explicit === 'info' || explicit === 'warning' || explicit === 'error') return explicit
  if (code === 'budget_warning' || code === 'compaction_summary_fallback') return 'warning'
  if (code === 'tool_catalog_changed' || code === 'tool_storm_suppressed') return 'info'
  return 'error'
}

export function runtimeErrorDetail(message: string, code?: string, details?: unknown): string | undefined {
  const parts: string[] = []
  if (code) parts.push(`Code: ${code}`)
  if (message.trim()) parts.push(`Message:\n${redactSecretText(message)}`)
  if (details !== undefined) {
    try {
      parts.push(`Details:\n${JSON.stringify(redactSecrets(details), null, 2)}`)
    } catch {
      parts.push(`Details:\n${redactSecretText(String(details))}`)
    }
  }
  return parts.length > 0 ? parts.join('\n\n') : undefined
}

export function systemErrorBlockFromItem(item: CoreTurnItemJson): ChatBlock {
  const message = item.message ?? 'Runtime error'
  const detail = runtimeErrorDetail(message, item.code, item.details)
  return {
    kind: 'system',
    id: item.id,
    turnId: item.turnId,
    createdAt: itemCreatedAt(item),
    text: redactSecretText(message),
    ...(item.code ? { code: item.code } : {}),
    ...(detail ? { detail } : {}),
    severity: errorSeverity(item.severity, item.code),
    runtimeError: true
  }
}

export function runtimeErrorFromItem(item: CoreTurnItemJson): RuntimeErrorEventPayload {
  const message = item.message ?? 'Runtime error'
  return {
    itemId: item.id,
    turnId: item.turnId,
    createdAt: itemCreatedAt(item),
    message: redactSecretText(message),
    ...(item.code ? { code: item.code } : {}),
    ...(item.details !== undefined ? { details: item.details } : {}),
    severity: errorSeverity(item.severity, item.code)
  }
}

export function runtimeErrorFromEvent(
  event: CoreRuntimeEventJson,
  fallback: string
): RuntimeErrorEventPayload {
  const message = event.message ?? fallback
  const itemId = event.itemId ?? `runtime_error_${event.turnId ?? event.threadId ?? event.seq ?? Date.now()}`
  return {
    itemId,
    ...(event.turnId ? { turnId: event.turnId } : {}),
    createdAt: event.timestamp,
    message: redactSecretText(message),
    ...(event.code ? { code: event.code } : {}),
    ...(event.details !== undefined ? { details: event.details } : {}),
    severity: errorSeverity(event.severity, event.code)
  }
}

export function errorForRuntimeEvent(payload: RuntimeErrorEventPayload): Error {
  return new Error(JSON.stringify({
    ...(payload.code ? { code: payload.code } : {}),
    message: payload.message,
    ...(payload.details !== undefined ? { details: payload.details } : {}),
    ...(payload.severity ? { severity: payload.severity } : {})
  }))
}
