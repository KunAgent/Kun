import type { ThreadTodoItem } from '../../../agent/types'
import { isTodoItemCompleted, todoItemFlag } from './todo-progress'

/*
 * Focus window of the todo sheet: long checklists show only the rows around
 * the current step, with the earlier and later items folded into one row
 * each ("已完成 3 项" / "待处理 7 项"). Items are never reordered; folds only
 * hide contiguous runs before and after the window.
 */

/** Lists up to this many items are shown in full. */
export const TODO_FOCUS_FULL_LIST_LIMIT = 6
/** Rows kept around the current step: the one before, the current, the one after. */
export const TODO_FOCUS_WINDOW_SIZE = 3

/** Half-open index range `[start, end)`. */
export type TodoRange = { start: number; end: number }

export type TodoFocusWindow = {
  /** Folded run before the window (always starts at 0), or null. */
  before: TodoRange | null
  visible: TodoRange
  /** Folded run after the window (always ends at the list end), or null. */
  after: TodoRange | null
}

/**
 * Window of `TODO_FOCUS_WINDOW_SIZE` rows around `currentIndex` (one before,
 * the current, one after). At the start it extends forward; near the end it
 * backfills from earlier items. A fold never hides a single row (the row is
 * shown instead). An out-of-range `currentIndex` (no current step) anchors
 * the window at the first item.
 */
export function resolveTodoFocusWindow(total: number, currentIndex: number): TodoFocusWindow {
  const count = Math.max(0, Math.floor(total))
  if (count <= TODO_FOCUS_FULL_LIST_LIMIT) {
    return { before: null, visible: { start: 0, end: count }, after: null }
  }
  const anchor = Number.isInteger(currentIndex) && currentIndex >= 0 && currentIndex < count ? currentIndex : 0
  let start = anchor - 1
  let end = start + TODO_FOCUS_WINDOW_SIZE
  if (start < 0) {
    start = 0
    end = TODO_FOCUS_WINDOW_SIZE
  }
  if (end > count) {
    end = count
    start = count - TODO_FOCUS_WINDOW_SIZE
  }
  if (start === 1) start = 0
  if (count - end === 1) end = count
  return {
    before: start > 0 ? { start: 0, end: start } : null,
    visible: { start, end },
    after: end < count ? { start: end, end: count } : null
  }
}

export type TodoFoldSummary = {
  count: number
  /** Every folded item is done ("已完成 n 项"). */
  allCompleted: boolean
  /** No folded item is done ("待处理 n 项"). */
  noneCompleted: boolean
  blocked: number
  failed: number
}

/** Counts behind a fold row's label and its trailing pills. */
export function summarizeTodoFold(items: readonly ThreadTodoItem[], range: TodoRange): TodoFoldSummary {
  const folded = items.slice(range.start, range.end)
  const completed = folded.filter(isTodoItemCompleted).length
  return {
    count: folded.length,
    allCompleted: folded.length > 0 && completed === folded.length,
    noneCompleted: completed === 0,
    blocked: folded.filter((item) => todoItemFlag(item) === 'blocked').length,
    failed: folded.filter((item) => todoItemFlag(item) === 'failed').length
  }
}
