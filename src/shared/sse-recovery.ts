import {
  SseSequenceDecision,
  type SseSequenceInspection
} from './sse-gap'

export type SseRecoveryPlan =
  | { action: 'none'; reason: 'accepted' | 'duplicate' | 'out-of-order'; streamId: string }
  | { action: 'replay'; streamId: string; fromSequence: number; toSequence: number; maxEvents: number }
  | { action: 'reload'; streamId: string; reason: 'old-stream' | 'gap-too-large' | 'replay-failed' }

export type SseRecoveryOptions = {
  maxReplayEvents?: number
  replayFailed?: boolean
}

/** Chooses a bounded recovery action; it never performs I/O or mutates the projection. */
export function planSseRecovery(
  inspection: SseSequenceInspection,
  options: SseRecoveryOptions = {}
): SseRecoveryPlan {
  if (inspection.decision === SseSequenceDecision.OldStream) {
    return { action: 'reload', streamId: inspection.streamId, reason: 'old-stream' }
  }
  if (inspection.decision !== SseSequenceDecision.Gap) {
    return {
      action: 'none',
      reason: inspection.decision,
      streamId: inspection.streamId
    }
  }
  const maxEvents = Number.isSafeInteger(options.maxReplayEvents) && (options.maxReplayEvents ?? 0) > 0
    ? Math.min(options.maxReplayEvents as number, 1000)
    : 128
  const fromSequence = inspection.expectedSequence
  const toSequence = inspection.receivedSequence - 1
  if (
    options.replayFailed === true ||
    fromSequence === null ||
    toSequence < fromSequence ||
    toSequence - fromSequence + 1 > maxEvents
  ) {
    return { action: 'reload', streamId: inspection.streamId, reason: options.replayFailed ? 'replay-failed' : 'gap-too-large' }
  }
  return {
    action: 'replay',
    streamId: inspection.streamId,
    fromSequence,
    toSequence,
    maxEvents
  }
}
