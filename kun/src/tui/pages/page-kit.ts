import { isKey, type TuiKeyEvent } from '../keys.js'
import type { PageSize } from '../page-model.js'

/** Invalidation callback every page receives; the app re-renders on call. */
export type Invalidate = () => void

/**
 * Shared list navigation for selection pages. Returns the new index when the
 * key is a navigation key, otherwise undefined so the caller can handle it.
 */
export function navigateList(
  key: TuiKeyEvent,
  index: number,
  count: number,
  pageStep = 10
): number | undefined {
  const last = Math.max(0, count - 1)
  if (isKey(key, 'up', 'ctrl+p')) return Math.max(0, index - 1)
  if (isKey(key, 'down', 'ctrl+n')) return Math.min(last, index + 1)
  if (isKey(key, 'pageUp')) return Math.max(0, index - pageStep)
  if (isKey(key, 'pageDown')) return Math.min(last, index + pageStep)
  if (isKey(key, 'home')) return 0
  if (isKey(key, 'end')) return last
  return undefined
}

/** Short fixed lists (modes, presets) jump to the ends on PgUp/PgDn. */
export function navigateShortList(key: TuiKeyEvent, index: number, count: number): number | undefined {
  const last = Math.max(0, count - 1)
  if (isKey(key, 'up', 'ctrl+p')) return Math.max(0, index - 1)
  if (isKey(key, 'down', 'ctrl+n')) return Math.min(last, index + 1)
  if (isKey(key, 'home', 'pageUp')) return 0
  if (isKey(key, 'end', 'pageDown')) return last
  return undefined
}

export function visibleWindow<T>(values: readonly T[], selected: number, size: number): Array<{ value: T; index: number }> {
  const start = Math.max(0, Math.min(selected - Math.floor(size / 2), Math.max(0, values.length - size)))
  return values.slice(start, start + size).map((value, offset) => ({ value, index: start + offset }))
}

/**
 * Rows available to a list after the page chrome (breadcrumb, rules,
 * description, footer) and the page's own fixed rows are subtracted.
 */
export function listCapacity(size: PageSize, reservedRows: number, minimum = 4): number {
  return Math.max(minimum, size.height - 7 - reservedRows)
}
