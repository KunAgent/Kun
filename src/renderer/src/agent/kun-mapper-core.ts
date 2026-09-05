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
import { cloneDesignDocumentTarget, cloneDesignTaskProfile } from './design-task-profile'

export function threadFromCore(thread: CoreThreadSummaryJson): NormalizedThread {
  return {
    id: thread.id,
    title: thread.title?.trim() || thread.id.slice(0, 8),
    ...(thread.agentSurface ? { agentSurface: thread.agentSurface } : {}),
    ...(thread.lockedTaskSurface ? { lockedTaskSurface: thread.lockedTaskSurface } : {}),
    ...(thread.designProfile
      ? { designProfile: cloneDesignTaskProfile(thread.designProfile) }
      : {}),
    ...(thread.designCloneOperation
      ? { designCloneOperation: { ...thread.designCloneOperation } }
      : {}),
    ...(thread.titleAuto !== undefined ? { titleAuto: thread.titleAuto } : {}),
    ...(thread.summary?.trim() ? { summary: thread.summary.trim() } : {}),
    updatedAt: thread.updatedAt,
    model: thread.model,
    mode: thread.mode,
    workspace: thread.workspace,
    knowledgeBases: thread.knowledgeBases?.map((mount) => ({ ...mount })),
    status: thread.status,
    ...(typeof thread.latestSeq === 'number' ? { latestSeq: thread.latestSeq } : {}),
    approvalPolicy: normalizeApprovalPolicy(thread.approvalPolicy),
    sandboxMode: normalizeSandboxMode(thread.sandboxMode),
    approvalReviewer: normalizeApprovalReviewer(thread.approvalReviewer),
    modelRequestCaptureEnabled: thread.modelRequestCaptureEnabled === true,
    archived: thread.status === 'archived',
    pinned: thread.pinned === true,
    ...(thread.providerId ? { providerId: thread.providerId } : {}),
    ...(thread.agentId ? { agentId: thread.agentId } : {}),
    ...(thread.systemPrompt ? { systemPrompt: thread.systemPrompt } : {}),
    relation: thread.relation,
    parentThreadId: thread.parentThreadId,
    planBuildRunId: thread.planBuildRunId,
    forkedFromThreadId: thread.forkedFromThreadId,
    forkedFromTitle: thread.forkedFromTitle,
    forkedAt: thread.forkedAt,
    forkedFromMessageCount: thread.forkedFromMessageCount,
    forkedFromTurnCount: thread.forkedFromTurnCount,
    goal: thread.goal ? goalFromCore(thread.goal) : null,
    todos: thread.todos ? todosFromCore(thread.todos) : null
  }
}

export function normalizeApprovalPolicy(value: string | undefined): NormalizedThread['approvalPolicy'] {
  switch (value) {
    case 'always':
    case 'auto':
    case 'on-request':
    case 'untrusted':
    case 'suggest':
    case 'never':
      return value
    default:
      return undefined
  }
}

export function normalizeSandboxMode(value: string | undefined): NormalizedThread['sandboxMode'] {
  switch (value) {
    case 'read-only':
    case 'workspace-write':
    case 'danger-full-access':
    case 'external-sandbox':
      return value
    default:
      return undefined
  }
}

export function normalizeApprovalReviewer(
  value: string | undefined
): NormalizedThread['approvalReviewer'] {
  return value === 'agent' ? 'agent' : 'user'
}

export function goalFromCore(goal: CoreThreadGoalJson): ThreadGoal {
  return {
    threadId: goal.threadId,
    objective: goal.objective,
    status: goal.status,
    tokenBudget: goal.tokenBudget ?? null,
    tokensUsed: goal.tokensUsed ?? 0,
    timeUsedSeconds: goal.timeUsedSeconds ?? 0,
    createdAt: goal.createdAt,
    updatedAt: goal.updatedAt
  }
}

export function todosFromCore(todos: CoreThreadTodoListJson): ThreadTodoList {
  return {
    threadId: todos.threadId,
    items: (todos.items ?? []).map((item) => ({
      id: item.id,
      content: item.content,
      status: item.status,
      ...(item.source ? { source: { ...item.source } } : {}),
      createdAt: item.createdAt,
      updatedAt: item.updatedAt
    })),
    updatedAt: todos.updatedAt
  }
}

