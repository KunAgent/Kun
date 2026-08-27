import type { ChatState } from '../../store/chat-store-types'
import {
  suppressPendingCanvasContinuations,
  type CanvasReplayBarrierCollection,
  type PendingScreenGeneration
} from './canvas-design-replay-support'
import {
  canvasLiveTurnOutcome,
  canvasTurnContinuationDecision
} from './canvas-turn-outcome'

/**
 * Gate for Canvas turn continuations (screen HTML generation, SVG follow-ups).
 *
 * When a turn ends, the sidebar thread projection may still describe the old
 * state (missing thread, stale latestTurnId, unsynced status), so the outcome
 * can only be resolved as `unknown`. Continuing immediately in that state is
 * what let aborted/failed turns keep generating screens and follow-up tasks.
 * The gate instead waits briefly for the authoritative terminal record (or a
 * settled projection), stops the continuation when the outcome never resolves,
 * and cancels queued work if a failed/aborted terminal arrives late.
 */

export const CANVAS_TURN_OUTCOME_WAIT_INTERVAL_MS = 250
export const CANVAS_TURN_OUTCOME_WAIT_ATTEMPTS = 8

export type ContinuationQueues = {
  pendingScreens: PendingScreenGeneration[]
  pendingSvgToolBlocks: Map<string, unknown>
  svgSourceTurnIds: Map<string, string>
  svgRetryCounts: Map<string, number>
  barriers: CanvasReplayBarrierCollection
}

export type CanvasTurnContinuationGateOptions = {
  turnId: string
  /** Re-read store state on every poll so a settling projection is observed. */
  getChatState: () => Pick<ChatState, 'threads' | 'activeThreadId'>
  threadId?: string | null
  queues: ContinuationQueues
  isDisposed: () => boolean
  onContinue: () => void
  /** Optional diagnostics hook (tests). */
  onStoppedUnknown?: (turnId: string) => void
  /**
   * When true, an outcome that stays unknown past the wait window still runs
   * the continuation. Use for durable idle replay where the ops were already
   * written and replaying them is safe; the follow-up HTML generation is the
   * only risk and is idempotent. Live turn endings keep the default false.
   */
  continueOnUnknownTimeout?: boolean
}

export type CanvasTurnContinuationGate = {
  /** Resolve the current outcome; use when the caller must decide right now. */
  outcomeNow: () => ReturnType<typeof canvasLiveTurnOutcome>
  begin: () => void
  cancel: () => void
  pending: () => boolean
}

export function createCanvasTurnContinuationGate(
  options: CanvasTurnContinuationGateOptions
): CanvasTurnContinuationGate {
  let timer: ReturnType<typeof setTimeout> | null = null
  let attempts = 0
  let decided = false

  const outcomeNow = (): ReturnType<typeof canvasLiveTurnOutcome> => {
    const state = options.getChatState()
    return canvasLiveTurnOutcome({
      threads: state.threads,
      threadId: options.threadId ?? state.activeThreadId,
      turnId: options.turnId
    })
  }

  const cancelTimer = (): void => {
    if (timer) {
      clearTimeout(timer)
      timer = null
    }
  }

  // Remove only this turn's queued work so continuations of other turns are
  // not disturbed when a late terminal suppresses this turn.
  const suppressForTurn = (): void => {
    const { queues } = options
    for (let index = queues.pendingScreens.length - 1; index >= 0; index -= 1) {
      if (queues.pendingScreens[index]?.sourceTurnId === options.turnId) {
        queues.pendingScreens.splice(index, 1)
      }
    }
    for (const [blockId, sourceTurnId] of [...queues.svgSourceTurnIds]) {
      if (sourceTurnId !== options.turnId) continue
      queues.svgSourceTurnIds.delete(blockId)
      queues.pendingSvgToolBlocks.delete(blockId)
      queues.svgRetryCounts.delete(blockId)
    }
    const barrier = queues.barriers.get(options.turnId)
    if (barrier) {
      barrier.pendingScreenIds.clear()
      barrier.pendingSvgBlockIds.clear()
      barrier.replayComplete = true
    }
  }

  const stopAll = (): void => {
    // Unresolvable outcome: default to stopping, and drop everything queued so
    // no hidden follow-up can drain later. The user can retry manually.
    suppressPendingCanvasContinuations({
      pendingScreens: options.queues.pendingScreens,
      pendingSvgToolBlocks: options.queues.pendingSvgToolBlocks,
      svgSourceTurnIds: options.queues.svgSourceTurnIds,
      svgRetryCounts: options.queues.svgRetryCounts,
      barriers: options.queues.barriers
    })
  }

  const decide = (): void => {
    timer = null
    if (decided || options.isDisposed()) return
    const decision = canvasTurnContinuationDecision(outcomeNow())
    if (decision === 'wait' && attempts < CANVAS_TURN_OUTCOME_WAIT_ATTEMPTS) {
      attempts += 1
      timer = setTimeout(decide, CANVAS_TURN_OUTCOME_WAIT_INTERVAL_MS)
      return
    }
    decided = true
    if (decision === 'continue') {
      options.onContinue()
      return
    }
    if (decision === 'stop') suppressForTurn()
    else if (options.continueOnUnknownTimeout) {
      options.onContinue()
    } else {
      options.onStoppedUnknown?.(options.turnId)
      stopAll()
    }
  }

  return {
    outcomeNow,
    begin: () => {
      if (decided || timer) return
      decide()
    },
    cancel: () => {
      decided = true
      cancelTimer()
    },
    pending: () => !decided
  }
}
