import type {
  ApprovalStatusPayload,
  ChatBlock,
  CompactionEventPayload,
  ComponentPrototypeMetadata,
  GeneratedFileReference,
  NormalizedThread,
  ReviewBlock,
  ReviewEventPayload,
  ReviewOutput,
  ReviewTarget,
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

export function buildQuery(options: Record<string, string | number | boolean | undefined>): string {
  const params = new URLSearchParams()
  for (const [key, value] of Object.entries(options)) {
    if (value == null) continue
    if (typeof value === 'string' && !value.trim()) continue
    params.set(key, String(value))
  }
  const query = params.toString()
  return query ? `?${query}` : ''
}

export function threadFromCore(thread: CoreThreadSummaryJson): NormalizedThread {
  return {
    id: thread.id,
    title: thread.title?.trim() || thread.id.slice(0, 8),
    ...(thread.titleAuto !== undefined ? { titleAuto: thread.titleAuto } : {}),
    ...(thread.summary?.trim() ? { summary: thread.summary.trim() } : {}),
    updatedAt: thread.updatedAt,
    model: thread.model,
    mode: thread.mode,
    workspace: thread.workspace,
    status: thread.status,
    approvalPolicy: normalizeApprovalPolicy(thread.approvalPolicy),
    sandboxMode: normalizeSandboxMode(thread.sandboxMode),
    archived: thread.status === 'archived',
    pinned: thread.pinned === true,
    ...(thread.providerId ? { providerId: thread.providerId } : {}),
    ...(thread.agentId ? { agentId: thread.agentId } : {}),
    ...(thread.systemPrompt ? { systemPrompt: thread.systemPrompt } : {}),
    relation: thread.relation,
    parentThreadId: thread.parentThreadId,
    forkedFromThreadId: thread.forkedFromThreadId,
    forkedFromTitle: thread.forkedFromTitle,
    forkedAt: thread.forkedAt,
    forkedFromMessageCount: thread.forkedFromMessageCount,
    forkedFromTurnCount: thread.forkedFromTurnCount,
    goal: thread.goal ? goalFromCore(thread.goal) : null,
    todos: thread.todos ? todosFromCore(thread.todos) : null
  }
}

function normalizeApprovalPolicy(value: string | undefined): NormalizedThread['approvalPolicy'] {
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

function normalizeSandboxMode(value: string | undefined): NormalizedThread['sandboxMode'] {
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

function itemCreatedAt(item: CoreTurnItemJson): string | undefined {
  return item.createdAt || item.finishedAt
}

function toolStatus(item: CoreTurnItemJson): ToolBlock['status'] {
  if (item.isError || item.status === 'failed' || item.status === 'aborted') return 'error'
  if (item.status === 'pending' || item.status === 'running') return 'running'
  return 'success'
}

function outputText(value: unknown): string {
  if (typeof value === 'string') return value
  if (value == null) return ''
  try {
    return JSON.stringify(value, null, 2)
  } catch {
    return String(value)
  }
}

function toolBlockId(item: CoreTurnItemJson): string {
  return item.callId?.trim() ? `tool_${item.callId}` : item.id
}

function stringArray(value: unknown): string[] | undefined {
  if (!Array.isArray(value)) return undefined
  const strings = value.filter((entry): entry is string => typeof entry === 'string' && entry.trim().length > 0)
  return strings.length > 0 ? strings : undefined
}

function readStructuredString(record: Record<string, unknown>, ...keys: string[]): string | undefined {
  for (const key of keys) {
    const value = record[key]
    if (typeof value === 'string' && value.trim()) return value.trim()
  }
  return undefined
}

const FILE_PATH_KEYS = [
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

const COMMAND_KEYS = ['command', 'cmd', 'script'] as const
const COMMAND_RESULT_META_KEYS = [
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

const TOOL_KIND_BY_NAME: ReadonlyMap<string, ToolBlock['toolKind']> = new Map([
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
  ['create_plan', 'file_change']
])

function payloadFor(item: CoreTurnItemJson): Record<string, unknown> {
  if (item.kind === 'tool_result') {
    return item.output && typeof item.output === 'object'
      ? (item.output as Record<string, unknown>)
      : {}
  }
  return (item.arguments ?? {}) as Record<string, unknown>
}

function structuredPayloadsFor(item: CoreTurnItemJson): Record<string, unknown>[] {
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

const PRESENTATION_STUDIO_WRITE_TOOL_IDS = new Set(
  PRESENTATION_STUDIO_WRITE_TOOL_NAMES.map(presentationStudioCanonicalToolId)
)
const PRESENTATION_STUDIO_DIRECT_TOOL_IDS = new Map(
  PRESENTATION_STUDIO_WRITE_TOOL_NAMES.map((name) => [
    presentationStudioModelAlias(name),
    presentationStudioCanonicalToolId(name)
  ])
)

function gatewayPayloadFor(item: CoreTurnItemJson): Record<string, unknown> | null {
  if (item.kind !== 'tool_result' || item.toolName !== 'extension_tool_call') return null
  return payloadFor(item)
}

function presentationStudioWriteToolId(item: CoreTurnItemJson): string | undefined {
  const direct = item.toolName ? PRESENTATION_STUDIO_DIRECT_TOOL_IDS.get(item.toolName) : undefined
  if (direct) return direct
  const canonicalToolId = gatewayPayloadFor(item)?.canonicalToolId
  return typeof canonicalToolId === 'string' && PRESENTATION_STUDIO_WRITE_TOOL_IDS.has(canonicalToolId)
    ? canonicalToolId
    : undefined
}

function gatewayHasWorkspaceWriteSideEffect(item: CoreTurnItemJson): boolean {
  return gatewayPayloadFor(item)?.sideEffect === 'workspace-write'
}

function readItemStructuredString(
  item: CoreTurnItemJson,
  ...keys: readonly string[]
): string | undefined {
  for (const payload of structuredPayloadsFor(item)) {
    const value = readStructuredString(payload, ...keys)
    if (value) return value
  }
  return undefined
}

function normalizeChildMetadata(
  child: CoreChildRuntimeMetadataJson | undefined
): CoreChildRuntimeMetadataJson | undefined {
  if (!child?.childId || !child.parentThreadId || !child.parentTurnId) return undefined
  return {
    parentThreadId: child.parentThreadId,
    parentTurnId: child.parentTurnId,
    childId: child.childId,
    ...(child.childLabel ? { childLabel: child.childLabel } : {}),
    ...(child.childProfile ? { childProfile: child.childProfile } : {}),
    ...(child.childModel ? { childModel: child.childModel } : {}),
    ...(child.childToolPolicy ? { childToolPolicy: child.childToolPolicy } : {}),
    childStatus: child.childStatus,
    childSeq: child.childSeq,
    ...(child.detached !== undefined ? { detached: child.detached } : {}),
    ...(child.prefixReused !== undefined ? { prefixReused: child.prefixReused } : {}),
    ...(child.inheritedHistoryItems !== undefined ? { inheritedHistoryItems: child.inheritedHistoryItems } : {}),
    ...(child.toolInvocations !== undefined ? { toolInvocations: child.toolInvocations } : {}),
    ...(child.durationMs !== undefined ? { durationMs: child.durationMs } : {}),
    ...(child.queuedMs !== undefined ? { queuedMs: child.queuedMs } : {}),
    ...(child.totalTokens !== undefined ? { totalTokens: child.totalTokens } : {}),
    ...(child.cacheHitRate !== undefined ? { cacheHitRate: child.cacheHitRate } : {}),
    ...(child.costUsd !== undefined ? { costUsd: child.costUsd } : {}),
    ...(child.costCny !== undefined ? { costCny: child.costCny } : {})
  }
}

function normalizeWebSources(value: unknown): Array<Record<string, string>> | undefined {
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

function normalizeUserFileReferences(value: unknown): Array<{
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

function normalizeInjectedMemorySummaries(
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

function normalizeComposerContexts(value: unknown): ComposerContextAttachment[] | undefined {
  if (!Array.isArray(value)) return undefined
  const contexts = value
    .slice(0, MAX_COMPOSER_CONTEXT_ATTACHMENTS)
    .map((entry) => ComposerContextAttachmentSchema.safeParse(entry))
    .filter((entry) => entry.success)
    .map((entry) => entry.data)
  return contexts.length > 0 ? contexts : undefined
}

function applyRuntimeDisclosureMeta(
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
  if (item.role === 'user' && item.guiDesignCanvas === true) meta.guiDesignCanvas = true
  if (item.role === 'user' && item.guiDesignMode === true) meta.guiDesignMode = true
  if (item.messageSource === 'background_shell' || item.messageSource === 'background_subagent') {
    meta.messageSource = item.messageSource
  }
  applyClientUserMessageSourceMeta(meta, item.text ?? '')
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

function normalizeInjectedInstructionSources(
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

function extractToolSources(item: CoreTurnItemJson): Array<Record<string, string>> | undefined {
  const payload = payloadFor(item)
  return normalizeWebSources(payload.sources) ?? normalizeWebSources(payload.citations)
}

type ToolAttachmentReference = {
  id: string
  name?: string
  mimeType?: string
  byteSize?: number
  width?: number
  height?: number
  previewUrl?: string
}

function extractToolAttachments(item: CoreTurnItemJson): ToolAttachmentReference[] | undefined {
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

function readGeneratedFileString(raw: Record<string, unknown>, ...keys: string[]): string | undefined {
  for (const key of keys) {
    const value = raw[key]
    if (typeof value === 'string' && value.trim()) return value.trim()
  }
  return undefined
}

function normalizeGeneratedFileReference(entry: unknown): GeneratedFileReference | null {
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

const GENERATED_FILE_TOOL_NAMES = new Set([
  'generate_image',
  'generate_speech',
  'generate_music',
  'generate_video'
])

function isGeneratedFileToolName(toolName: string | undefined): boolean {
  const name = toolName?.trim()
  if (!name) return false
  if (GENERATED_FILE_TOOL_NAMES.has(name)) return true
  const bridgedName = name.split('__').at(-1)
  return Boolean(bridgedName && GENERATED_FILE_TOOL_NAMES.has(bridgedName))
}

function extractToolGeneratedFiles(item: CoreTurnItemJson): GeneratedFileReference[] | undefined {
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

function extractComponentPrototype(item: CoreTurnItemJson): ComponentPrototypeMetadata | undefined {
  if (item.toolName !== 'design_component') return undefined
  const payload = payloadFor(item)
  const raw = payload.componentPrototype
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return undefined
  const candidate = raw as Record<string, unknown>
  if (candidate.version !== 1) return undefined
  const status = candidate.status
  if (status !== 'preparing' && status !== 'running' && status !== 'completed' && status !== 'failed') {
    return undefined
  }
  const artifactId = typeof candidate.artifactId === 'string' ? candidate.artifactId.trim() : ''
  const title = typeof candidate.title === 'string' ? candidate.title.trim().slice(0, 120) : ''
  const relativePath = typeof candidate.relativePath === 'string'
    ? candidate.relativePath.trim().replaceAll('\\', '/')
    : ''
  if (!/^component_[a-z0-9]+$/i.test(artifactId) || !title) return undefined
  if (
    !/^\.kun-design\/component-prototypes\/[^/]+\/prototype\.html$/i.test(relativePath) ||
    relativePath.split('/').includes('..')
  ) {
    return undefined
  }
  const viewport = candidate.viewport && typeof candidate.viewport === 'object' && !Array.isArray(candidate.viewport)
    ? candidate.viewport as Record<string, unknown>
    : null
  const width = viewport?.width
  const height = viewport?.height
  if (
    typeof width !== 'number' || !Number.isInteger(width) || width < 280 || width > 1_200 ||
    typeof height !== 'number' || !Number.isInteger(height) || height < 240 || height > 900
  ) {
    return undefined
  }
  const profile = candidate.profile === 'component-designer' ? 'component-designer' : undefined
  const producer = candidate.producer === 'main-agent' || candidate.producer === 'component-designer'
    ? candidate.producer
    : profile === 'component-designer'
      ? 'component-designer'
      : undefined
  if (!producer || (producer === 'main-agent' && profile)) return undefined
  const childId = typeof candidate.childId === 'string' && candidate.childId.trim()
    ? candidate.childId.trim().slice(0, 256)
    : undefined
  const byteSize = typeof candidate.byteSize === 'number' && Number.isInteger(candidate.byteSize) && candidate.byteSize >= 0
    ? candidate.byteSize
    : undefined
  const contentHash = typeof candidate.contentHash === 'string' && /^[a-f0-9]{64}$/i.test(candidate.contentHash)
    ? candidate.contentHash.toLowerCase()
    : undefined
  const summary = typeof candidate.summary === 'string' && candidate.summary.trim()
    ? candidate.summary.trim().slice(0, 2_000)
    : undefined
  const error = typeof candidate.error === 'string' && candidate.error.trim()
    ? candidate.error.trim().slice(0, 2_000)
    : undefined
  return {
    version: 1,
    status,
    artifactId,
    title,
    relativePath,
    viewport: { width, height },
    producer,
    ...(producer === 'component-designer' ? { profile: 'component-designer' as const } : {}),
    ...(childId ? { childId } : {}),
    ...(byteSize !== undefined ? { byteSize } : {}),
    ...(contentHash ? { contentHash } : {}),
    ...(summary ? { summary } : {}),
    ...(error ? { error } : {})
  }
}

function applyCommandResultMeta(meta: Record<string, unknown>, item: CoreTurnItemJson): void {
  const payload = payloadFor(item)
  for (const key of COMMAND_RESULT_META_KEYS) {
    const value = payload[key]
    if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') {
      meta[key] = value
    }
  }
}

function inferToolPresentation(item: CoreTurnItemJson): {
  toolKind: ToolBlock['toolKind']
  filePath?: string
  command?: string
} {
  const filePath = readItemStructuredString(item, ...FILE_PATH_KEYS)
  const command = readItemStructuredString(item, ...COMMAND_KEYS)

  if (presentationStudioWriteToolId(item) || gatewayHasWorkspaceWriteSideEffect(item)) {
    return {
      toolKind: 'file_change',
      ...(filePath ? { filePath } : {}),
      ...(command ? { command } : {})
    }
  }

  if (
    item.toolKind === 'tool_call' ||
    item.toolKind === 'command_execution' ||
    item.toolKind === 'file_change'
  ) {
    return {
      toolKind: item.toolKind,
      ...(filePath ? { filePath } : {}),
      ...(command ? { command } : {})
    }
  }

  const toolName = item.toolName?.trim() ?? ''
  const byName = TOOL_KIND_BY_NAME.get(toolName)
  if (byName) {
    return {
      toolKind: byName,
      ...(filePath ? { filePath } : {}),
      ...(command ? { command } : {})
    }
  }

  // Payload-only fallback. Prefer the kind whose field is present
  // on the payload; if both are present, the explicit command wins
  // (matches the previous heuristic and what the tests assert).
  if (command) {
    return { toolKind: 'command_execution', command }
  }
  if (filePath) {
    return { toolKind: 'file_change', filePath }
  }
  return { toolKind: 'tool_call' }
}

function isPlanItem(item: CoreTurnItemJson): boolean {
  if (item.toolName === 'create_plan') return true
  if (item.kind === 'tool_result' && isPlanOutput(item.output)) return true
  return false
}

function isPlanOutput(output: unknown): boolean {
  if (!output || typeof output !== 'object') return false
  const candidate = output as Record<string, unknown>
  return (
    typeof candidate.plan_id === 'string' &&
    typeof candidate.relative_path === 'string' &&
    typeof candidate.workspace_root === 'string' &&
    (candidate.operation === 'draft' || candidate.operation === 'refine')
  )
}

function extractPlanMetadata(item: CoreTurnItemJson): Record<string, unknown> | null {
  const source = item.kind === 'tool_result' ? item.output : item.arguments
  if (!source || typeof source !== 'object') return null
  const candidate = source as Record<string, unknown>
  const plan: Record<string, unknown> = {}
  if (typeof candidate.plan_id === 'string') plan.plan_id = candidate.plan_id
  if (typeof candidate.workspace_root === 'string') plan.workspace_root = candidate.workspace_root
  if (typeof candidate.relative_path === 'string') plan.relative_path = candidate.relative_path
  if (typeof candidate.absolute_path === 'string') plan.absolute_path = candidate.absolute_path
  if (typeof candidate.source_request === 'string') plan.source_request = candidate.source_request
  if (typeof candidate.title === 'string') plan.title = candidate.title
  if (candidate.operation === 'draft' || candidate.operation === 'refine') {
    plan.operation = candidate.operation
  }
  if (typeof candidate.saved_at === 'string') plan.saved_at = candidate.saved_at
  if (typeof candidate.content_hash === 'string') plan.content_hash = candidate.content_hash
  if (typeof candidate.byte_size === 'number') plan.byte_size = candidate.byte_size
  if (item.kind === 'tool_result' && item.isError) {
    plan.error = typeof candidate.error === 'string' ? candidate.error : 'create_plan failed'
  }
  return Object.keys(plan).length > 0 ? plan : null
}

function toolBlockFromItem(item: CoreTurnItemJson, child?: CoreChildRuntimeMetadataJson): ToolBlock {
  const detail = item.kind === 'tool_result' ? outputText(item.output) : outputText(item.arguments)
  const isPlan = isPlanItem(item)
  const summary =
    item.summary?.trim() ||
    (isPlan ? 'Create plan' : null) ||
    item.toolName?.trim() ||
    (item.kind === 'tool_result' ? 'tool result' : 'tool')
  const meta: Record<string, unknown> = {
    sourceItemId: item.id,
    sourceItemKind: item.kind,
    ...(item.callId ? { callId: item.callId } : {}),
    ...(item.toolName ? { toolName: item.toolName } : {})
  }
  applyRuntimeDisclosureMeta(meta, item, child)
  const sources = extractToolSources(item)
  if (sources) meta.sources = sources
  const attachments = extractToolAttachments(item)
  if (attachments) meta.attachments = attachments
  const generatedFiles = extractToolGeneratedFiles(item)
  if (generatedFiles) meta.generatedFiles = generatedFiles
  const componentPrototype = extractComponentPrototype(item)
  if (componentPrototype) meta.componentPrototype = componentPrototype
  const presentationStudioToolId = presentationStudioWriteToolId(item)
  if (presentationStudioToolId) {
    meta.canonicalToolId = presentationStudioToolId
    meta.presentationArtifactProducer = PRESENTATION_STUDIO_EXTENSION_ID
    const contentSha256 = readItemStructuredString(item, 'contentSha256')
    if (contentSha256 && /^[a-f0-9]{64}$/i.test(contentSha256)) {
      meta.presentationArtifactSha256 = contentSha256.toLowerCase()
    }
  }
  const presentation = inferToolPresentation(item)
  const payload = payloadFor(item)
  if (presentation.command) meta.command = presentation.command
  if (presentation.toolKind === 'command_execution' || item.toolName === 'background_shell') {
    applyCommandResultMeta(meta, item)
  }
  const action = readStructuredString(payload, 'action')
  if (action) meta.action = action
  if (isPlan) {
    const plan = extractPlanMetadata(item)
    if (plan) meta.plan = plan
  }
  return {
    kind: 'tool',
    id: toolBlockId(item),
    createdAt: itemCreatedAt(item),
    summary,
    status: componentDesignStatusOverride(item, componentPrototype) ?? delegateTaskStatusOverride(item, payload) ?? toolStatus(item),
    toolKind: presentation.toolKind,
    ...(presentation.filePath ? { filePath: presentation.filePath } : {}),
    ...(detail ? { detail } : {}),
    meta
  }
}

function componentDesignStatusOverride(
  item: CoreTurnItemJson,
  prototype: ComponentPrototypeMetadata | undefined
): ToolBlock['status'] | undefined {
  if (item.toolName !== 'design_component' || !prototype) return undefined
  if (prototype.status === 'preparing' || prototype.status === 'running') return 'running'
  if (prototype.status === 'failed') return 'error'
  return 'success'
}

function delegateTaskStatusOverride(
  item: CoreTurnItemJson,
  payload: Record<string, unknown>
): ToolBlock['status'] | undefined {
  if (item.toolName !== 'delegate_task' || payload.detached !== true) return undefined
  const childStatus = typeof payload.status === 'string' ? payload.status : undefined
  if (childStatus === 'queued' || childStatus === 'running') return 'running'
  if (childStatus === 'failed' || childStatus === 'aborted') return 'error'
  if (childStatus === 'completed') return 'success'
  return undefined
}

export function mergeChatBlocks(blocks: ChatBlock[]): ChatBlock[] {
  const merged: ChatBlock[] = []
  const toolIndexes = new Map<string, number>()
  for (const block of blocks) {
    if (block.kind !== 'tool') {
      merged.push(block)
      continue
    }
    const existingIndex = toolIndexes.get(block.id)
    if (existingIndex === undefined) {
      toolIndexes.set(block.id, merged.length)
      merged.push(block)
      continue
    }
    const existing = merged[existingIndex]
    if (!existing || existing.kind !== 'tool') {
      merged.push(block)
      continue
    }
    merged[existingIndex] = {
      ...existing,
      ...block,
      createdAt: existing.createdAt ?? block.createdAt,
      summary: block.summary || existing.summary,
      detail: block.detail ?? existing.detail,
      filePath: block.filePath ?? existing.filePath,
      toolKind: block.toolKind ?? existing.toolKind,
      meta: { ...(existing.meta ?? {}), ...(block.meta ?? {}) }
    }
  }
  return merged
}

function userInputQuestionsFromItem(item: CoreTurnItemJson): UserInputQuestion[] {
  return questionsFromCore(item.questions, item.prompt, item.inputId ?? item.id)
}

function questionsFromCore(
  questions: CoreTurnItemJson['questions'] | CoreRuntimeEventJson['questions'] | undefined,
  prompt: string | undefined,
  fallbackId: string
): UserInputQuestion[] {
  if (Array.isArray(questions) && questions.length > 0) {
    return questions
      .map((question) => normalizeUserInputQuestion(question))
      .filter((question): question is UserInputQuestion => question !== null)
  }
  return [
    {
      header: 'Input',
      id: fallbackId,
      question: prompt?.trim() || 'Input requested',
      options: []
    }
  ]
}

function normalizeUserInputQuestion(question: unknown): UserInputQuestion | null {
  if (!question || typeof question !== 'object') return null
  const raw = question as Record<string, unknown>
  const options = Array.isArray(raw.options)
    ? raw.options
        .map((option) => normalizeUserInputOption(option))
        .filter((option): option is UserInputQuestion['options'][number] => option !== null)
    : []
  return {
    header: typeof raw.header === 'string' && raw.header.trim() ? raw.header.trim() : 'Input',
    id: typeof raw.id === 'string' && raw.id.trim() ? raw.id.trim() : 'input',
    question: typeof raw.question === 'string' && raw.question.trim() ? raw.question.trim() : 'Input requested',
    options,
    selectionMode: raw.selectionMode === 'multiple' && options.length > 0 ? 'multiple' : 'single',
    ...(positiveInteger(raw.minSelections) ? { minSelections: positiveInteger(raw.minSelections) } : {}),
    ...(positiveInteger(raw.maxSelections) ? { maxSelections: positiveInteger(raw.maxSelections) } : {})
  }
}

function positiveInteger(value: unknown): number | undefined {
  if (typeof value !== 'number' || !Number.isFinite(value)) return undefined
  const normalized = Math.floor(value)
  return normalized > 0 ? normalized : undefined
}

function normalizeUserInputOption(option: unknown): UserInputQuestion['options'][number] | null {
  if (!option || typeof option !== 'object') return null
  const raw = option as Record<string, unknown>
  const label = typeof raw.label === 'string' && raw.label.trim() ? raw.label.trim() : null
  if (!label) return null
  return {
    label,
    description: typeof raw.description === 'string' ? raw.description : ''
  }
}

function userInputAnswersFromCore(answers: unknown): UserInputAnswer[] | undefined {
  if (!Array.isArray(answers)) return undefined
  const normalized = answers
    .map((answer) => normalizeUserInputAnswer(answer))
    .filter((answer): answer is UserInputAnswer => answer !== null)
  return normalized.length > 0 ? normalized : undefined
}

function normalizeUserInputAnswer(answer: unknown): UserInputAnswer | null {
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

function usageFromCore(usage: CoreUsageSnapshotJson): ThreadUsageSnapshot {
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
    turns: usage.turns ?? 0
  }
}

function userMessageBlockFromItem(item: CoreTurnItemJson): ChatBlock | null {
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

function userMessageEventFromItem(item: CoreTurnItemJson): UserMessageEventPayload {
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

function assistantTextBlockFromItem(item: CoreTurnItemJson): ChatBlock | null {
  if (!item.text?.trim()) return null
  return { kind: 'assistant', id: item.id, turnId: item.turnId, createdAt: itemCreatedAt(item), text: item.text }
}

function reasoningBlockFromItem(item: CoreTurnItemJson): ChatBlock | null {
  if (!item.text?.trim()) return null
  return { kind: 'reasoning', id: item.id, createdAt: itemCreatedAt(item), text: item.text }
}

function approvalBlockFromItem(item: CoreTurnItemJson, child?: CoreChildRuntimeMetadataJson): ChatBlock {
  const meta: Record<string, unknown> = {}
  applyRuntimeDisclosureMeta(meta, item, child)
  return {
    kind: 'approval',
    id: item.id,
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

function approvalStatusFromEvent(event: CoreRuntimeEventJson): ApprovalStatusPayload | null {
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

function userInputBlockFromItem(item: CoreTurnItemJson): ChatBlock {
  const answers = userInputAnswersFromCore(item.answers)
  return {
    kind: 'user_input',
    id: item.id,
    createdAt: itemCreatedAt(item),
    requestId: item.inputId ?? item.id,
    questions: userInputQuestionsFromItem(item),
    ...(answers ? { answers } : {}),
    status:
      item.status === 'failed'
        ? 'error'
        : item.status === 'submitted' || item.status === 'completed'
          ? 'submitted'
          : item.status === 'cancelled' || item.status === 'aborted'
            ? 'cancelled'
          : 'pending'
  }
}

function userInputRequestFromCore(input: {
  itemId?: string
  inputId?: string
  prompt?: string
  questions?: CoreTurnItemJson['questions'] | CoreRuntimeEventJson['questions']
  seq?: number
}): UserInputRequestPayload {
  const fallbackId = input.inputId ?? input.itemId ?? `input_${input.seq ?? Date.now()}`
  return {
    itemId: input.itemId ?? fallbackId,
    requestId: input.inputId ?? fallbackId,
    questions: questionsFromCore(input.questions, input.prompt, input.inputId ?? fallbackId)
  }
}

function compactionBlockFromItem(item: CoreTurnItemJson): ChatBlock {
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

function reviewStatus(item: CoreTurnItemJson): ReviewEventPayload['status'] {
  if (item.status === 'pending' || item.status === 'running') return 'running'
  if (item.status === 'failed' || item.status === 'aborted') return 'error'
  return 'success'
}

function reviewTargetFromCore(target: CoreReviewTargetJson | undefined): ReviewTarget | undefined {
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

function reviewOutputFromCore(output: unknown): ReviewOutput | undefined {
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

function isCoreReviewOutput(value: unknown): value is CoreReviewOutputJson {
  if (!value || typeof value !== 'object') return false
  const raw = value as Partial<CoreReviewOutputJson>
  return (
    Array.isArray(raw.findings) &&
    (raw.overallCorrectness === 'patch is correct' || raw.overallCorrectness === 'patch is incorrect') &&
    typeof raw.overallExplanation === 'string' &&
    typeof raw.overallConfidenceScore === 'number'
  )
}

function reviewBlockFromItem(item: CoreTurnItemJson): ReviewBlock {
  return {
    kind: 'review',
    id: item.id,
    createdAt: itemCreatedAt(item),
    title: item.title?.trim() || 'Code review',
    status: reviewStatus(item),
    target: reviewTargetFromCore(item.target),
    reviewText: item.reviewText,
    output: reviewOutputFromCore(item.output)
  }
}

function errorSeverity(
  explicit: CoreTurnItemJson['severity'] | CoreRuntimeEventJson['severity'],
  code?: string
): 'info' | 'warning' | 'error' {
  if (explicit === 'info' || explicit === 'warning' || explicit === 'error') return explicit
  if (code === 'budget_warning' || code === 'compaction_summary_fallback') return 'warning'
  if (code === 'tool_catalog_changed' || code === 'tool_storm_suppressed') return 'info'
  return 'error'
}

function runtimeErrorDetail(message: string, code?: string, details?: unknown): string | undefined {
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

function systemErrorBlockFromItem(item: CoreTurnItemJson): ChatBlock {
  const message = item.message ?? 'Runtime error'
  const detail = runtimeErrorDetail(message, item.code, item.details)
  return {
    kind: 'system',
    id: item.id,
    createdAt: itemCreatedAt(item),
    text: redactSecretText(message),
    ...(item.code ? { code: item.code } : {}),
    ...(detail ? { detail } : {}),
    severity: errorSeverity(item.severity, item.code)
  }
}

function runtimeErrorFromItem(item: CoreTurnItemJson): RuntimeErrorEventPayload {
  const message = item.message ?? 'Runtime error'
  return {
    itemId: item.id,
    createdAt: itemCreatedAt(item),
    message: redactSecretText(message),
    ...(item.code ? { code: item.code } : {}),
    ...(item.details !== undefined ? { details: item.details } : {}),
    severity: errorSeverity(item.severity, item.code)
  }
}

function runtimeErrorFromEvent(
  event: CoreRuntimeEventJson,
  fallback: string
): RuntimeErrorEventPayload {
  const message = event.message ?? fallback
  const itemId = event.itemId ?? `runtime_error_${event.turnId ?? event.threadId ?? event.seq ?? Date.now()}`
  return {
    itemId,
    createdAt: event.timestamp,
    message: redactSecretText(message),
    ...(event.code ? { code: event.code } : {}),
    ...(event.details !== undefined ? { details: event.details } : {}),
    severity: errorSeverity(event.severity, event.code)
  }
}

function errorForRuntimeEvent(payload: RuntimeErrorEventPayload): Error {
  return new Error(JSON.stringify({
    ...(payload.code ? { code: payload.code } : {}),
    message: payload.message,
    ...(payload.details !== undefined ? { details: payload.details } : {}),
    ...(payload.severity ? { severity: payload.severity } : {})
  }))
}

/**
 * Build a `ChatBlock` from a turn item. Used both for replaying a
 * thread (load path) and as the canonical per-kind view that the
 * live event dispatcher maps onto sink callbacks.
 */
export function chatBlockFromItem(item: CoreTurnItemJson, child?: CoreChildRuntimeMetadataJson): ChatBlock | null {
  switch (item.kind) {
    case 'user_message':
      return userMessageBlockFromItem(item)
    case 'assistant_text':
      return assistantTextBlockFromItem(item)
    case 'assistant_reasoning':
      return reasoningBlockFromItem(item)
    case 'tool_call':
    case 'tool_result':
      return toolBlockFromItem(item, child)
    case 'approval':
      return approvalBlockFromItem(item, child)
    case 'user_input':
      return userInputBlockFromItem(item)
    case 'compaction':
      return compactionBlockFromItem(item)
    case 'review':
      return reviewBlockFromItem(item)
    case 'error':
      return systemErrorBlockFromItem(item)
    default:
      return null
  }
}

function toolEventFromItem(item: CoreTurnItemJson, child?: CoreChildRuntimeMetadataJson): ToolEventPayload {
  const block = toolBlockFromItem(item, child)
  return {
    itemId: block.id,
    summary: block.summary,
    status: block.status,
    toolKind: block.toolKind,
    detail: block.detail,
    filePath: block.filePath,
    meta: block.meta
  }
}

function toolStatusFromChildStatus(status: CoreChildRuntimeMetadataJson['childStatus']): ToolEventPayload['status'] {
  if (status === 'queued' || status === 'running') return 'running'
  if (status === 'completed') return 'success'
  return 'error'
}

function childLifecycleToolEventFromRuntimeEvent(event: CoreRuntimeEventJson): ToolEventPayload | null {
  const child = normalizeChildMetadata(event.child)
  if (!child) return null
  return {
    itemId: `child_lifecycle_${child.childId}`,
    summary: child.childLabel || 'delegate_task',
    status: toolStatusFromChildStatus(child.childStatus),
    updateOnly: true,
    createdAt: event.timestamp,
    toolKind: 'tool_call',
    detail: JSON.stringify({
      childId: child.childId,
      status: child.childStatus,
      detached: child.detached === true
    }),
    meta: { child }
  }
}

function compactionFromItem(item: CoreTurnItemJson): CompactionEventPayload {
  return {
    itemId: item.id,
    turnId: item.turnId,
    summary: item.summary?.trim() || 'Context compacted',
    status: item.status === 'failed' ? 'error' : item.status === 'running' ? 'running' : 'success',
    createdAt: itemCreatedAt(item),
    messagesBefore: item.replacedTokens,
    detail: item.pinnedConstraints?.length ? item.pinnedConstraints.join('\n') : undefined,
    auto: item.auto ?? true
  }
}

function reviewFromItem(item: CoreTurnItemJson): ReviewEventPayload {
  const block = reviewBlockFromItem(item)
  return {
    itemId: block.id,
    createdAt: block.createdAt,
    title: block.title,
    status: block.status,
    target: block.target,
    reviewText: block.reviewText,
    output: block.output
  }
}

/**
 * Dispatch a turn item to a live thread sink. The replay path uses
 * `chatBlockFromItem` directly; this function maps item snapshots onto
 * the `ThreadEventSink` callbacks that the chat store understands.
 */


function compactionFromEvent(
  event: CoreRuntimeEventJson,
  status: CompactionEventPayload['status']
): CompactionEventPayload {
  return {
    itemId: event.itemId ?? `compaction_${event.seq ?? Date.now()}`,
    turnId: event.turnId,
    summary: event.summary ?? 'Context compacted',
    status,
    createdAt: event.timestamp,
    messagesBefore: event.replacedTokens,
    detail: event.pinnedConstraints?.join('\n'),
    auto: event.auto ?? true
  }
}

function toolReadyFromEvent(event: CoreRuntimeEventJson): ToolEventPayload | null {
  const callId = typeof event.callId === 'string' && event.callId.trim() ? event.callId.trim() : ''
  const toolName = typeof event.toolName === 'string' && event.toolName.trim() ? event.toolName.trim() : ''
  if (!callId || !toolName) return null
  return {
    itemId: `tool_${callId}`,
    summary: toolName,
    status: 'running',
    toolKind: 'tool_call',
    meta: {
      ...(event.itemId ? { sourceItemId: event.itemId } : {}),
      callId,
      toolName,
      ...(typeof event.readyCount === 'number' ? { readyCount: event.readyCount } : {}),
      runtimeStatus: 'tool_call_ready'
    }
  }
}

function runtimeStatusFromEvent(event: CoreRuntimeEventJson): RuntimeStatusEventPayload | null {
  if (event.kind === 'error' && event.code === 'compaction_summary_fallback') {
    const key = event.turnId ?? event.threadId ?? event.seq ?? Date.now()
    return {
      kind: 'compaction_summary_fallback',
      itemId: `runtime_status_${key}_compaction_summary_fallback`,
      turnId: event.turnId,
      createdAt: event.timestamp,
      message: event.message
    }
  }
  if (event.kind === 'tool_result_upload_wait') {
    const turnKey = event.turnId ?? event.threadId ?? event.seq ?? Date.now()
    return {
      kind: 'tool_result_upload_wait',
      itemId: `runtime_status_${turnKey}_tool_upload_wait`,
      turnId: event.turnId,
      createdAt: event.timestamp,
      toolResultCount: typeof event.toolResultCount === 'number' ? event.toolResultCount : 0
    }
  }
  if (event.kind === 'model_request_retry') {
    const turnKey = event.turnId ?? event.threadId ?? event.seq ?? Date.now()
    return {
      kind: 'model_request_retry',
      itemId: `runtime_status_${turnKey}_model_retry`,
      turnId: event.turnId,
      createdAt: event.timestamp,
      status: typeof event.status === 'number' ? event.status : undefined,
      attempt: typeof event.attempt === 'number' ? event.attempt : undefined,
      maxAttempts: typeof event.maxAttempts === 'number' ? event.maxAttempts : undefined,
      delayMs: typeof event.delayMs === 'number' ? event.delayMs : undefined
    }
  }
  if (event.kind === 'tool_catalog_changed') {
    const key = event.fingerprint ?? event.seq ?? Date.now()
    return {
      kind: 'tool_catalog_changed',
      itemId: `runtime_status_tool_catalog_${key}`,
      turnId: event.turnId,
      createdAt: event.timestamp,
      ...(event.changeKind ? { changeKind: event.changeKind } : {}),
      message: event.message
    }
  }
  if (event.kind === 'tool_storm_suppressed') {
    const callId = typeof event.callId === 'string' && event.callId.trim() ? event.callId.trim() : ''
    const toolName = typeof event.toolName === 'string' && event.toolName.trim() ? event.toolName.trim() : ''
    if (!callId || !toolName) return null
    return {
      kind: 'tool_storm_suppressed',
      itemId: event.itemId ?? `runtime_status_tool_storm_${callId}`,
      turnId: event.turnId,
      createdAt: event.timestamp,
      message: event.message,
      toolName,
      callId
    }
  }
  return null
}

const kunEventNormalizerDeps: KunEventNormalizerDeps = {
  userMessage: userMessageEventFromItem,
  tool: toolEventFromItem,
  compaction: compactionFromItem,
  review: reviewFromItem,
  itemRuntimeError: runtimeErrorFromItem,
  childTool: childLifecycleToolEventFromRuntimeEvent,
  readyTool: toolReadyFromEvent,
  runtimeStatus: runtimeStatusFromEvent,
  approvalAction: (event) => ({ type: 'approval_requested', event }),
  approvalStatus: approvalStatusFromEvent,
  userInputRequest: (event) => userInputRequestFromCore({
    itemId: event.itemId,
    inputId: event.inputId,
    prompt: event.prompt,
    questions: event.questions,
    seq: event.seq
  }),
  userInputAnswers: userInputAnswersFromCore,
  compactionAction: (event, status) => ({
    type: 'compaction_updated',
    payload: compactionFromEvent(event, status)
  }),
  goalAction: (event, cleared) => ({
    type: 'goal_changed',
    payload: cleared
      ? { threadId: event.threadId ?? '', goal: null, cleared: true, createdAt: event.timestamp }
      : {
          threadId: event.threadId ?? event.goal?.threadId ?? '',
          goal: event.goal ? goalFromCore(event.goal) : null,
          createdAt: event.timestamp
        }
  }),
  todosAction: (event, cleared) => ({
    type: 'todos_changed',
    payload: cleared
      ? { threadId: event.threadId ?? '', todos: null, cleared: true, createdAt: event.timestamp }
      : {
          threadId: event.threadId ?? event.todos?.threadId ?? '',
          todos: event.todos ? todosFromCore(event.todos) : null,
          createdAt: event.timestamp
        }
  }),
  usage: (event) => event.usage ? usageFromCore(event.usage) : null,
  runtimeError: runtimeErrorFromEvent,
  errorFromRuntime: errorForRuntimeEvent
}

export function runtimeProjectionActionsFromEvent(
  event: CoreRuntimeEventJson
): RuntimeProjectionAction[] {
  return normalizeKunRuntimeEvent(event, kunEventNormalizerDeps)
}

async function applyRuntimeProjectionAction(
  action: RuntimeProjectionAction,
  sink: ThreadEventSink,
  handleApprovalRequest: (event: CoreRuntimeEventJson, sink: ThreadEventSink) => Promise<void>
): Promise<void> {
  switch (action.type) {
    case 'seq_observed': sink.onSeq(action.seq); return
    case 'deltas_received': sink.onDeltas(action.deltas); return
    case 'user_message_received': sink.onUserMessage(action.payload); return
    case 'tool_updated': sink.onTool(action.payload); return
    case 'compaction_updated': sink.onCompaction(action.payload); return
    case 'review_updated': sink.onReview?.(action.payload); return
    case 'approval_requested': await handleApprovalRequest(action.event, sink); return
    case 'approval_received': sink.onApproval(action.payload); return
    case 'approval_status_changed': sink.onApprovalStatus?.(action.payload); return
    case 'user_input_requested': sink.onUserInput(action.payload); return
    case 'user_input_status_changed': sink.onUserInputStatus(action.payload); return
    case 'runtime_status_received': sink.onRuntimeStatus?.(action.payload); return
    case 'runtime_error_received': sink.onRuntimeError?.(action.payload); return
    case 'goal_changed': sink.onGoal(action.payload); return
    case 'todos_changed': sink.onTodos?.(action.payload); return
    case 'thread_metadata_changed': sink.onThreadUpdated?.(action.payload); return
    case 'usage_received': sink.onUsage?.(action.payload); return
    case 'turn_completed': sink.onTurnComplete(); return
    case 'turn_failed': sink.onError(action.error, action.options); return
  }
}

/**
 * Dispatches a batch of runtime events, coalescing consecutive text and
 * reasoning deltas into a single sink.onDeltas call so one network chunk
 * costs one store update instead of one per token.
 */
export async function dispatchKunRuntimeEvents(
  events: CoreRuntimeEventJson[],
  sink: ThreadEventSink,
  handleApprovalRequest: (event: CoreRuntimeEventJson, sink: ThreadEventSink) => Promise<void>
): Promise<void> {
  let pendingDeltas: ThreadDeltaEvent[] = []
  const flushDeltas = async (): Promise<void> => {
    if (pendingDeltas.length === 0) return
    const deltas = pendingDeltas
    pendingDeltas = []
    await applyRuntimeProjectionAction(
      { type: 'deltas_received', deltas },
      sink,
      handleApprovalRequest
    )
  }
  for (const event of events) {
    if (event.kind === 'assistant_text_delta' || event.kind === 'assistant_reasoning_delta') {
      const text = event.item?.text ?? ''
      if (text) {
        pendingDeltas.push({
          text,
          kind: event.kind === 'assistant_text_delta' ? 'agent_message' : 'agent_reasoning',
          seq: event.seq
        })
      }
      continue
    }
    await flushDeltas()
    await dispatchKunRuntimeEvent(event, sink, handleApprovalRequest)
  }
  await flushDeltas()
}

export async function dispatchKunRuntimeEvent(
  event: CoreRuntimeEventJson,
  sink: ThreadEventSink,
  handleApprovalRequest: (event: CoreRuntimeEventJson, sink: ThreadEventSink) => Promise<void>
): Promise<void> {
  const actions = runtimeProjectionActionsFromEvent(event)
  for (const action of actions) {
    await applyRuntimeProjectionAction(action, sink, handleApprovalRequest)
  }
}