export function itemCreatedAt(item: CoreTurnItemJson): string | undefined {
  return item.createdAt || item.finishedAt
}

export function toolStatus(item: CoreTurnItemJson): ToolBlock['status'] {
  if (item.isError || item.status === 'failed' || item.status === 'aborted') return 'error'
  if (item.status === 'pending' || item.status === 'running') return 'running'
  return 'success'
}

export function outputText(value: unknown): string {
  if (typeof value === 'string') return value
  if (value == null) return ''
  try {
    return JSON.stringify(value, null, 2)
  } catch {
    return String(value)
  }
}

export function toolBlockId(item: CoreTurnItemJson): string {
  return item.callId?.trim() ? `tool_${item.callId}` : item.id
}

export function stringArray(value: unknown): string[] | undefined {
  if (!Array.isArray(value)) return undefined
  const strings = value.filter((entry): entry is string => typeof entry === 'string' && entry.trim().length > 0)
  return strings.length > 0 ? strings : undefined
}

export function readStructuredString(record: Record<string, unknown>, ...keys: string[]): string | undefined {
  for (const key of keys) {
    const value = record[key]
    if (typeof value === 'string' && value.trim()) return value.trim()
  }
  return undefined
}

export const FILE_PATH_KEYS = [
  'absolute_path',
  'output_path',
  'outputPath',
  'destination_path',
  'destinationPath',
  'path',
  'file_path',
  'file',
  'relative_path',
  'target_path',
  'targetPath'
] as const

export const COMMAND_KEYS = ['command', 'cmd', 'script'] as const
export const COMMAND_RESULT_META_KEYS = [
  'exit_code',
  'session_id',
  'status',
  'pid',
  'shell',
  'cwd',
  'started_at',
  'finished_at',
  'partial',
  'stop_sent'
] as const

export const TOOL_KIND_BY_NAME: ReadonlyMap<string, ToolBlock['toolKind']> = new Map([
  ['shell', 'command_execution'],
  ['bash', 'command_execution'],
  ['terminal', 'command_execution'],
  ['run_command', 'command_execution'],
  ['exec', 'command_execution'],
  ['read', 'tool_call'],
  ['write', 'file_change'],
  ['edit', 'file_change'],
  ['grep', 'tool_call'],
  ['find', 'tool_call'],
  ['ls', 'tool_call'],
  ['write_file', 'file_change'],
  ['read_file', 'file_change'],
  ['edit_file', 'file_change'],
  ['apply_patch', 'file_change'],
  ['create_file', 'file_change'],
  ['create_plan', 'file_change'],
  ['office_edit', 'file_change']
])

export function payloadFor(item: CoreTurnItemJson): Record<string, unknown> {
  if (item.kind === 'tool_result') {
    return item.output && typeof item.output === 'object'
      ? (item.output as Record<string, unknown>)
      : {}
  }
  return (item.arguments ?? {}) as Record<string, unknown>
}

export function structuredPayloadsFor(item: CoreTurnItemJson): Record<string, unknown>[] {
  const payloads: Record<string, unknown>[] = []
  const seen = new Set<Record<string, unknown>>()
  const visit = (value: unknown, depth: number): void => {
    if (!value || typeof value !== 'object' || Array.isArray(value)) return
    const record = value as Record<string, unknown>
    if (seen.has(record)) return
    seen.add(record)
    payloads.push(record)
    if (depth >= 2) return
    visit(record.result, depth + 1)
    visit(record.content, depth + 1)
  }
  visit(payloadFor(item), 0)
  return payloads
}

export const PRESENTATION_STUDIO_WRITE_TOOL_IDS = new Set(
  PRESENTATION_STUDIO_WRITE_TOOL_NAMES.map(presentationStudioCanonicalToolId)
)
export const PRESENTATION_STUDIO_DIRECT_TOOL_IDS = new Map(
  PRESENTATION_STUDIO_WRITE_TOOL_NAMES.map((name) => [
    presentationStudioModelAlias(name),
    presentationStudioCanonicalToolId(name)
  ])
)

