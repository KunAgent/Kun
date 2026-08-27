import type { CoreChildRuntimeMetadataJson, CoreRuntimeEventJson, CoreTurnItemJson } from './kun-contract'
import type {
  ApprovalStatusPayload,
  ApprovalReviewEventPayload,
  CompactionEventPayload,
  DelegatedRuntimeState,
  ReviewEventPayload,
  RequestContextSnapshot,
  RuntimeErrorEventPayload,
  RuntimeStatusEventPayload,
  ThreadUsageSnapshot,
  ToolEventPayload,
  UserInputAnswer,
  UserInputRequestPayload,
  UserMessageEventPayload,
  TurnTerminalEvent
} from './types'
import type { RuntimeProjectionAction } from './runtime-projection-actions'

export type KunEventNormalizerDeps = {
  userMessage: (item: CoreTurnItemJson) => UserMessageEventPayload
  tool: (item: CoreTurnItemJson, child?: CoreChildRuntimeMetadataJson) => ToolEventPayload
  compaction: (item: CoreTurnItemJson) => CompactionEventPayload
  review: (item: CoreTurnItemJson) => ReviewEventPayload
  itemRuntimeError: (item: CoreTurnItemJson) => RuntimeErrorEventPayload
  childTool: (event: CoreRuntimeEventJson) => ToolEventPayload | null
  readyTool: (event: CoreRuntimeEventJson) => ToolEventPayload | null
  runtimeStatus: (event: CoreRuntimeEventJson) => RuntimeStatusEventPayload | null
  approvalAction: (event: CoreRuntimeEventJson) => RuntimeProjectionAction
  approvalStatus: (event: CoreRuntimeEventJson) => ApprovalStatusPayload | null
  approvalReview: (event: CoreRuntimeEventJson) => ApprovalReviewEventPayload | null
  userInputRequest: (event: CoreRuntimeEventJson) => UserInputRequestPayload
  userInputAnswers: (answers: unknown) => UserInputAnswer[] | undefined
  compactionAction: (
    event: CoreRuntimeEventJson,
    status: 'running' | 'success'
  ) => RuntimeProjectionAction
  goalAction: (event: CoreRuntimeEventJson, cleared: boolean) => RuntimeProjectionAction
  todosAction: (event: CoreRuntimeEventJson, cleared: boolean) => RuntimeProjectionAction
  contextSnapshot: (event: CoreRuntimeEventJson) => RequestContextSnapshot | null
  delegatedRuntime: (event: CoreRuntimeEventJson) => DelegatedRuntimeState | null
  usage: (event: CoreRuntimeEventJson) => ThreadUsageSnapshot | null
  runtimeError: (event: CoreRuntimeEventJson, fallback: string) => RuntimeErrorEventPayload
  errorFromRuntime: (payload: RuntimeErrorEventPayload) => Error
}

export function normalizeKunTurnItem(
  item: CoreTurnItemJson,
  child: CoreChildRuntimeMetadataJson | undefined,
  deps: KunEventNormalizerDeps
): RuntimeProjectionAction | null {
  switch (item.kind) {
    case 'user_message':
      return { type: 'user_message_received', payload: deps.userMessage(item) }
    case 'assistant_text':
    case 'assistant_reasoning':
      return {
        type: 'assistant_item_upserted',
        payload: {
          itemId: item.id,
          threadId: item.threadId,
          turnId: item.turnId,
          kind: item.kind === 'assistant_text' ? 'agent_message' : 'agent_reasoning',
          status: item.status,
          createdAt: item.createdAt,
          text: item.text ?? ''
        }
      }
    case 'approval':
    case 'user_input':
      return null
    case 'tool_call':
    case 'tool_result':
      return { type: 'tool_updated', payload: deps.tool(item, child) }
    case 'compaction':
      return { type: 'compaction_updated', payload: deps.compaction(item) }
    case 'review':
      return { type: 'review_updated', payload: deps.review(item) }
    case 'error':
      return item.code === 'tool_catalog_changed'
        ? null
        : { type: 'runtime_error_received', payload: deps.itemRuntimeError(item) }
    default:
      return null
  }
}

