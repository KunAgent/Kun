import type { TurnItem } from '../contracts/items.js'
import type { ContextWindowListingReason } from '../contracts/context-windows.js'

/** Stable id of the synthetic window that holds pre-boundary retained history. */
export const WINDOW_ZERO_ID = 'win-0'

export type WindowRecord = {
  windowId: string
  windowSeq: number
  reason: ContextWindowListingReason
  /** Boundary checkpoint item id; null for the synthetic window 0. */
  itemId: string | null
  createdAt: string
  sourceHistoryRevision: number | null
  operationId: string | null
  firstItemId: string | null
  firstItemCreatedAt: string
  lastItemId: string | null
  itemCount: number
}

/** Window accumulator used while folding the newest-first item stream. */
type PendingWindow = {
  record: WindowRecord
  /** Oldest item seen so far for this window (first item once finalized). */
  oldestId: string | null
  oldestCreatedAt: string
}

type FoldState = {
  sealed: WindowRecord[]
  pending: PendingWindow
  sawAnyItem: boolean
}

function provisionalRecord(): WindowRecord {
  return {
    windowId: WINDOW_ZERO_ID,
    windowSeq: 0,
    reason: 'initial',
    itemId: null,
    createdAt: '',
    sourceHistoryRevision: null,
    operationId: null,
    firstItemId: null,
    firstItemCreatedAt: '',
    lastItemId: null,
    itemCount: 0
  }
}

function boundaryRecord(item: Extract<TurnItem, { kind: 'context_window' }>): WindowRecord {
  return {
    windowId: item.windowId,
    windowSeq: 0,
    reason: item.reason as ContextWindowListingReason,
    itemId: item.id,
    createdAt: item.createdAt,
    sourceHistoryRevision: item.sourceHistoryRevision,
    operationId: item.operationId,
    firstItemId: null,
    firstItemCreatedAt: '',
    lastItemId: null,
    itemCount: 0
  }
}

function newFoldState(): FoldState {
  return {
    sealed: [],
    pending: { record: provisionalRecord(), oldestId: null, oldestCreatedAt: '' },
    sawAnyItem: false
  }
}

function finalizeFirstItem(pending: PendingWindow): void {
  if (pending.oldestId === null) return
  pending.record.firstItemId = pending.oldestId
  pending.record.firstItemCreatedAt = pending.oldestCreatedAt
  if (pending.record.windowSeq === 0 && !pending.record.createdAt) {
    pending.record.createdAt = pending.oldestCreatedAt
  }
}

/**
 * Fold one item of the NEWEST-first public stream (that is the only bounded
 * paging direction the session store offers): regular items extend the
 * pending window on its oldest side; a boundary item seals the pending
 * window as the window it opens and starts a fresh pending window.
 */
function foldItem(state: FoldState, item: TurnItem): void {
  state.sawAnyItem = true
  if (item.kind === 'context_window') {
    finalizeFirstItem(state.pending)
    const range = {
      firstItemId: state.pending.record.firstItemId,
      firstItemCreatedAt: state.pending.record.firstItemCreatedAt,
      lastItemId: state.pending.record.lastItemId,
      itemCount: state.pending.record.itemCount
    }
    state.sealed.push({ ...boundaryRecord(item), ...range })
    state.pending = { record: provisionalRecord(), oldestId: null, oldestCreatedAt: '' }
    return
  }
  if (state.pending.record.itemCount === 0) state.pending.record.lastItemId = item.id
  state.pending.record.itemCount += 1
  state.pending.oldestId = item.id
  state.pending.oldestCreatedAt = item.createdAt
}

/** Seal the remaining pending window as window 0 and order chronologically. */
function finishFold(state: FoldState): WindowRecord[] {
  if (!state.sawAnyItem) return []
  finalizeFirstItem(state.pending)
  return [state.pending.record, ...state.sealed.reverse()].map((record, index) => ({
    ...record,
    windowSeq: index
  }))
}

/**
 * Derive the window index from a chronological (oldest-first) public item
 * array. Prefer `collectWindowRecords` for store streams so history is never
 * materialized as one array.
 */
export function computeWindowRecords(publicItems: readonly TurnItem[]): WindowRecord[] {
  const state = newFoldState()
  for (let index = publicItems.length - 1; index >= 0; index -= 1) {
    foldItem(state, publicItems[index]!)
  }
  return finishFold(state)
}

/**
 * Streaming variant used by the service. The canonical item history is
 * paged newest-first by the session store; only window records are
 * retained, never the items themselves.
 */
export async function collectWindowRecords(
  items: AsyncIterable<TurnItem>
): Promise<WindowRecord[]> {
  const state = newFoldState()
  for await (const item of items) foldItem(state, item)
  return finishFold(state)
}

/** Flat searchable/readable text for one history item; markers stay tiny. */
export function itemHistoryText(item: TurnItem): string {
  switch (item.kind) {
    case 'user_message':
      return item.text
    case 'assistant_text':
    case 'assistant_reasoning':
      return item.text
    case 'tool_call':
      return item.summary ?? `${item.toolName} ${JSON.stringify(item.arguments)}`
    case 'tool_result':
      return typeof item.output === 'string' ? item.output : JSON.stringify(item.output)
    case 'compaction':
      return item.summary
    case 'context_window':
      return `[context window ${item.windowId} reason=${item.reason}]`
    case 'approval':
      return item.summary
    case 'user_input':
      return item.prompt
    case 'review':
      return item.reviewText ?? item.title
    case 'error':
      return item.message
    default:
      return ''
  }
}

export function isContextWindowItem(item: TurnItem): item is Extract<TurnItem, { kind: 'context_window' }> {
  return item.kind === 'context_window'
}