export function gatewayPayloadFor(item: CoreTurnItemJson): Record<string, unknown> | null {
  if (item.kind !== 'tool_result' || item.toolName !== 'extension_tool_call') return null
  return payloadFor(item)
}

export function presentationStudioWriteToolId(item: CoreTurnItemJson): string | undefined {
  const direct = item.toolName ? PRESENTATION_STUDIO_DIRECT_TOOL_IDS.get(item.toolName) : undefined
  if (direct) return direct
  const canonicalToolId = gatewayPayloadFor(item)?.canonicalToolId
  return typeof canonicalToolId === 'string' && PRESENTATION_STUDIO_WRITE_TOOL_IDS.has(canonicalToolId)
    ? canonicalToolId
    : undefined
}

export function gatewayHasWorkspaceWriteSideEffect(item: CoreTurnItemJson): boolean {
  return gatewayPayloadFor(item)?.sideEffect === 'workspace-write'
}

export function readItemStructuredString(
  item: CoreTurnItemJson,
  ...keys: readonly string[]
): string | undefined {
  for (const payload of structuredPayloadsFor(item)) {
    const value = readStructuredString(payload, ...keys)
    if (value) return value
  }
  return undefined
}

export function normalizeChildMetadata(
  child: CoreChildRuntimeMetadataJson | undefined
): RuntimeChildMetadata | undefined {
  if (!child?.childId || !child.parentThreadId || !child.parentTurnId) return undefined
  const activity = child.activity
  const normalizedActivity = activity &&
    ['starting', 'thinking', 'responding', 'tool', 'retrying', 'compacting', 'waiting']
      .includes(activity.phase) &&
    activity.label?.trim() &&
    activity.startedAt &&
    activity.updatedAt
    ? {
        phase: activity.phase,
        label: activity.label.trim().slice(0, 500),
        ...(activity.toolName?.trim()
          ? { toolName: activity.toolName.trim().slice(0, 256) }
          : {}),
        startedAt: activity.startedAt,
        updatedAt: activity.updatedAt
      }
    : undefined
  return {
    parentThreadId: child.parentThreadId,
    parentTurnId: child.parentTurnId,
    childId: child.childId,
    ...(child.childLabel ? { childLabel: child.childLabel } : {}),
    ...(child.childProfile ? { childProfile: child.childProfile } : {}),
    ...(child.childProfileName ? { childProfileName: child.childProfileName } : {}),
    ...(child.childModel ? { childModel: child.childModel } : {}),
    ...(child.childProviderId ? { childProviderId: child.childProviderId } : {}),
    ...(child.childToolPolicy ? { childToolPolicy: child.childToolPolicy } : {}),
    childStatus: child.childStatus,
    childSeq: child.childSeq,
    ...(child.childLauncher ? { childLauncher: child.childLauncher } : {}),
    ...(child.childTerminationReason ? { childTerminationReason: child.childTerminationReason } : {}),
    ...(child.resumable !== undefined ? { resumable: child.resumable } : {}),
    ...(child.resumeCount !== undefined ? { resumeCount: child.resumeCount } : {}),
    ...(child.detached !== undefined ? { detached: child.detached } : {}),
    ...(child.prefixReused !== undefined ? { prefixReused: child.prefixReused } : {}),
    ...(child.inheritedHistoryItems !== undefined ? { inheritedHistoryItems: child.inheritedHistoryItems } : {}),
    ...(child.toolInvocations !== undefined ? { toolInvocations: child.toolInvocations } : {}),
    ...(child.attemptStartedAt ? { attemptStartedAt: child.attemptStartedAt } : {}),
    ...(child.attemptDurationMs !== undefined ? { attemptDurationMs: child.attemptDurationMs } : {}),
    ...(child.durationMs !== undefined ? { durationMs: child.durationMs } : {}),
    ...(child.queuedMs !== undefined ? { queuedMs: child.queuedMs } : {}),
    ...(child.summaryTruncated !== undefined
      ? { summaryTruncated: child.summaryTruncated }
      : {}),
    ...(child.resultRef ? { resultRef: child.resultRef } : {}),
    ...(child.resultUnavailableReason
      ? { resultUnavailableReason: child.resultUnavailableReason }
      : {}),
    ...(child.totalTokens !== undefined ? { totalTokens: child.totalTokens } : {}),
    ...(child.cacheHitRate !== undefined ? { cacheHitRate: child.cacheHitRate } : {}),
    ...(child.costUsd !== undefined ? { costUsd: child.costUsd } : {}),
    ...(child.costCny !== undefined ? { costCny: child.costCny } : {}),
    ...(normalizedActivity ? { activity: normalizedActivity } : {})
  }
}

