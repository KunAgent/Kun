import {
  SequencedRuntimeEventSchema,
  type SequencedRuntimeEvent
} from './sse-sequence'

export type SseSequenceCursor = {
  streamId: string
  lastSequence: number
}

export const SseSequenceDecision = {
  Accepted: 'accepted',
  Duplicate: 'duplicate',
  Gap: 'gap',
  OutOfOrder: 'out-of-order',
  OldStream: 'old-stream'
} as const
export type SseSequenceDecision = typeof SseSequenceDecision[keyof typeof SseSequenceDecision]

export type SseSequenceInspection = {
  decision: SseSequenceDecision
  streamId: string
  receivedSequence: number
  expectedSequence: number | null
  nextCursor: SseSequenceCursor | null
}

/**
 * Compares one validated event with a renderer cursor without mutating it.
 * A gap must stop projection until a bounded replay or authoritative reload runs.
 */
export function inspectSseSequence(
  cursor: SseSequenceCursor | null,
  rawEvent: SequencedRuntimeEvent
): SseSequenceInspection {
  const event = SequencedRuntimeEventSchema.parse(rawEvent)
  if (!cursor) {
    return {
      decision: SseSequenceDecision.Accepted,
      streamId: event.streamId,
      receivedSequence: event.sequence,
      expectedSequence: event.sequence,
      nextCursor: { streamId: event.streamId, lastSequence: event.sequence }
    }
  }
  if (event.streamId !== cursor.streamId) {
    return {
      decision: SseSequenceDecision.OldStream,
      streamId: event.streamId,
      receivedSequence: event.sequence,
      expectedSequence: null,
      nextCursor: cursor
    }
  }
  const expectedSequence = cursor.lastSequence + 1
  if (event.sequence === expectedSequence) {
    return {
      decision: SseSequenceDecision.Accepted,
      streamId: event.streamId,
      receivedSequence: event.sequence,
      expectedSequence,
      nextCursor: { streamId: cursor.streamId, lastSequence: event.sequence }
    }
  }
  if (event.sequence === cursor.lastSequence) {
    return {
      decision: SseSequenceDecision.Duplicate,
      streamId: event.streamId,
      receivedSequence: event.sequence,
      expectedSequence,
      nextCursor: cursor
    }
  }
  if (event.sequence > expectedSequence) {
    return {
      decision: SseSequenceDecision.Gap,
      streamId: event.streamId,
      receivedSequence: event.sequence,
      expectedSequence,
      nextCursor: cursor
    }
  }
  return {
    decision: SseSequenceDecision.OutOfOrder,
    streamId: event.streamId,
    receivedSequence: event.sequence,
    expectedSequence,
    nextCursor: cursor
  }
}
