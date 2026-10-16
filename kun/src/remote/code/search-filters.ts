import { z } from 'zod'
/** UTC epoch milliseconds: lower bound inclusive, upper bound exclusive. */
export const UpdatedTime = z.number().int().min(0).max(253402300799999)
export type UpdatedRange = { updatedFrom?: number; updatedBefore?: number }
export function validUpdatedRange(value: UpdatedRange): boolean {
  return value.updatedFrom === undefined || value.updatedBefore === undefined || value.updatedFrom < value.updatedBefore
}
export function matchesUpdatedRange(thread: { updatedAt: string }, range: UpdatedRange): boolean {
  if (range.updatedFrom === undefined && range.updatedBefore === undefined) return true
  const time = Date.parse(thread.updatedAt)
  return Number.isFinite(time) && (range.updatedFrom === undefined || time >= range.updatedFrom) &&
    (range.updatedBefore === undefined || time < range.updatedBefore)
}
