import type { TurnItem } from '../contracts/items.js'

/** Replace the archived visible head with one summary while preserving durable internal records and tail. */
export function buildArchivedActiveHistory(
  compactedItems: readonly TurnItem[],
  summaryItem: TurnItem,
  retainedTail: readonly TurnItem[]
): TurnItem[] {
  const retainedIds = new Set(retainedTail.map((item) => item.id))
  const internalRecords = compactedItems.filter((item) =>
    item.id !== summaryItem.id && !retainedIds.has(item.id) && isInternalArchiveRecord(item)
  )
  return [summaryItem, ...internalRecords, ...retainedTail]
}

function isInternalArchiveRecord(item: TurnItem): boolean {
  return item.kind === 'goal_context' || item.kind === 'model_context' ||
    item.kind === 'runtime_context_source' || item.kind === 'interruption_note'
}
