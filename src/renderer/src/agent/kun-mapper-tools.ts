import type {
  ApprovalStatusPayload,
  ApprovalReviewEventPayload,
  ChatBlock,
  CompactionEventPayload,
  ComponentPrototypeMetadata,
  DiagramPrototypeMetadata,
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
import { dedupeTimelineTextBlocks } from './timeline-text-blocks'
import { visualizationFromToolPayload } from './conversation-visualization'
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

import {
  COMMAND_KEYS,
  COMMAND_RESULT_META_KEYS,
  FILE_PATH_KEYS,
  TOOL_KIND_BY_NAME,
  applyRuntimeDisclosureMeta,
  extractToolAttachments,
  extractToolGeneratedFiles,
  extractToolSources,
  gatewayHasWorkspaceWriteSideEffect,
  itemCreatedAt,
  outputText,
  payloadFor,
  presentationStudioWriteToolId,
  readItemStructuredString,
  readStructuredString,
  toolBlockId,
  toolStatus
} from './kun-mapper-core'


export function extractComponentPrototype(item: CoreTurnItemJson): ComponentPrototypeMetadata | undefined {
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

export function extractDiagramPrototype(item: CoreTurnItemJson): DiagramPrototypeMetadata | undefined {
  if (item.toolName !== 'show_diagram') return undefined
  const raw = payloadFor(item).diagramPrototype
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return undefined
  const candidate = raw as Record<string, unknown>
  const status = candidate.status
  if (candidate.version !== 1 || (
    status !== 'preparing' && status !== 'running' && status !== 'completed' && status !== 'failed'
  )) return undefined
  const artifactId = typeof candidate.artifactId === 'string' ? candidate.artifactId.trim() : ''
  const title = typeof candidate.title === 'string' ? candidate.title.trim().slice(0, 120) : ''
  const relativePath = typeof candidate.relativePath === 'string'
    ? candidate.relativePath.trim().replaceAll('\\', '/')
    : ''
  if (!artifactId || !title || !/^\.kun-design\/diagram-prototypes\/[^/]+\/diagram\.html$/i.test(relativePath)) {
    return undefined
  }
  if (relativePath.split('/').includes('..')) return undefined
  const viewport = candidate.viewport && typeof candidate.viewport === 'object' && !Array.isArray(candidate.viewport)
    ? candidate.viewport as Record<string, unknown>
    : null
  const width = viewport?.width
  const height = viewport?.height
  if (
    typeof width !== 'number' || !Number.isInteger(width) || width < 280 || width > 1_200 ||
    typeof height !== 'number' || !Number.isInteger(height) || height < 240 || height > 900
  ) return undefined
  const byteSize = typeof candidate.byteSize === 'number' && Number.isInteger(candidate.byteSize) && candidate.byteSize >= 0
    ? candidate.byteSize : undefined
  const contentHash = typeof candidate.contentHash === 'string' && /^[a-f0-9]{64}$/i.test(candidate.contentHash)
    ? candidate.contentHash.toLowerCase() : undefined
  const summary = typeof candidate.summary === 'string' && candidate.summary.trim()
    ? candidate.summary.trim().slice(0, 2_000) : undefined
  const error = typeof candidate.error === 'string' && candidate.error.trim()
    ? candidate.error.trim().slice(0, 2_000) : undefined
  return {
    version: 1,
    status,
    artifactId,
    title,
    relativePath,
    viewport: { width, height },
    ...(byteSize !== undefined ? { byteSize } : {}),
    ...(contentHash ? { contentHash } : {}),
    ...(summary ? { summary } : {}),
    ...(error ? { error } : {})
  }
}

export function applyCommandResultMeta(meta: Record<string, unknown>, item: CoreTurnItemJson): void {
  const payload = payloadFor(item)
  for (const key of COMMAND_RESULT_META_KEYS) {
    const value = payload[key]
    if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') {
      meta[key] = value
    }
  }
}

function officeEditSha256(item: CoreTurnItemJson, ...keys: string[]): string | undefined {
  const value = readItemStructuredString(item, ...keys)
  return value && /^[a-f0-9]{64}$/i.test(value) ? value.toLowerCase() : undefined
}

export function applyOfficeEditMeta(
  meta: Record<string, unknown>,
  item: CoreTurnItemJson,
  payload: Record<string, unknown>
): void {
  if (item.toolName !== 'office_edit') return

  const expectedSha256 = officeEditSha256(item, 'expectedSha256', 'expected_sha256')
  const beforeSha256 = officeEditSha256(item, 'beforeSha256', 'before_sha256')
  const afterSha256 = officeEditSha256(item, 'afterSha256', 'after_sha256')
  const previewInvalidated = payload.previewInvalidated ?? payload.preview_invalidated
  if (expectedSha256) meta.expectedSha256 = expectedSha256
  if (beforeSha256) meta.beforeSha256 = beforeSha256
  if (afterSha256) meta.afterSha256 = afterSha256
  if (typeof previewInvalidated === 'boolean') meta.previewInvalidated = previewInvalidated
}

export function inferToolPresentation(item: CoreTurnItemJson): {
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

export function isPlanItem(item: CoreTurnItemJson): boolean {
  if (item.toolName === 'create_plan') return true
  if (item.kind === 'tool_result' && isPlanOutput(item.output)) return true
  return false
}

export function isPlanOutput(output: unknown): boolean {
  if (!output || typeof output !== 'object') return false
  const candidate = output as Record<string, unknown>
  return (
    typeof candidate.plan_id === 'string' &&
    typeof candidate.relative_path === 'string' &&
    typeof candidate.workspace_root === 'string' &&
    (candidate.operation === 'draft' || candidate.operation === 'refine')
  )
}

export function extractPlanMetadata(item: CoreTurnItemJson): Record<string, unknown> | null {
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

export function toolBlockFromItem(item: CoreTurnItemJson, child?: CoreChildRuntimeMetadataJson): ToolBlock {
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
    ...(item.toolName ? { toolName: item.toolName } : {}),
    ...(item.cancelRequestedAt ? { cancelRequestedAt: item.cancelRequestedAt } : {})
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
  const diagramPrototype = extractDiagramPrototype(item)
  if (diagramPrototype) meta.diagramPrototype = diagramPrototype
  if (item.toolName === 'show_visualization' && !item.isError) {
    const visualization = visualizationFromToolPayload(
      item.kind === 'tool_result' ? item.output : item.arguments
    )
    if (visualization) meta.conversationVisualization = visualization
  }
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
  applyOfficeEditMeta(meta, item, payload)
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
    turnId: item.turnId,
    createdAt: itemCreatedAt(item),
    summary,
    status: componentDesignStatusOverride(item, componentPrototype) ?? diagramStatusOverride(item, diagramPrototype) ?? delegateTaskStatusOverride(item, payload) ?? toolStatus(item),
    toolKind: presentation.toolKind,
    ...(presentation.filePath ? { filePath: presentation.filePath } : {}),
    ...(detail ? { detail } : {}),
    meta
  }
}

export function componentDesignStatusOverride(
  item: CoreTurnItemJson,
  prototype: ComponentPrototypeMetadata | undefined
): ToolBlock['status'] | undefined {
  if (item.toolName !== 'design_component' || !prototype) return undefined
  if (prototype.status === 'preparing' || prototype.status === 'running') return 'running'
  if (prototype.status === 'failed') return 'error'
  return 'success'
}

export function diagramStatusOverride(
  item: CoreTurnItemJson,
  prototype: DiagramPrototypeMetadata | undefined
): ToolBlock['status'] | undefined {
  if (item.toolName !== 'show_diagram' || !prototype) return undefined
  if (prototype.status === 'preparing' || prototype.status === 'running') return 'running'
  if (prototype.status === 'failed') return 'error'
  return 'success'
}

export function delegateTaskStatusOverride(
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
  return dedupeTimelineTextBlocks(merged)
}
