import type {
  ToolCallProviderMetadata,
  ModelContextBlockState,
  TurnItem,
  UserMessageSource
} from '../contracts/items.js'
import type { ReviewOutput, ReviewTarget } from '../contracts/review.js'
import type { UserInputQuestion } from '../ports/user-input-gate.js'
import type { ComposerContextAttachmentJson } from '../contracts/composer-context.js'
import { projectToolArgumentsForPersistence } from './tool-argument-envelope.js'
import type {
  DesignDocumentTarget,
  DesignImagePlacementTarget,
  DesignTaskProfile
} from '../contracts/design-task-profile.js'

export type ItemEntity = TurnItem

export function makeUserItem(input: {
  id: string
  turnId: string
  threadId: string
  text: string
  displayText?: string
  messageSource?: UserMessageSource
  attachmentIds?: string[]
  composerContexts?: ComposerContextAttachmentJson[]
  fileReferences?: Array<{ path: string; relativePath: string; name: string; kind?: 'file' | 'directory' }>
  workspaceCheckpointId?: string
  workspace?: string
  threadAgentSurface?: 'code' | 'write' | 'design'
  agentSurface?: 'code' | 'write' | 'design'
  designProfile?: DesignTaskProfile
  designDocumentTarget?: DesignDocumentTarget
  designImagePlacementTarget?: DesignImagePlacementTarget
}): TurnItem {
  const attachmentIds = input.attachmentIds?.filter((id) => id.trim().length > 0)
  const fileReferences = input.fileReferences
    ?.map((reference) => ({
      path: reference.path.trim(),
      relativePath: reference.relativePath.trim(),
      name: reference.name.trim(),
      ...(reference.kind === 'directory' ? { kind: 'directory' as const } : { kind: 'file' as const })
    }))
    .filter((reference) => reference.path && reference.relativePath && reference.name)
  const displayText = input.displayText?.trim()
  return {
    id: input.id,
    turnId: input.turnId,
    threadId: input.threadId,
    role: 'user',
    status: 'completed',
    createdAt: new Date().toISOString(),
    finishedAt: new Date().toISOString(),
    kind: 'user_message',
    text: input.text,
    ...(displayText && displayText !== input.text ? { displayText } : {}),
    ...(input.messageSource ? { messageSource: input.messageSource } : {}),
    ...(attachmentIds?.length ? { attachmentIds } : {}),
    ...(input.composerContexts?.length ? { composerContexts: input.composerContexts } : {}),
    ...(fileReferences?.length ? { fileReferences } : {}),
    ...(input.workspaceCheckpointId ? { workspaceCheckpointId: input.workspaceCheckpointId } : {}),
    ...(input.workspace ? { workspace: input.workspace } : {}),
    ...(input.threadAgentSurface ? { threadAgentSurface: input.threadAgentSurface } : {}),
    ...(input.agentSurface ? { agentSurface: input.agentSurface } : {}),
    ...(input.designProfile ? { designProfile: input.designProfile } : {}),
    ...(input.designDocumentTarget ? { designDocumentTarget: input.designDocumentTarget } : {}),
    ...(input.designImagePlacementTarget
      ? { designImagePlacementTarget: input.designImagePlacementTarget }
      : {})
  }
}

export function makeGoalContextItem(input: {
  id: string
  turnId: string
  threadId: string
  goalKey?: string
  text: string
  createdAt?: string
}): TurnItem {
  const createdAt = input.createdAt ?? new Date().toISOString()
  return {
    id: input.id,
    turnId: input.turnId,
    threadId: input.threadId,
    role: 'system',
    status: 'completed',
    createdAt,
    finishedAt: createdAt,
    kind: 'goal_context',
    ...(input.goalKey ? { goalKey: input.goalKey } : {}),
    text: input.text
  }
}