export function normalizeWebSources(value: unknown): Array<Record<string, string>> | undefined {
  if (!Array.isArray(value)) return undefined
  const sources = value
    .map((source) => {
      if (!source || typeof source !== 'object') return null
      const raw = source as Record<string, unknown>
      const normalized: Record<string, string> = {}
      for (const key of ['sourceId', 'url', 'title', 'retrievedAt'] as const) {
        const entry = raw[key]
        if (typeof entry === 'string' && entry.trim()) normalized[key] = entry.trim()
      }
      return Object.keys(normalized).length > 0 ? normalized : null
    })
    .filter((source): source is Record<string, string> => source !== null)
  return sources.length > 0 ? sources : undefined
}

export function normalizeUserFileReferences(value: unknown): Array<{
  path: string
  relativePath: string
  name: string
  kind?: 'file' | 'directory'
}> | undefined {
  if (!Array.isArray(value)) return undefined
  const references = value
    .map((entry) => {
      if (!entry || typeof entry !== 'object') return null
      const raw = entry as Record<string, unknown>
      const path = typeof raw.path === 'string' && raw.path.trim() ? raw.path.trim() : ''
      const relativePath =
        typeof raw.relativePath === 'string' && raw.relativePath.trim() ? raw.relativePath.trim() : ''
      const name = typeof raw.name === 'string' && raw.name.trim() ? raw.name.trim() : ''
      const kind = raw.kind === 'directory' ? 'directory' : 'file'
      if (!path || !relativePath || !name) return null
      return { path, relativePath, name, kind }
    })
    .filter((entry): entry is { path: string; relativePath: string; name: string; kind: 'file' | 'directory' } =>
      entry !== null
    )
  return references.length > 0 ? references : undefined
}

export function normalizeInjectedMemorySummaries(
  value: unknown
): Array<{ id: string; content: string }> | undefined {
  if (!Array.isArray(value)) return undefined
  const summaries = value
    .map((entry) => {
      if (!entry || typeof entry !== 'object') return null
      const raw = entry as Record<string, unknown>
      const id = typeof raw.id === 'string' && raw.id.trim() ? raw.id.trim() : ''
      const content = typeof raw.content === 'string' && raw.content.trim() ? raw.content.trim() : ''
      return id && content ? { id, content } : null
    })
    .filter((entry): entry is { id: string; content: string } => entry !== null)
  return summaries.length > 0 ? summaries : undefined
}

export function normalizeComposerContexts(value: unknown): ComposerContextAttachment[] | undefined {
  if (!Array.isArray(value)) return undefined
  const contexts = value
    .slice(0, MAX_COMPOSER_CONTEXT_ATTACHMENTS)
    .map((entry) => ComposerContextAttachmentSchema.safeParse(entry))
    .filter((entry) => entry.success)
    .map((entry) => entry.data)
  return contexts.length > 0 ? contexts : undefined
}

