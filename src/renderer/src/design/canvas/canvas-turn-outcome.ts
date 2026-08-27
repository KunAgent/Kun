import type { NormalizedThread } from '../../agent/types'
import { canvasTerminalOutcomeFor } from './canvas-turn-terminal-registry'

export type CanvasTurnOutcome = 'completed' | 'aborted' | 'failed' | 'unknown'

/**
 * Continuation control for turn follow-up work (screen HTML generation, queued
 * drains). `unknown` is no longer "allow": it means the terminal state has not
 * been confirmed yet, so the caller must wait briefly and re-check, and stop
 * the continuation if the outcome never resolves.
 */
export type CanvasTurnContinuationDecision = 'continue' | 'wait' | 'stop'

type CanvasThreadTerminalState = Pick<
  NormalizedThread,
  'id' | 'latestTurnId' | 'latestTurnStatus'
>

export function normalizeCanvasTurnOutcome(
  status: string | null | undefined
): CanvasTurnOutcome {
  const normalized = status?.trim().toLowerCase()
  if (normalized === 'completed' || normalized === 'success') return 'completed'
  if (normalized === 'aborted' || normalized === 'cancelled' || normalized === 'canceled') {
    return 'aborted'
  }
  if (normalized === 'failed' || normalized === 'error') return 'failed'
  return 'unknown'
}

function canvasThreadTerminalState(
  threads: readonly CanvasThreadTerminalState[] | undefined,
  threadId: string
): CanvasThreadTerminalState | undefined {
  return threads?.find((thread) => thread.id === threadId)
}

export function canvasLiveTurnOutcome(options: {
  threads?: readonly CanvasThreadTerminalState[]
  threadId?: string | null
  turnId?: string | null
}): CanvasTurnOutcome {
  const threadId = options.threadId?.trim()
  const turnId = options.turnId?.trim()
  if (!threadId || !turnId) return 'unknown'
  // The SSE terminal event is authoritative for this exact turn; the sidebar
  // thread projection can lag behind (missing thread, stale latestTurnId,
  // unsynced status) and must not override a recorded terminal outcome.
  const recorded = canvasTerminalOutcomeFor(turnId)
  if (recorded) return recorded.outcome
  const thread = canvasThreadTerminalState(options.threads, threadId)
  if (!thread) return 'unknown'
  const latestTurnId = thread.latestTurnId?.trim()
  if (latestTurnId && latestTurnId !== turnId) return 'unknown'
  return normalizeCanvasTurnOutcome(thread.latestTurnStatus)
}

export function canvasDurableTurnOutcome(options: {
  threads?: readonly CanvasThreadTerminalState[]
  threadId: string
  turnId: string
}): CanvasTurnOutcome {
  const recorded = canvasTerminalOutcomeFor(options.turnId)
  if (recorded) return recorded.outcome
  const thread = canvasThreadTerminalState(options.threads, options.threadId)
  if (!thread || thread.latestTurnId?.trim() !== options.turnId.trim()) return 'unknown'
  return normalizeCanvasTurnOutcome(thread.latestTurnStatus)
}

export function canvasTurnAllowsContinuation(outcome: CanvasTurnOutcome): boolean {
  return outcome !== 'aborted' && outcome !== 'failed'
}

export function canvasTurnContinuationDecision(
  outcome: CanvasTurnOutcome
): CanvasTurnContinuationDecision {
  if (outcome === 'completed') return 'continue'
  if (outcome === 'aborted' || outcome === 'failed') return 'stop'
  return 'wait'
}
