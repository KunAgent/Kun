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

import {
  goalFromCore,
  itemCreatedAt,
  normalizeChildMetadata,
  todosFromCore,
  toolBlockId
} from './kun-mapper-core'
import { toolBlockFromItem } from './kun-mapper-tools'
import { chartSpecFromToolItem } from './chart-spec-adapter'
import {
  approvalBlockFromItem,
  approvalReviewFromEvent,
  approvalStatusFromEvent,
  assistantTextBlockFromItem,
  compactionBlockFromItem,
  contextSnapshotFromCore,
  delegatedRuntimeFromCore,
  errorForRuntimeEvent,
  reasoningBlockFromItem,
  reviewBlockFromItem,
  runtimeErrorFromEvent,
  runtimeErrorFromItem,
  systemErrorBlockFromItem,
  usageFromCore,
  userInputAnswersFromCore,
  userInputBlockFromItem,
  userInputRequestFromCore,
  userMessageBlockFromItem,
  userMessageEventFromItem
} from './kun-mapper-projection'


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
    case 'tool_result': {
      const spec = chartSpecFromToolItem(item)
      if (spec) {
        return {
          kind: 'chart',
          id: toolBlockId(item),
          turnId: item.turnId,
          createdAt: itemCreatedAt(item),
          spec
        }
      }
      return toolBlockFromItem(item, child)
    }
    case 'approval':
      return item.decisionSource === 'agent' || item.approvalReviewer === 'agent'
        ? null
        : approvalBlockFromItem(item, child)
    case 'user_input': {
      const block = userInputBlockFromItem(item)
      return block.questions.length > 0 ? block : null
    }
    case 'compaction':
      return compactionBlockFromItem(item)
    case 'review':
      return reviewBlockFromItem(item)
    case 'error':
      return item.code === 'tool_catalog_changed' ? null : systemErrorBlockFromItem(item)
    default:
      return null
  }
}

export function toolEventFromItem(item: CoreTurnItemJson, child?: CoreChildRuntimeMetadataJson): ToolEventPayload {
  const block = toolBlockFromItem(item, child)
  const chartSpec = chartSpecFromToolItem(item)
  return {
    itemId: block.id,
    turnId: item.turnId,
    createdAt: block.createdAt,
    summary: block.summary,
    status: block.status,
    toolKind: block.toolKind,
    detail: block.detail,
    filePath: block.filePath,
    meta: chartSpec ? { ...block.meta, chartSpec } : block.meta
  }
}

export function toolStatusFromChildStatus(status: CoreChildRuntimeMetadataJson['childStatus']): ToolEventPayload['status'] {
  if (status === 'queued' || status === 'running') return 'running'
  if (status === 'completed') return 'success'
  return 'error'
}

export function childLifecycleToolEventFromRuntimeEvent(event: CoreRuntimeEventJson): ToolEventPayload | null {
  const child = normalizeChildMetadata(event.child)
  if (!child) return null
  return {
    itemId: `child_lifecycle_${child.childId}`,
    turnId: event.turnId ?? child.parentTurnId,
    summary: child.childLabel || 'delegate_task',
    status: toolStatusFromChildStatus(child.childStatus),
    updateOnly: true,
    createdAt: event.timestamp,
    toolKind: 'tool_call',
    detail: JSON.stringify({
      childId: child.childId,
      status: child.childStatus,
      detached: child.detached === true,
      resumable: child.resumable === true,
      resumeCount: child.resumeCount ?? 0,
      ...(child.failure ? { failure: child.failure } : {}),
      ...(child.proactiveRetry ? { proactiveRetry: child.proactiveRetry } : {}),
      launcher: (child.childLauncher as string | undefined) === 'explore_agent' ? 'fast_context' : child.childLauncher,
      terminationReason: child.childTerminationReason,
      parentTurnId: child.parentTurnId
    }),
    meta: {
      child: {
        ...child,
        ...(event.child?.failure ? { failure: event.child.failure } : {}),
        ...(event.child?.proactiveRetry ? { proactiveRetry: event.child.proactiveRetry } : {})
      }
    }
  }
}

