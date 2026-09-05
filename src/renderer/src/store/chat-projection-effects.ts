import type { ToolEventPayload } from '../agent/types'
import type { ChatState } from './chat-store-types'

/** Browser/store work intentionally kept outside the pure projection reducer. */
export type ChatProjectionEffect =
  | { type: 'arm_stream_watchdog' }
  | { type: 'refresh_write_workspace'; event?: ToolEventPayload }
  | { type: 'mirror_claw_reply'; threadId: string; text: string }
  | { type: 'notify_turn_complete'; threadId: string | null; state: ChatState; dedupeKey: string; turnId: string | null }
  | { type: 'mirror_sdd_transcript' }
  | { type: 'mirror_design_transcript' }
  | { type: 'sync_completion_poll' }
  | {
      type: 'reload_completed_turn'
      threadId: string | null
      turnId: string | null
      userBlockId: string | null
    }
  | { type: 'refresh_threads' }
  | { type: 'release_worktree'; threadId: string | null }
  | { type: 'drain_queued_messages' }

export function completionProjectionEffects(input: {
  state: ChatState
  threadId: string | null
  turnId: string | null
  userBlockId: string | null
  dedupeKey: string
  mirrorText?: string
  mirrorThreadId?: string
  reconcile: boolean
  releaseWorktree: boolean
}): ChatProjectionEffect[] {
  return [
    ...(input.mirrorText && input.mirrorThreadId
      ? [{ type: 'mirror_claw_reply' as const, threadId: input.mirrorThreadId, text: input.mirrorText }]
      : []),
    { type: 'notify_turn_complete', threadId: input.threadId, state: input.state, dedupeKey: input.dedupeKey, turnId: input.turnId },
    { type: 'refresh_write_workspace' },
    { type: 'mirror_sdd_transcript' },
    { type: 'mirror_design_transcript' },
    { type: 'sync_completion_poll' },
    ...(input.reconcile
      ? [{
          type: 'reload_completed_turn' as const,
          threadId: input.threadId,
          turnId: input.turnId,
          userBlockId: input.userBlockId
        }]
      : []),
    { type: 'refresh_threads' },
    ...(input.releaseWorktree
      ? [{ type: 'release_worktree' as const, threadId: input.threadId }]
      : []),
    { type: 'drain_queued_messages' }
  ]
}

export function terminalFailureProjectionEffects(
  threadId: string | null,
  releaseWorktree: boolean
): ChatProjectionEffect[] {
  return [
    { type: 'sync_completion_poll' },
    { type: 'refresh_threads' },
    ...(releaseWorktree ? [{ type: 'release_worktree' as const, threadId }] : []),
    { type: 'drain_queued_messages' }
  ]
}
