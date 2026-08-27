import type { TurnItem } from '../contracts/items.js'
import {
  applyModelContextBaseline,
  squashModelContextHistory
} from './model-context-squash.js'

export function effectiveHistoryAfterLatestCompaction(items: readonly TurnItem[]): TurnItem[] {
  for (let index = items.length - 1; index >= 0; index -= 1) {
    const item = items[index]
    if (item.kind === 'compaction' && item.replacedTokens > 0) {
      return items.slice(index)
    }
  }
  return [...items]
}

/**
 * Replace historical `model_context` deltas that precede the new summary
 * with one canonical baseline. The active turn's capsules (after the
 * summary position) keep their exact bytes for crash/resume replay.
 */
export function insertCompactionIntoVisibleHistory(input: {
  visibleItems: readonly TurnItem[]
  compactedItems: readonly TurnItem[]
  summaryItem: TurnItem
  threadId?: string
  activeTurnId?: string
  nowIso?: () => string
}): TurnItem[] {
  const summaryIndex = input.compactedItems.findIndex((item) => item.id === input.summaryItem.id)
  if (summaryIndex < 0) {
    return replaceOrAppendItem(input.visibleItems, input.summaryItem)
  }

  // Internal model records (goal context and interruption checkpoints) are
  // durable model history. `ContextCompactor` intentionally positions them
  // immediately after the new summary, but the public transcript insertion
  // path otherwise preserves folded items before that summary. Do not let
  // internal records choose the insertion point: doing so would leave folded
  // visible items after the summary and replay them again.
  let internalRecords = uniqueInternalRecords([
    ...input.compactedItems,
    ...input.visibleItems
  ])
  if (input.threadId && input.nowIso) {
    const squash = squashModelContextHistory({
      threadId: input.threadId,
      turnId: input.summaryItem.turnId,
      history: internalRecords,
      ...(input.activeTurnId ? { activeTurnId: input.activeTurnId } : {}),
      nowIso: input.nowIso
    })
    internalRecords = applyModelContextBaseline(internalRecords, squash)
  }
  const tailIds = new Set(
    input.compactedItems
      .slice(summaryIndex + 1)
      .filter((item) => !isInternalRecord(item))
      .map((item) => item.id)
  )
  // A new canonical summary replaces every earlier visible compaction
  // marker in the active window; keeping them nested the transcript and
  // re-fed previous summaries into the next compaction.
  const foldedSummaryIds = new Set<string>()
  for (const item of input.visibleItems) {
    if (item.kind === 'compaction' && item.replacedTokens > 0 && item.id !== input.summaryItem.id) {
      foldedSummaryIds.add(item.id)
    }
  }
  const withoutSummary = input.visibleItems.filter(
    (item) => item.id !== input.summaryItem.id && !isInternalRecord(item) && !foldedSummaryIds.has(item.id)
  )
  if (tailIds.size === 0) return [...withoutSummary, input.summaryItem, ...internalRecords]

  const insertIndex = withoutSummary.findIndex((item) => tailIds.has(item.id))
  if (insertIndex < 0) return [...withoutSummary, input.summaryItem, ...internalRecords]

  return [
    ...withoutSummary.slice(0, insertIndex),
    input.summaryItem,
    ...internalRecords,
    ...withoutSummary.slice(insertIndex)
  ]
}

function isInternalRecord(item: TurnItem): boolean {
  return item.kind === 'goal_context' || item.kind === 'model_context' ||
    item.kind === 'runtime_context_source' || item.kind === 'interruption_note'
}

function uniqueInternalRecords(items: readonly TurnItem[]): TurnItem[] {
  const seen = new Set<string>()
  const contexts: TurnItem[] = []
  for (const item of items) {
    if (!isInternalRecord(item) || seen.has(item.id)) continue
    seen.add(item.id)
    contexts.push(item)
  }
  return contexts
}

function replaceOrAppendItem(items: readonly TurnItem[], item: TurnItem): TurnItem[] {
  const index = items.findIndex((existing) => existing.id === item.id)
  if (index < 0) return [...items, item]
  return items.map((existing) => (existing.id === item.id ? item : existing))
}

/**
 * Restore compaction markers to their chronological position for a
 * renderer-facing turn bucket.
 *
 * The canonical session layout intentionally inserts a compaction summary
 * before the retained model-history tail. The UI mirror must not reuse that
 * model-facing order or force the marker to the end of the turn: either choice
 * can put work performed after compaction above the marker. Only compaction
 * items move here; every other item keeps its established relative order.
 */
export function placeCompactionsChronologically(items: readonly TurnItem[]): TurnItem[] {
  const indexed = items.map((item, sourceIndex) => ({ item, sourceIndex }))
  const compactions = indexed.filter(({ item }) => isVisibleCompaction(item))
  if (compactions.length === 0) return [...items]

  const timeline = indexed.filter(({ item }) => !isVisibleCompaction(item))
  const turnOwnerItemIds = new Map<string, string>()
  for (const { item } of indexed) {
    if (item.kind === 'user_message' && !turnOwnerItemIds.has(item.turnId)) {
      turnOwnerItemIds.set(item.turnId, item.id)
    }
  }
  compactions.sort(compareTimelineEntries)

  for (const compaction of compactions) {
    const insertIndex = timeline.findIndex((candidate) =>
      timelineEntryFollowsCompaction(
        candidate,
        compaction,
        turnOwnerItemIds.get(compaction.item.turnId)
      )
    )
    timeline.splice(insertIndex < 0 ? timeline.length : insertIndex, 0, compaction)
  }
  return timeline.map(({ item }) => item)
}

type TimelineEntry = {
  item: TurnItem
  sourceIndex: number
}

function timelineTimestamp(value: string): number | null {
  const timestamp = Date.parse(value)
  return Number.isFinite(timestamp) ? timestamp : null
}

function compareTimelineEntries(left: TimelineEntry, right: TimelineEntry): number {
  const leftTimestamp = timelineTimestamp(left.item.createdAt)
  const rightTimestamp = timelineTimestamp(right.item.createdAt)
  if (leftTimestamp !== null && rightTimestamp !== null && leftTimestamp !== rightTimestamp) {
    return leftTimestamp - rightTimestamp
  }
  return left.sourceIndex - right.sourceIndex
}

function timelineEntryFollowsCompaction(
  candidate: TimelineEntry,
  compaction: TimelineEntry,
  turnOwnerItemId: string | undefined
): boolean {
  const candidateTimestamp = timelineTimestamp(candidate.item.createdAt)
  const compactionTimestamp = timelineTimestamp(compaction.item.createdAt)
  if (
    candidateTimestamp !== null &&
    compactionTimestamp !== null &&
    candidateTimestamp !== compactionTimestamp
  ) {
    return candidateTimestamp > compactionTimestamp
  }

  // The model-facing insertion can place the summary immediately before the
  // retained user message. At an equal/invalid timestamp, keep that turn owner
  // before the UI marker and use stable source order for every other item.
  if (
    candidate.item.kind === 'user_message' &&
    candidate.item.id === turnOwnerItemId
  ) {
    return false
  }
  return candidate.sourceIndex > compaction.sourceIndex
}

function isVisibleCompaction(item: TurnItem): boolean {
  return item.kind === 'compaction' && item.replacedTokens > 0
}
