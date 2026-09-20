import { createHash } from 'node:crypto'
import type { AssistantTextTurnItem, TurnItem } from '../contracts/items.js'
import type { SessionStore } from '../ports/session-store.js'
import { roomTurnItems } from './room-item-history.js'

const SEGMENT_MAX_CHARS = 64_000
const SEGMENT_MAX_ITEMS = 128
const SEGMENT_TOTAL_CHARS = 64_000

/** One published assistant_text item becomes one room message. */
export type RoomRunTextSegment = {
  itemId: string
  messageId: string
  text: string
  createdAt: string
  status: AssistantTextTurnItem['status']
}

/** Deterministic message identity for a run + source item; used by both persistence and SSE. */
export function roomRunSegmentMessageId(runId: string, itemId: string): string {
  return 'segment-' + createHash('sha256').update(JSON.stringify([runId, itemId])).digest('hex').slice(0, 40)
}

/** Map an assistant_text item to its segment; returns undefined for empty or non-text items. */
export function segmentFromItem(item: TurnItem, runId: string): RoomRunTextSegment | undefined {
  if (item.kind !== 'assistant_text') return undefined
  const text = item.text.slice(0, SEGMENT_MAX_CHARS)
  if (!text.trim()) return undefined
  return { itemId: item.id, messageId: roomRunSegmentMessageId(runId, item.id), text,
    createdAt: item.createdAt, status: item.status }
}

/**
 * Collect assistant_text items for one turn in chronological (oldest-first) order.
 * The source iterator yields newest-first; bounds mirror the previous aggregate reader so
 * segmentation never loads an unbounded session.
 */
export async function collectRoomRunSegments(sessions: SessionStore,
  threadId: string, turnId: string, runId: string): Promise<RoomRunTextSegment[]> {
  const newestFirst: Array<{ itemId: string; text: string; createdAt: string; status: AssistantTextTurnItem['status'] }> = []
  let chars = 0
  for await (const item of roomTurnItems(sessions, threadId, turnId)) {
    if (item.kind !== 'assistant_text') continue
    newestFirst.push({ itemId: item.id, text: item.text, createdAt: item.createdAt, status: item.status })
    chars += item.text.length
    if (newestFirst.length >= SEGMENT_MAX_ITEMS || chars >= SEGMENT_TOTAL_CHARS) break
  }
  newestFirst.reverse()
  return newestFirst.filter((item) => item.text.trim())
    .map((item) => ({ ...item, text: item.text.slice(0, SEGMENT_MAX_CHARS),
      messageId: roomRunSegmentMessageId(runId, item.itemId) }))
}
