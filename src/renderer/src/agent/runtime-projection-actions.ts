import type { CoreRuntimeEventJson } from './kun-contract'
import type {
  ApprovalStatusPayload,
  ApprovalReviewEventPayload,
  AssistantItemSnapshotPayload,
  CompactionEventPayload,
  ReviewEventPayload,
  RuntimeErrorEventPayload,
  RuntimeStatusEventPayload,
  RequestContextSnapshot,
  ChatBlock,
  ThreadGoal,
  ThreadTodoList,
  ThreadDeltaEvent,
  ThreadErrorOptions,
  ThreadEventSink,
  ThreadUsageSnapshot,
  DelegatedRuntimeState,
  ToolEventPayload,
  TurnTerminalEvent,
  UserInputRequestPayload,
  UserInputStatusPayload,
  UserMessageEventPayload
} from './types'

type GoalProjection = Parameters<ThreadEventSink['onGoal']>[0]
type TodoProjection = Parameters<NonNullable<ThreadEventSink['onTodos']>>[0]
type ThreadMetadataProjection = Parameters<NonNullable<ThreadEventSink['onThreadUpdated']>>[0]

/**
 * Normalized, provider-independent actions produced from Kun wire events.
 * These records contain no store calls or renderer effects and can therefore
 * be replayed through the same reducer used for live SSE.
 */
type RuntimeProjectionActionPayload =
  | { type: 'seq_observed'; seq: number }
  | { type: 'deltas_received'; deltas: ThreadDeltaEvent[] }
  | { type: 'assistant_item_upserted'; payload: AssistantItemSnapshotPayload }
  | { type: 'user_message_received'; payload: UserMessageEventPayload }
  | { type: 'tool_updated'; payload: ToolEventPayload }
  | { type: 'compaction_updated'; payload: CompactionEventPayload }
  | { type: 'review_updated'; payload: ReviewEventPayload }
  | { type: 'approval_requested'; event: CoreRuntimeEventJson }
  | { type: 'approval_received'; payload: Parameters<ThreadEventSink['onApproval']>[0] }
  | { type: 'approval_status_changed'; payload: ApprovalStatusPayload }
  | { type: 'approval_review_updated'; payload: ApprovalReviewEventPayload }
  | { type: 'user_input_requested'; payload: UserInputRequestPayload }
  | { type: 'user_input_status_changed'; payload: UserInputStatusPayload }
  | { type: 'runtime_status_received'; payload: RuntimeStatusEventPayload }
  | { type: 'runtime_error_received'; payload: RuntimeErrorEventPayload }
  | { type: 'goal_changed'; payload: GoalProjection }
  | { type: 'todos_changed'; payload: TodoProjection }
  | { type: 'thread_metadata_changed'; payload: ThreadMetadataProjection }
  | { type: 'context_snapshot_received'; payload: RequestContextSnapshot }
  | { type: 'delegated_runtime_received'; payload: DelegatedRuntimeState }
  | { type: 'usage_received'; payload: ThreadUsageSnapshot }
  | {
      type: 'thread_snapshot_reconciled'
      payload: {
        threadId: string
        blocks: ChatBlock[]
        latestSeq: number
        threadStatus?: string
        latestTurnId?: string
        latestTurnStatus?: string
        goal?: ThreadGoal | null
        todos?: ThreadTodoList | null
        turnId?: string | null
        userBlockId?: string | null
      }
    }
  | { type: 'turn_completed'; payload: TurnTerminalEvent }
  | { type: 'turn_aborted'; payload: TurnTerminalEvent }
  | {
      type: 'turn_failed'
      payload: {
        threadId?: string
        turnId?: string
        seq?: number
        error: Error
        options?: ThreadErrorOptions
      }
    }

/**
 * Every action produced from a persisted runtime event keeps that event's
 * sequence identity.  Consumers can therefore reject a replay before either
 * state projection or browser-side effects run.  Legacy/unpersisted events
 * may omit the value.
 */
export type RuntimeProjectionAction = RuntimeProjectionActionPayload & {
  seq?: number
}

export type RuntimeProjectionActionBatch = readonly RuntimeProjectionAction[]