export function applyRuntimeDisclosureMeta(
  meta: Record<string, unknown>,
  item: CoreTurnItemJson,
  child?: CoreChildRuntimeMetadataJson
): void {
  if (item.turnId) meta.turnId = item.turnId
  if (typeof item.workspaceCheckpointId === 'string' && item.workspaceCheckpointId.trim()) {
    meta.workspaceCheckpointId = item.workspaceCheckpointId.trim()
  }
  const attachmentIds = stringArray(item.attachmentIds)
  const activeSkillIds = stringArray(item.activeSkillIds)
  const injectedMemoryIds = stringArray(item.injectedMemoryIds)
  const injectedMemorySummaries = normalizeInjectedMemorySummaries(item.injectedMemorySummaries)
  const injectedInstructionSources = normalizeInjectedInstructionSources(item.injectedInstructionSources)
  const fileReferences = normalizeUserFileReferences(item.fileReferences)
  const composerContexts = normalizeComposerContexts(item.composerContexts)
  const normalizedChild = normalizeChildMetadata(child)
  const displayText = typeof item.displayText === 'string' ? item.displayText.trim() : ''
  if (displayText && displayText !== item.text?.trim()) {
    meta.displayText = displayText
  }
  if (item.role === 'user' && (item.mode === 'agent' || item.mode === 'plan')) {
    meta.mode = item.mode
  }
  if (item.role === 'user' && item.guiDesignCanvas === true) meta.guiDesignCanvas = true
  if (item.role === 'user' && item.guiDesignMode === true) meta.guiDesignMode = true
  if (item.role === 'user' && item.agentSurface) meta.agentSurface = item.agentSurface
  if (item.role === 'user' && item.designProfile) {
    meta.designProfile = cloneDesignTaskProfile(item.designProfile)
  }
  if (item.role === 'user' && item.designDocumentTarget) {
    meta.designDocumentTarget = cloneDesignDocumentTarget(item.designDocumentTarget)
  }
  if (item.role === 'user' && item.designImagePlacementTarget) {
    meta.designImagePlacementTarget = { ...item.designImagePlacementTarget }
  }
  applyClientUserMessageSourceMeta(meta, item.text ?? '')
  if (
    item.messageSource === 'background_shell' ||
    item.messageSource === 'background_subagent' ||
    item.messageSource === 'graph_runtime' ||
    item.messageSource === 'subagent_resume' ||
    item.messageSource === 'design_continuation'
  ) {
    meta.messageSource = item.messageSource
  }
  if (attachmentIds) meta.attachmentIds = attachmentIds
  if (fileReferences) meta.fileReferences = fileReferences
  if (composerContexts) meta.composerContexts = composerContexts
  if (activeSkillIds) meta.activeSkillIds = activeSkillIds
  if (injectedMemoryIds) meta.injectedMemoryIds = injectedMemoryIds
  if (injectedMemorySummaries) meta.injectedMemorySummaries = injectedMemorySummaries
  if (injectedInstructionSources) meta.injectedInstructionSources = injectedInstructionSources
  if (typeof item.skillInjectionBytes === 'number') {
    meta.skillInjectionBytes = item.skillInjectionBytes
  }
  if (typeof item.instructionInjectionBytes === 'number') {
    meta.instructionInjectionBytes = item.instructionInjectionBytes
  }
  if (normalizedChild) meta.child = normalizedChild
}

export function normalizeInjectedInstructionSources(
  value: unknown
): Array<{ scope: 'global' | 'workspace'; path: string; bytes: number; truncated?: boolean }> | undefined {
  if (!Array.isArray(value)) return undefined
  const sources = value
    .map((raw) => {
      if (!raw || typeof raw !== 'object') return null
      const entry = raw as Record<string, unknown>
      const scope = entry.scope === 'global' || entry.scope === 'workspace' ? entry.scope : null
      const path = typeof entry.path === 'string' && entry.path.trim() ? entry.path.trim() : ''
      const bytes = typeof entry.bytes === 'number' && Number.isFinite(entry.bytes)
        ? Math.max(0, Math.trunc(entry.bytes))
        : 0
      if (!scope || !path) return null
      return {
        scope,
        path,
        bytes,
        ...(entry.truncated === true ? { truncated: true } : {})
      }
    })
    .filter((entry): entry is { scope: 'global' | 'workspace'; path: string; bytes: number; truncated?: boolean } => entry !== null)
  return sources.length > 0 ? sources : undefined
}

