import type { HistoryReference } from '../contracts/history-reference.js'
import { HistorySourceError } from './codex-jsonl.js'

export type HistoryTarget = { turnId: string; itemId?: string; previousCursor?: string; nextCursor?: string }
export type HistoryTargetRange = { start: number; end: number; anchor?: number }
type Cursor = { referenceId: string; turnId: string; start: number; end: number; direction?: 'previous' | 'next' }
export const HISTORY_TARGET_CURSOR_PREFIX = 'target:'

/** An exact-turn target has independent, bidirectional cursors; it never changes the main timeline cursor. */
export function resolveHistoryTargetRange(input: {
  reference: HistoryReference; turnId: string; itemIds: readonly string[]; limit: number
  itemId?: string; cursor?: string
}): HistoryTargetRange {
  const count = input.itemIds.length
  const anchor = input.itemId ? input.itemIds.indexOf(input.itemId) : undefined
  if (anchor === -1) throw new HistorySourceError('partial', 'The requested history record is outside this turn and branch.')
  if (input.cursor) {
    try {
      if (!input.cursor.startsWith(HISTORY_TARGET_CURSOR_PREFIX)) throw new Error()
      const value = JSON.parse(Buffer.from(input.cursor.slice(HISTORY_TARGET_CURSOR_PREFIX.length), 'base64url').toString('utf8')) as Cursor
      if (value.referenceId !== input.reference.id || value.turnId !== input.turnId ||
        !Number.isSafeInteger(value.start) || !Number.isSafeInteger(value.end) ||
        value.start < 0 || value.end <= value.start || value.end > count ||
        (value.direction !== undefined && value.direction !== 'previous' && value.direction !== 'next')) throw new Error()
      const start = value.direction === 'next' ? value.start : Math.max(value.start, value.end - input.limit)
      const end = value.direction === 'next' ? Math.min(value.end, value.start + input.limit) : value.end
      // Byte-budget trimming must retain the edge adjacent to the loaded page.
      // Dropping that edge would skip records when only this direction's cursor advances.
      return { start, end, anchor: value.direction === 'next' ? start : end - 1 }
    } catch { throw new HistorySourceError('partial', 'Invalid history target cursor for this turn and branch.') }
  }
  const start = anchor === undefined ? Math.max(0, count - input.limit)
    : Math.max(0, anchor - Math.floor(input.limit / 2))
  return { start, end: Math.min(count, start + input.limit), ...(anchor === undefined ? {} : { anchor }) }
}

export function historyTargetPage(input: {
  reference: HistoryReference; turnId: string; itemId?: string; count: number
  start: number; end: number; limit: number
}): HistoryTarget {
  const cursor = (start: number, end: number, direction: 'previous' | 'next') => HISTORY_TARGET_CURSOR_PREFIX + Buffer.from(JSON.stringify({
    referenceId: input.reference.id, turnId: input.turnId, start, end, direction
  } satisfies Cursor)).toString('base64url')
  return {
    turnId: input.turnId,
    ...(input.itemId ? { itemId: input.itemId } : {}),
    ...(input.start > 0 ? { previousCursor: cursor(Math.max(0, input.start - input.limit), input.start, 'previous') } : {}),
    ...(input.end < input.count ? { nextCursor: cursor(input.end, Math.min(input.count, input.end + input.limit), 'next') } : {})
  }
}
