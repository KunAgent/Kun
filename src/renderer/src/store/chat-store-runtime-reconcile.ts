import type { AgentProvider } from '../agent/provider-types'
import type { ChatState } from './chat-store-types'
import { reduceChatProjection } from './chat-projection-reducer'
import { hydrateBlockModelLabels } from './chat-store-helpers'
import { settlePendingRuntimeWorkAfterInterrupt, threadSnapshotLooksRunning } from './chat-store-runtime-helpers'
import {
  clearRuntimeStreamRecoveringError,
  isInterruptSettledError,
  runtimeErrorDetail
} from './chat-store-runtime-notifications'
import { describeRuntimeError, formatRuntimeError } from '../lib/format-runtime-error'
import {
  goalTimelineText,
  runtimeErrorPayloadToError,
  runtimeStatusText,
  upsertRuntimeErrorBlock
} from './chat-store-runtime-projection-support'

/**
 * Re-fetch the settled thread detail after a terminal stream event so the
 * projection matches the runtime's durable record (blocks, statuses, goal,
 * todos) even when SSE delivery of the tail was interrupted.
 */
export async function reconcileCompletedTurnFromThreadDetail(input: {
  threadId: string | null | undefined
  turnId: string | null | undefined
  userBlockId: string | null | undefined
  loadThreadDetail: AgentProvider['getThreadDetail']
  set: (partial: Partial<ChatState> | ((state: ChatState) => Partial<ChatState>)) => void
  get: () => ChatState
}): Promise<void> {
  const threadId = input.threadId?.trim()
  if (!threadId) return

  try {
    const {
      blocks: rawBlocks,
      latestSeq,
      threadStatus,
      latestTurnId,
      latestTurnStatus,
      latestTurnStartedAtMs,
      goal,
      todos
    } = await input.loadThreadDetail(threadId)
    const loaded = hydrateBlockModelLabels(threadId, rawBlocks)

    input.set((state) => reduceChatProjection(state, {
      type: 'thread_snapshot_reconciled',
      payload: {
        threadId,
        blocks: loaded,
        latestSeq,
        threadStatus,
        latestTurnId,
        latestTurnStatus,
        latestTurnStartedAtMs,
        goal,
        todos,
        turnId: input.turnId,
        userBlockId: input.userBlockId
      }
    }, {
      now: Date.now(),
      clearRecoveringError: clearRuntimeStreamRecoveringError,
      goalTimelineText,
      runtimeStatusText,
      runtimeErrorView: (event) => describeRuntimeError(runtimeErrorPayloadToError(event)),
      upsertRuntimeError: upsertRuntimeErrorBlock,
      formatRuntimeError,
      runtimeErrorDetail,
      isInterruptSettledError,
      settlePendingRuntimeWork: settlePendingRuntimeWorkAfterInterrupt,
      threadSnapshotLooksRunning
    }))
  } catch (error) {
    if (typeof window === 'undefined') return
    void window.kunGui?.logError?.('turn-completion-reconcile', 'Failed to reconcile completed turn', {
      message: error instanceof Error ? error.message : String(error),
      threadId
    }).catch(() => undefined)
  }
}