export function makeModelContextItem(input: {
  id: string
  turnId: string
  threadId: string
  stepIndex: number
  contentDigest: string
  blocks: ModelContextBlockState[]
  text: string
  createdAt?: string
  /** Marks a squashed canonical baseline replacing all earlier deltas. */
  baseline?: boolean
}): TurnItem {
  const createdAt = input.createdAt ?? new Date().toISOString()
  return {
    id: input.id,
    turnId: input.turnId,
    threadId: input.threadId,
    role: 'system',
    status: 'completed',
    createdAt,
    finishedAt: createdAt,
    kind: 'model_context',
    formatVersion: 1,
    ...(input.baseline ? { baseline: true } : {}),
    stepIndex: input.stepIndex,
    contentDigest: input.contentDigest,
    blocks: input.blocks.map((block) => ({ ...block })),
    text: input.text
  }
}

export function makeInterruptionNoteItem(input: {
  id: string
  turnId: string
  threadId: string
  sourceTurnId: string
  text: string
  createdAt?: string
}): TurnItem {
  const createdAt = input.createdAt ?? new Date().toISOString()
  return {
    id: input.id,
    turnId: input.turnId,
    threadId: input.threadId,
    role: 'system',
    status: 'completed',
    createdAt,
    finishedAt: createdAt,
    kind: 'interruption_note',
    sourceTurnId: input.sourceTurnId,
    text: input.text
  }
}

export function makeAssistantTextItem(input: {
  id: string
  turnId: string
  threadId: string
  text: string
  status?: 'running' | 'completed' | 'failed'
  createdAt?: string
}): TurnItem {
  return {
    id: input.id,
    turnId: input.turnId,
    threadId: input.threadId,
    role: 'assistant',
    status: input.status ?? 'running',
    createdAt: input.createdAt ?? new Date().toISOString(),
    kind: 'assistant_text',
    text: input.text
  }
}

export function makeAssistantReasoningItem(input: {
  id: string
  turnId: string
  threadId: string
  text: string
  status?: 'running' | 'completed' | 'failed'
  createdAt?: string
}): TurnItem {
  return {
    id: input.id,
    turnId: input.turnId,
    threadId: input.threadId,
    role: 'assistant',
    status: input.status ?? 'running',
    createdAt: input.createdAt ?? new Date().toISOString(),
    kind: 'assistant_reasoning',
    text: input.text
  }
}

export function makeToolCallItem(input: {
  id: string
  turnId: string
  threadId: string
  callId: string
  toolName: string
  toolKind?: 'tool_call' | 'command_execution' | 'file_change'
  arguments: Record<string, unknown>
  providerMetadata?: ToolCallProviderMetadata
  summary?: string
  status?: 'pending' | 'running' | 'completed' | 'failed'
}): TurnItem {
  const projected = projectToolArgumentsForPersistence(input.arguments)
  const summary = [input.summary, projected.rawSummary].filter(Boolean).join(' ') || undefined
  return {
    id: input.id,
    turnId: input.turnId,
    threadId: input.threadId,
    role: 'tool',
    status: input.status ?? 'pending',
    createdAt: new Date().toISOString(),
    kind: 'tool_call',
    toolName: input.toolName,
    callId: input.callId,
    toolKind: input.toolKind ?? 'tool_call',
    arguments: projected.arguments,
    ...(input.providerMetadata ? { providerMetadata: input.providerMetadata } : {}),
    summary
  }
}

export function makeToolResultItem(input: {
  id: string
  turnId: string
  threadId: string
  callId: string
  toolName: string
  toolKind?: 'tool_call' | 'command_execution' | 'file_change'
  output: unknown
  isError?: boolean
  status?: 'pending' | 'running' | 'completed' | 'failed' | 'aborted'
  finishedAt?: string
}): TurnItem {
  const status = input.status ?? 'completed'
  return {
    id: input.id,
    turnId: input.turnId,
    threadId: input.threadId,
    role: 'tool',
    status,
    createdAt: new Date().toISOString(),
    ...(input.finishedAt
      ? { finishedAt: input.finishedAt }
      : status === 'completed' || status === 'failed' || status === 'aborted'
        ? { finishedAt: new Date().toISOString() }
        : {}),
    kind: 'tool_result',
    toolName: input.toolName,
    callId: input.callId,
    toolKind: input.toolKind ?? 'tool_call',
    output: input.output,
    isError: input.isError ?? false
  }
}