export function extractToolSources(item: CoreTurnItemJson): Array<Record<string, string>> | undefined {
  const payload = payloadFor(item)
  return normalizeWebSources(payload.sources) ?? normalizeWebSources(payload.citations)
}

export type ToolAttachmentReference = {
  id: string
  name?: string
  mimeType?: string
  byteSize?: number
  width?: number
  height?: number
  previewUrl?: string
}

export function extractToolAttachments(item: CoreTurnItemJson): ToolAttachmentReference[] | undefined {
  if (item.kind !== 'tool_result') return undefined
  const payload = payloadFor(item)
  if (!Array.isArray(payload.attachments)) return undefined
  const attachments = payload.attachments
    .map((entry): ToolAttachmentReference | null => {
      if (!entry || typeof entry !== 'object') return null
      const raw = entry as Record<string, unknown>
      const id = typeof raw.id === 'string' && raw.id.trim() ? raw.id.trim() : ''
      if (!id) return null
      return {
        id,
        ...(typeof raw.name === 'string' && raw.name.trim() ? { name: raw.name.trim() } : {}),
        ...(typeof raw.mimeType === 'string' && raw.mimeType.trim() ? { mimeType: raw.mimeType.trim() } : {}),
        ...(typeof raw.byteSize === 'number' && Number.isFinite(raw.byteSize) ? { byteSize: raw.byteSize } : {}),
        ...(typeof raw.width === 'number' && Number.isFinite(raw.width) ? { width: raw.width } : {}),
        ...(typeof raw.height === 'number' && Number.isFinite(raw.height) ? { height: raw.height } : {}),
        ...(typeof raw.previewUrl === 'string' && raw.previewUrl.trim() ? { previewUrl: raw.previewUrl.trim() } : {}),
        ...(typeof raw.dataUrl === 'string' && raw.dataUrl.trim() ? { previewUrl: raw.dataUrl.trim() } : {})
      }
    })
    .filter((entry): entry is ToolAttachmentReference => entry !== null)
  return attachments.length > 0 ? attachments : undefined
}

export function readGeneratedFileString(raw: Record<string, unknown>, ...keys: string[]): string | undefined {
  for (const key of keys) {
    const value = raw[key]
    if (typeof value === 'string' && value.trim()) return value.trim()
  }
  return undefined
}

