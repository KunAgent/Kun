import { createHash } from 'node:crypto'

/** Deterministic message identity for a run + source item; used by both persistence and SSE. */
export function roomRunSegmentMessageId(runId: string, itemId: string): string {
  return 'segment-' + createHash('sha256').update(JSON.stringify([runId, itemId])).digest('hex').slice(0, 40)
}