export function makeApprovalItem(input: {
  id: string
  turnId: string
  threadId: string
  approvalId: string
  toolName: string
  summary: string
}): TurnItem {
  return {
    id: input.id,
    turnId: input.turnId,
    threadId: input.threadId,
    role: 'tool',
    createdAt: new Date().toISOString(),
    kind: 'approval',
    approvalId: input.approvalId,
    toolName: input.toolName,
    summary: input.summary,
    status: 'pending'
  }
}

export function makeUserInputItem(input: {
  id: string
  turnId: string
  threadId: string
  inputId: string
  prompt: string
  questions?: UserInputQuestion[]
  timeoutSeconds?: number
}): TurnItem {
  return {
    id: input.id,
    turnId: input.turnId,
    threadId: input.threadId,
    role: 'tool',
    createdAt: new Date().toISOString(),
    kind: 'user_input',
    inputId: input.inputId,
    prompt: input.prompt,
    questions: input.questions ?? [],
    status: 'pending',
    ...(input.timeoutSeconds !== undefined ? { timeoutSeconds: input.timeoutSeconds } : {})
  }
}

export function makeCompactionItem(input: {
  id: string
  turnId: string
  threadId: string
  summary: string
  replacedTokens: number
  pinnedConstraints: string[]
  auto?: boolean
  sourceDigest?: string
  digestMarker?: string
  sourceItemIds?: string[]
}): TurnItem {
  return {
    id: input.id,
    turnId: input.turnId,
    threadId: input.threadId,
    role: 'system',
    status: 'completed',
    createdAt: new Date().toISOString(),
    finishedAt: new Date().toISOString(),
    kind: 'compaction',
    summary: input.summary,
    replacedTokens: input.replacedTokens,
    pinnedConstraints: input.pinnedConstraints,
    ...(input.auto === undefined ? {} : { auto: input.auto }),
    ...(input.sourceDigest ? { sourceDigest: input.sourceDigest } : {}),
    ...(input.digestMarker ? { digestMarker: input.digestMarker } : {}),
    ...(input.sourceItemIds ? { sourceItemIds: [...input.sourceItemIds] } : {})
  }
}

export function makeReviewItem(input: {
  id: string
  turnId: string
  threadId: string
  target: ReviewTarget
  title: string
  status?: 'running' | 'completed' | 'failed' | 'aborted'
  reviewText?: string
  output?: ReviewOutput
  finishedAt?: string
}): TurnItem {
  const status = input.status ?? 'running'
  return {
    id: input.id,
    turnId: input.turnId,
    threadId: input.threadId,
    role: 'assistant',
    status,
    createdAt: new Date().toISOString(),
    ...(input.finishedAt
      ? { finishedAt: input.finishedAt }
      : status === 'completed' || status === 'failed' || status === 'aborted'
        ? { finishedAt: new Date().toISOString() }
        : {}),
    kind: 'review',
    target: input.target,
    title: input.title,
    ...(input.reviewText ? { reviewText: input.reviewText } : {}),
    ...(input.output ? { output: input.output } : {})
  }
}

export function makeErrorItem(input: {
  id: string
  turnId: string
  threadId: string
  message: string
  code?: string
  details?: unknown
  severity?: 'info' | 'warning' | 'error'
}): TurnItem {
  return {
    id: input.id,
    turnId: input.turnId,
    threadId: input.threadId,
    role: 'system',
    status: 'failed',
    createdAt: new Date().toISOString(),
    finishedAt: new Date().toISOString(),
    kind: 'error',
    message: input.message,
    ...(input.code ? { code: input.code } : {}),
    ...(input.details !== undefined ? { details: input.details } : {}),
    ...(input.severity ? { severity: input.severity } : {})
  }
}
