import { createHash } from 'node:crypto'
import {
  MEMORY_FEEDBACK_SCHEMA_VERSION,
  MemoryFeedbackEvent,
  type MemoryFeedbackEvent as MemoryFeedbackEventValue
} from '../contracts/memory-feedback.js'

export type MemoryRetrievalFeedbackTarget = {
  enabled: () => boolean
  append: (event: MemoryFeedbackEventValue) => Promise<unknown>
}

/** Best-effort audit of final Memory ids only. This function never rejects. */
export async function recordRetrieved(input: {
  feedback?: MemoryRetrievalFeedbackTarget
  selectedIds: readonly string[]
  threadId: string
  turnId: string
  occurredAt: string
}): Promise<void> {
  const feedback = input.feedback
  if (!feedback) return
  try {
    if (!feedback.enabled()) return
    const selectedIds = [...new Set(input.selectedIds)]
    await Promise.allSettled(selectedIds.map((memoryId) => feedback.append(
      MemoryFeedbackEvent.parse({
        schemaVersion: MEMORY_FEEDBACK_SCHEMA_VERSION,
        id: retrievalEventId(input.threadId, input.turnId, memoryId),
        kind: 'retrieved',
        memoryId,
        occurredAt: input.occurredAt,
        threadId: input.threadId,
        turnId: input.turnId
      })
    )))
  } catch {
    // Invalid or unavailable feedback must never affect an otherwise valid turn.
  }
}

function retrievalEventId(threadId: string, turnId: string, memoryId: string): string {
  const hash = createHash('sha256')
    .update(JSON.stringify([threadId, turnId, memoryId]))
    .digest('hex')
  return `feedback-retrieved-${hash.slice(0, 32)}`
}