export function compactionFromItem(item: CoreTurnItemJson): CompactionEventPayload {
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

export function reviewFromItem(item: CoreTurnItemJson): ReviewEventPayload {
  const block = reviewBlockFromItem(item)
  return {
    itemId: block.id,
    turnId: item.turnId,
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


export function compactionFromEvent(
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

export function toolReadyFromEvent(event: CoreRuntimeEventJson): ToolEventPayload | null {
  const callId = typeof event.callId === 'string' && event.callId.trim() ? event.callId.trim() : ''
  const toolName = typeof event.toolName === 'string' && event.toolName.trim() ? event.toolName.trim() : ''
  if (!callId || !toolName) return null
  return {
    itemId: `tool_${callId}`,
    turnId: event.turnId,
    createdAt: event.timestamp,
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

export function runtimeStatusFromEvent(event: CoreRuntimeEventJson): RuntimeStatusEventPayload | null {
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
      ...(typeof event.status === 'number' ? { status: event.status } : {}),
      attempt: typeof event.attempt === 'number' ? event.attempt : undefined,
      maxAttempts: typeof event.maxAttempts === 'number' ? event.maxAttempts : undefined,
      delayMs: typeof event.delayMs === 'number' ? event.delayMs : undefined,
      failureSummary: typeof event.failureSummary === 'string' && event.failureSummary.trim()
        ? redactSecretText(event.failureSummary.trim())
        : undefined,
      retryReason: event.reason === 'network' ||
        event.reason === 'stream_transport' ||
        event.reason === 'context_overflow'
        ? event.reason
        : undefined
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
  if (event.kind === 'required_tool_gate') {
    const toolName = typeof event.toolName === 'string' && event.toolName.trim() ? event.toolName.trim() : ''
    const phase = event.phase
    const attempt = typeof event.attempt === 'number' && event.attempt > 0 ? event.attempt : undefined
    const maxAttempts = typeof event.maxAttempts === 'number' && event.maxAttempts > 0
      ? event.maxAttempts
      : undefined
    if (
      !toolName ||
      (phase !== 'preparing' && phase !== 'retrying' && phase !== 'succeeded' && phase !== 'failed') ||
      attempt === undefined ||
      maxAttempts === undefined
    ) return null
    const turnKey = event.turnId ?? event.threadId ?? event.seq ?? Date.now()
    return {
      kind: 'required_tool_gate',
      itemId: `runtime_status_${turnKey}_required_tool_${toolName}`,
      turnId: event.turnId,
      createdAt: event.timestamp,
      toolName,
      phase,
      attempt,
      maxAttempts,
      ...(typeof event.failureSummary === 'string' && event.failureSummary.trim()
        ? { failureSummary: redactSecretText(event.failureSummary.trim()) }
        : {}),
      ...(typeof event.code === 'string' && event.code.trim() ? { code: event.code.trim() } : {})
    }
  }
  return null
}

export const kunEventNormalizerDeps: KunEventNormalizerDeps = {
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
  approvalReview: approvalReviewFromEvent,
  userInputRequest: (event) => userInputRequestFromCore({
    itemId: event.itemId,
    inputId: event.inputId,
    turnId: event.turnId,
    createdAt: event.timestamp,
    prompt: event.prompt,
    questions: event.questions,
    timeoutSeconds: event.timeoutSeconds,
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
  contextSnapshot: contextSnapshotFromCore,
  delegatedRuntime: delegatedRuntimeFromCore,
  usage: (event) => event.usage ? usageFromCore(event.usage, event.turnId) : null,
  runtimeError: runtimeErrorFromEvent,
  errorFromRuntime: errorForRuntimeEvent
}

export function runtimeProjectionActionsFromEvent(
  event: CoreRuntimeEventJson
): RuntimeProjectionAction[] {
  return normalizeKunRuntimeEvent(event, kunEventNormalizerDeps)
}

export async function applyRuntimeProjectionAction(
  action: RuntimeProjectionAction,
  sink: ThreadEventSink,
  handleApprovalRequest: (event: CoreRuntimeEventJson, sink: ThreadEventSink) => Promise<void>
): Promise<void> {
  switch (action.type) {
    case 'seq_observed': sink.onSeq(action.seq); return
    case 'deltas_received': sink.onDeltas(action.deltas); return
    case 'assistant_item_upserted': sink.onAssistantItem?.(action.payload); return
    case 'user_message_received': sink.onUserMessage(action.payload); return
    case 'tool_updated': sink.onTool(action.payload); return
    case 'compaction_updated': sink.onCompaction(action.payload); return
    case 'review_updated': sink.onReview?.(action.payload); return
    case 'approval_requested': await handleApprovalRequest(action.event, sink); return
    case 'approval_received': sink.onApproval(action.payload); return
    case 'approval_status_changed': sink.onApprovalStatus?.(action.payload); return
    case 'approval_review_updated': sink.onApprovalReview?.(action.payload); return
    case 'user_input_requested': sink.onUserInput(action.payload); return
    case 'user_input_status_changed': sink.onUserInputStatus(action.payload); return
    case 'runtime_status_received': sink.onRuntimeStatus?.(action.payload); return
    case 'runtime_error_received': sink.onRuntimeError?.(action.payload); return
    case 'goal_changed': sink.onGoal(action.payload); return
    case 'todos_changed': sink.onTodos?.(action.payload); return
    case 'thread_metadata_changed': sink.onThreadUpdated?.(action.payload); return
    case 'context_snapshot_received': sink.onContextSnapshot?.(action.payload); return
    case 'delegated_runtime_received': sink.onDelegatedRuntimeState?.(action.payload); return
    case 'usage_received': sink.onUsage?.(action.payload); return
    case 'turn_completed': sink.onTurnComplete(action.payload); return
    case 'turn_aborted': sink.onTurnComplete(action.payload); return
    case 'turn_failed': {
      const { error, options, threadId, turnId, seq } = action.payload
      // Keep terminal identity on the error options so the store can reject a
      // replayed/out-of-order failure from an older turn, matching how
      // turn_completed/turn_aborted carry theirs through TurnTerminalEvent.
      sink.onError(error, {
        ...(options ?? {}),
        ...(threadId ? { threadId } : {}),
        ...(turnId ? { turnId } : {}),
        ...(typeof seq === 'number' ? { seq } : {})
      })
      return
    }
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
    const seqs = deltas
      .map((delta) => delta.seq)
      .filter((seq): seq is number => typeof seq === 'number')
    await applyRuntimeProjectionAction(
      {
        type: 'deltas_received',
        deltas,
        ...(seqs.length > 0 ? { seq: Math.max(...seqs) } : {})
      },
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
          seq: event.seq,
          ...(typeof event.deltaOffset === 'number'
            ? { deltaOffset: event.deltaOffset }
            : {}),
          threadId: event.threadId ?? event.item?.threadId,
          turnId: event.turnId ?? event.item?.turnId,
          itemId: event.itemId ?? event.item?.id,
          createdAt: event.timestamp ?? event.item?.createdAt
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
  const child = normalizeChildMetadata(event.child)
  if (child) {
    sink.onChildRuntimeEvent?.({
      child,
      ...(typeof event.seq === 'number' ? { seq: event.seq } : {}),
      ...(event.timestamp ? { timestamp: event.timestamp } : {})
    })
  }
  if (event.kind === 'graph_event' && event.graph !== undefined) {
    sink.onGraphEvent?.(event.graph)
  }
  if (event.kind === 'graph_planning' && event.planning !== undefined) {
    sink.onGraphPlanningEvent?.(event.planning)
  }
  const actions = runtimeProjectionActionsFromEvent(event)
  for (const action of actions) {
    await applyRuntimeProjectionAction(action, sink, handleApprovalRequest)
  }
}