/** Pure Kun wire-event to normalized projection-action conversion. */
function normalizeKunRuntimeEventPayload(
  event: CoreRuntimeEventJson,
  deps: KunEventNormalizerDeps
): RuntimeProjectionAction[] {
  switch (event.kind) {
    case 'assistant_text_delta':
    case 'assistant_reasoning_delta': {
      const text = event.item?.text ?? ''
      return text
        ? [{
            type: 'deltas_received',
            deltas: [{
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
            }]
          }]
        : []
    }
    case 'item_created':
    case 'item_updated':
    case 'item_completed':
    case 'tool_call_started':
    case 'tool_call_finished': {
      const action = event.item ? normalizeKunTurnItem(event.item, event.child, deps) : null
      return action ? [action] : []
    }
    case 'turn_started': {
      if (!event.child) {
        if (!event.threadId || (!event.threadAgentSurface && !event.designProfile)) return []
        return [{
          type: 'thread_metadata_changed',
          payload: {
            threadId: event.threadId,
            ...(event.threadAgentSurface
              ? { agentSurface: event.threadAgentSurface }
              : {}),
            ...(event.designProfile ? { designProfile: event.designProfile } : {})
          }
        }]
      }
      const tool = deps.childTool(event)
      return tool ? [{ type: 'tool_updated', payload: tool }] : []
    }
    case 'tool_call_ready': {
      const tool = deps.readyTool(event)
      return tool ? [{ type: 'tool_updated', payload: tool }] : []
    }
    case 'tool_result_upload_wait':
    case 'model_request_retry':
    case 'tool_storm_suppressed':
    case 'required_tool_gate': {
      const status = deps.runtimeStatus(event)
      return status ? [{ type: 'runtime_status_received', payload: status }] : []
    }
    case 'tool_catalog_changed':
      return []
    case 'approval_requested':
      return [deps.approvalAction(event)]
    case 'approval_resolved': {
      if (
        event.decisionSource === 'agent' ||
        event.approvalReviewer === 'agent'
      ) return []
      const status = deps.approvalStatus(event)
      return status ? [{ type: 'approval_status_changed', payload: status }] : []
    }
    case 'approval_review_started':
    case 'approval_review_completed': {
      const review = deps.approvalReview(event)
      return review ? [{ type: 'approval_review_updated', payload: review }] : []
    }
    case 'user_input_requested': {
      const payload = deps.userInputRequest(event)
      return payload.questions.length > 0
        ? [{ type: 'user_input_requested', payload }]
        : []
    }
    case 'user_input_resolved': {
      const answers = deps.userInputAnswers(event.answers)
      const status = event.status === 'cancelled'
        ? 'cancelled'
        : event.status === 'timeout'
          ? 'timeout'
          : 'submitted'
      return [{
        type: 'user_input_status_changed',
        payload: {
          itemId: event.itemId ?? event.inputId ?? `input_${event.seq ?? 'unknown'}`,
          status,
          ...(answers ? { answers } : {})
        }
      }]
    }
    case 'compaction_started':
      return [deps.compactionAction(event, 'running')]
    case 'compaction_completed':
      return [deps.compactionAction(event, 'success')]
    case 'goal_updated':
      return [deps.goalAction(event, false)]
    case 'goal_cleared':
      return [deps.goalAction(event, true)]
    case 'todos_updated':
      return [deps.todosAction(event, false)]
    case 'todos_cleared':
      return [deps.todosAction(event, true)]
    case 'context_snapshot': {
      const snapshot = deps.contextSnapshot(event)
      return snapshot ? [{ type: 'context_snapshot_received', payload: snapshot }] : []
    }
    case 'delegated_runtime': {
      const state = deps.delegatedRuntime(event)
      return state ? [{ type: 'delegated_runtime_received', payload: state }] : []
    }
    case 'usage': {
      const usage = deps.usage(event)
      return usage ? [{ type: 'usage_received', payload: usage }] : []
    }
    case 'thread_updated':
      return [{
        type: 'thread_metadata_changed',
        payload: {
          threadId: event.threadId ?? '',
          ...(event.title !== undefined ? { title: event.title } : {}),
          ...(event.titleAuto !== undefined ? { titleAuto: event.titleAuto } : {}),
          ...(typeof event.status === 'string' ? { status: event.status } : {}),
          ...(event.agentSurface ? { agentSurface: event.agentSurface } : {}),
          ...(event.designProfile ? { designProfile: event.designProfile } : {})
        }
      }]
    case 'turn_completed':
      if (event.child) {
        const tool = deps.childTool(event)
        return tool ? [{ type: 'tool_updated', payload: tool }] : []
      }
      return [{ type: 'turn_completed', payload: turnTerminalPayload(event, 'completed') }]
    case 'turn_aborted':
      if (event.child) {
        const tool = deps.childTool(event)
        return tool ? [{ type: 'tool_updated', payload: tool }] : []
      }
      return [{ type: 'turn_aborted', payload: turnTerminalPayload(event, 'aborted') }]
    case 'turn_failed': {
      if (event.child) {
        const tool = deps.childTool(event)
        return tool ? [{ type: 'tool_updated', payload: tool }] : []
      }
      const payload = deps.runtimeError(event, 'Kun turn failed')
      const terminal: RuntimeProjectionAction = {
        type: 'turn_failed',
        payload: {
          ...(event.threadId ? { threadId: event.threadId } : {}),
          ...(event.turnId ? { turnId: event.turnId } : {}),
          ...(typeof event.seq === 'number' ? { seq: event.seq } : {}),
          error: deps.errorFromRuntime(payload),
          options: { terminal: true, scope: 'conversation' }
        }
      }
      // A message-less terminal event normally follows a more useful
      // structured `error` event. Settle the turn without adding a generic
      // "Kun turn failed" duplicate to the conversation.
      return event.message?.trim()
        ? [{ type: 'runtime_error_received', payload }, terminal]
        : [terminal]
    }
    case 'error':
      if (event.code === 'compaction_summary_fallback') {
        const status = deps.runtimeStatus(event)
        return status ? [{ type: 'runtime_status_received', payload: status }] : []
      }
      return [{ type: 'runtime_error_received', payload: deps.runtimeError(event, 'Runtime error') }]
    default:
      return []
  }
}

function turnTerminalPayload(
  event: CoreRuntimeEventJson,
  status: TurnTerminalEvent['status']
): TurnTerminalEvent {
  return {
    status,
    ...(event.threadId ? { threadId: event.threadId } : {}),
    ...(event.turnId ? { turnId: event.turnId } : {}),
    ...(typeof event.seq === 'number' ? { seq: event.seq } : {})
  }
}

export function normalizeKunRuntimeEvent(
  event: CoreRuntimeEventJson,
  deps: KunEventNormalizerDeps
): RuntimeProjectionAction[] {
  const actions = normalizeKunRuntimeEventPayload(event, deps)
  const seq = event.seq
  if (typeof seq !== 'number') return actions
  return actions.map((action) => ({ ...action, seq }))
}