export function normalizeGeneratedFileReference(entry: unknown): GeneratedFileReference | null {
  if (!entry || typeof entry !== 'object') return null
  const raw = entry as Record<string, unknown>
  const artifactId = readGeneratedFileString(raw, 'artifactId')
  const mediaHandleId = readGeneratedFileString(raw, 'mediaHandleId')
  const id = readGeneratedFileString(raw, 'id', 'attachmentId', 'artifactId')
  const name = readGeneratedFileString(raw, 'name', 'fileName', 'filename', 'displayName')
  const mimeType = readGeneratedFileString(raw, 'mimeType', 'type', 'mediaType')
  const previewUrl = readGeneratedFileString(raw, 'previewUrl', 'dataUrl', 'url')
  const path = readGeneratedFileString(raw, 'path', 'file')
  const relativePath = readGeneratedFileString(raw, 'relativePath', 'relative_path')
  const absolutePath = readGeneratedFileString(raw, 'absolutePath', 'absolute_path')
  const byteSize = raw.byteSize
  const width = raw.width
  const height = raw.height
  const durationMicros = raw.durationMicros
  const availability = raw.availability === 'available' || raw.availability === 'unavailable'
    ? raw.availability
    : undefined
  const mediaKind = raw.mediaKind === 'video' || raw.mediaKind === 'audio' ||
    raw.mediaKind === 'image' || raw.mediaKind === 'subtitle' ||
    raw.mediaKind === 'document' || raw.mediaKind === 'data' || raw.mediaKind === 'other'
    ? raw.mediaKind
    : undefined
  const completionIdentity = readGeneratedFileString(raw, 'completionIdentity')
  const ownerExtensionId = readGeneratedFileString(raw, 'ownerExtensionId')
  const ownerExtensionVersion = readGeneratedFileString(raw, 'ownerExtensionVersion')
  const workspaceId = readGeneratedFileString(raw, 'workspaceId')
  const rawProvenance = raw.provenance && typeof raw.provenance === 'object' && !Array.isArray(raw.provenance)
    ? raw.provenance as Record<string, unknown>
    : undefined
  const provenanceOperation = rawProvenance
    ? readGeneratedFileString(rawProvenance, 'operation')
    : undefined
  const provenanceJobId = rawProvenance
    ? readGeneratedFileString(rawProvenance, 'jobId')
    : undefined
  const provenanceInvocationId = rawProvenance
    ? readGeneratedFileString(rawProvenance, 'invocationId')
    : undefined
  const provenance = rawProvenance && provenanceOperation
    ? {
        ...(provenanceJobId ? { jobId: provenanceJobId } : {}),
        ...(provenanceInvocationId ? { invocationId: provenanceInvocationId } : {}),
        operation: provenanceOperation
      }
    : undefined
  const normalized: GeneratedFileReference = {
    ...(id ? { id } : {}),
    ...(artifactId ? { artifactId } : {}),
    ...(mediaHandleId ? { mediaHandleId } : {}),
    ...(availability ? { availability } : {}),
    ...(name ? { name } : {}),
    ...(mimeType ? { mimeType } : {}),
    ...(typeof byteSize === 'number' && Number.isFinite(byteSize) ? { byteSize } : {}),
    ...(typeof width === 'number' && Number.isFinite(width) ? { width } : {}),
    ...(typeof height === 'number' && Number.isFinite(height) ? { height } : {}),
    ...(typeof durationMicros === 'number' && Number.isFinite(durationMicros) ? { durationMicros } : {}),
    ...(mediaKind ? { mediaKind } : {}),
    ...(completionIdentity ? { completionIdentity } : {}),
    ...(ownerExtensionId ? { ownerExtensionId } : {}),
    ...(ownerExtensionVersion ? { ownerExtensionVersion } : {}),
    ...(workspaceId ? { workspaceId } : {}),
    ...(provenance ? { provenance } : {}),
    ...(previewUrl ? { previewUrl } : {}),
    ...(path ? { path } : {}),
    ...(relativePath ? { relativePath } : {}),
    ...(absolutePath ? { absolutePath } : {})
  }
  return Object.keys(normalized).length > 0 ? normalized : null
}

export const GENERATED_FILE_TOOL_NAMES = new Set([
  'generate_image',
  'generate_speech',
  'generate_music',
  'generate_video'
])

export function isGeneratedFileToolName(toolName: string | undefined): boolean {
  const name = toolName?.trim()
  if (!name) return false
  if (GENERATED_FILE_TOOL_NAMES.has(name)) return true
  const bridgedName = name.split('__').at(-1)
  return Boolean(bridgedName && GENERATED_FILE_TOOL_NAMES.has(bridgedName))
}

export function extractToolGeneratedFiles(item: CoreTurnItemJson): GeneratedFileReference[] | undefined {
  if (item.kind !== 'tool_result') return undefined
  const payloads = structuredPayloadsFor(item)
  const candidates = [
    ...payloads.flatMap((payload) =>
      Array.isArray(payload.generatedFiles) ? payload.generatedFiles : []
    ),
    ...payloads.flatMap((payload) =>
      Array.isArray(payload.generatedArtifacts) ? payload.generatedArtifacts : []
    ),
    ...(isGeneratedFileToolName(item.toolName)
      ? payloads.flatMap((payload) => Array.isArray(payload.files) ? payload.files : [])
      : [])
  ]
  const generatedFiles: GeneratedFileReference[] = []
  const seen = new Set<string>()
  for (const candidate of candidates) {
    const normalized = normalizeGeneratedFileReference(candidate)
    if (!normalized) continue
    const key =
      normalized.artifactId ??
      normalized.id ??
      normalized.absolutePath ??
      normalized.relativePath ??
      normalized.path ??
      normalized.previewUrl ??
      normalized.name
    if (key && seen.has(key)) continue
    if (key) seen.add(key)
    generatedFiles.push(normalized)
  }
  return generatedFiles.length > 0 ? generatedFiles : undefined
}
