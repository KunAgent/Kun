import {
  CONTEXT_WINDOWS_PAGE_DEFAULT,
  HistoryListItemsArgsSchema,
  HistoryListWindowsArgsSchema,
  HistoryReadItemArgsSchema,
  HistorySearchContentsArgsSchema,
  type HistoryAttachmentReference,
  type HistoryItemReadResult,
  type HistoryItemSummary,
  type HistoryListItemsResult,
  type HistoryListWindowsResult,
  type HistorySearchContentsResult,
  type HistoryWindowSummary
} from '../contracts/context-windows.js'
import {
  ContextWindowTransitionReasonSchema,
  ContextWindowTurnItem,
  isPublicTurnItem,
  type ContextWindowSplitPosition,
  type ContextWindowTransitionReason,
  type TurnItem
} from '../contracts/items.js'
import type { IdGenerator } from '../ports/id-generator.js'
import type { SessionStore } from '../ports/session-store.js'
import { rewriteItemHistoryWithRetry } from './history-commit-coordinator.js'
import {
  collectWindowRecords,
  itemHistoryText,
  WINDOW_ZERO_ID,
  type WindowRecord
} from './context-window-index.js'
import { decodeOffsetCursor, encodeOffsetCursor } from './context-window-cursor.js'
import { matchSnippets, segmentRead } from './context-window-text.js'
import { ContextWindowNotes } from './context-window-notes.js'

const SCAN_PAGE_ITEMS = 200
const SCAN_PAGE_BYTES = 16 * 1024 * 1024
const SCAN_MAX_PAGES = 10_000
const SEARCH_SNIPPETS_PER_ITEM = 3

export type CommitWindowCheckpointInput = {
  threadId: string
  turnId: string
  windowId: string
  previousWindowId?: string | null
  reason: ContextWindowTransitionReason
  initializationRef: string
  operationId: string
  replacedTokens?: number
  /** Cut position; defaults to appending the boundary at the end. */
  splitBefore?: ContextWindowSplitPosition
  signal?: AbortSignal
}

export type CommitWindowCheckpointResult =
  | { status: 'committed'; item: ContextWindowTurnItem; revision: number }
  | { status: 'replayed'; item: ContextWindowTurnItem }
  | { status: 'cancelled' }
  | { status: 'conflict' }

/**
 * Local, on-demand history and window-index queries plus the durable window
 * boundary commit. The window index records item ranges and is derived from
 * the canonical session item stream in bounded newest-first pages; raw
 * conversation data is never copied into a second store and events.jsonl is
 * never the history source. Notes live behind ContextWindowNotes.
 */
export class ContextWindowService {
  private readonly sessionStore: SessionStore
  readonly notes: ContextWindowNotes
  private readonly ids?: IdGenerator
  private readonly nowIso: () => string
  private readonly resolveAttachment?: (
    threadId: string,
    attachmentId: string
  ) => Promise<Omit<HistoryAttachmentReference, 'access'> & { access: 'allowed' | 'denied' } | null>

  constructor(deps: {
    sessionStore: SessionStore
    notes: ContextWindowNotes
    ids?: IdGenerator
    nowIso?: () => string
    resolveAttachment?: ContextWindowService['resolveAttachment']
  }) {
    this.sessionStore = deps.sessionStore
    this.notes = deps.notes
    this.ids = deps.ids
    this.nowIso = deps.nowIso ?? (() => new Date().toISOString())
    this.resolveAttachment = deps.resolveAttachment
  }

  /**
   * Bounded newest-first page chunks of the canonical public history. Each
   * chunk is chronological internally; chunks arrive newest-first.
   */
  private async *loadItemPages(threadId: string): AsyncGenerator<readonly TurnItem[], void, undefined> {
    if (!this.sessionStore.loadItemPage) {
      yield (await this.sessionStore.loadItems(threadId)).filter(isPublicTurnItem)
      return
    }
    let before: string | undefined
    for (let pageCount = 0; pageCount < SCAN_MAX_PAGES; pageCount += 1) {
      const page = await this.sessionStore.loadItemPage(threadId, {
        ...(before ? { before } : {}),
        maxItems: SCAN_PAGE_ITEMS,
        maxBytes: SCAN_PAGE_BYTES
      })
      yield page.items
      if (!page.hasMore || !page.nextCursor) return
      before = page.nextCursor
    }
  }

  /**
   * True newest-first walk of the public item stream: page chunks arrive
   * newest-first and each chunk is chronological internally, so items are
   * yielded within each page in reverse. Order-neutral consumers (operation
   * idempotency scans) can iterate `loadItemPages` directly.
   */
  private async *streamPublicItemsNewestFirst(threadId: string): AsyncGenerator<TurnItem, void, undefined> {
    for await (const page of this.loadItemPages(threadId)) {
      for (let index = page.length - 1; index >= 0; index -= 1) {
        const item = page[index]!
        if (isPublicTurnItem(item)) yield item
      }
    }
  }

  /** Public item count of a thread via bounded pages (no full-array reads). */
  async historyPosition(threadId: string): Promise<number> {
    let count = 0
    for await (const page of this.loadItemPages(threadId)) {
      for (const item of page) {
        if (isPublicTurnItem(item)) count += 1
      }
    }
    return count
  }

  private async windowRecords(threadId: string): Promise<WindowRecord[]> {
    return collectWindowRecords(this.streamPublicItemsNewestFirst(threadId))
  }

  private static toWindowSummary(record: WindowRecord): HistoryWindowSummary {
    return {
      windowId: record.windowId,
      windowSeq: record.windowSeq,
      reason: record.reason,
      createdAt: record.createdAt,
      seq: record.windowSeq,
      itemRange: {
        firstItemId: record.firstItemId,
        lastItemId: record.lastItemId,
        itemCount: record.itemCount
      }
    }
  }

  async listWindows(threadId: string, rawArgs?: unknown): Promise<HistoryListWindowsResult> {
    const args = HistoryListWindowsArgsSchema.parse(rawArgs ?? {})
    const pageSize = args.pageSize ?? CONTEXT_WINDOWS_PAGE_DEFAULT
    const offset = decodeOffsetCursor(args.cursor, `history:windows:${threadId}`)
    if (offset instanceof Error) throw offset
    const records = await this.windowRecords(threadId)
    const newestFirst = [...records].reverse()
    const page = newestFirst.slice(offset, offset + pageSize)
    const nextOffset = offset + page.length
    return {
      windows: page.map((record) => ContextWindowService.toWindowSummary(record)),
      nextCursor: nextOffset < newestFirst.length
        ? encodeOffsetCursor(`history:windows:${threadId}`, nextOffset)
        : null
    }
  }

  private async requireWindowRecords(
    threadId: string,
    windowId: string
  ): Promise<{ records: WindowRecord[]; record: WindowRecord }> {
    const records = await this.windowRecords(threadId)
    const record = records.find((entry) => entry.windowId === windowId)
    if (!record) throw new Error(`window not found: ${windowId}`)
    return { records, record }
  }

  /**
   * Chronological stream of one window's retained items. The session store
   * only pages backward (`before` cursor), and each page is chronological
   * internally, so the span from `anchorItemId` (exclusive; the boundary
   * directly above the window, or the stream top for the newest window)
   * down to `stopBoundaryItemId` (exclusive; the boundary that opens the
   * window, or none for window 0) is collected as store-bounded page chunks
   * — each walked newest-first, never flattened into one resident array —
   * and replayed oldest chunk first. The buffer holds at most the window
   * span plus one page.
   */
  private async *streamWindowRangeItems(
    threadId: string,
    anchorItemId: string | null,
    stopBoundaryItemId: string | null
  ): AsyncGenerator<TurnItem, void, undefined> {
    if (!this.sessionStore.loadItemPage) {
      const all = (await this.sessionStore.loadItems(threadId)).filter(isPublicTurnItem)
      const start = anchorItemId
        ? all.findIndex((item) => item.id === anchorItemId)
        : all.length
      for (const item of all.slice(start < 0 ? 0 : start + 1)) {
        if (stopBoundaryItemId !== null && item.id === stopBoundaryItemId) return
        yield item
      }
      return
    }
    const chunks: TurnItem[][] = []
    let stopped = false
    let before = anchorItemId
    for (let pageCount = 0; pageCount < SCAN_MAX_PAGES && !stopped; pageCount += 1) {
      const page = await this.sessionStore.loadItemPage(threadId, {
        ...(before ? { before } : {}),
        maxItems: SCAN_PAGE_ITEMS,
        maxBytes: SCAN_PAGE_BYTES
      })
      const chunk: TurnItem[] = []
      for (let index = page.items.length - 1; index >= 0; index -= 1) {
        const item = page.items[index]!
        if (stopBoundaryItemId !== null && item.id === stopBoundaryItemId) {
          stopped = true
          break
        }
        chunk.push(item)
      }
      if (chunk.length > 0) chunks.push(chunk)
      if (!page.hasMore || !page.nextCursor) break
      before = page.nextCursor
    }
    for (const chunk of chunks.reverse()) {
      for (let index = chunk.length - 1; index >= 0; index -= 1) yield chunk[index]!
    }
  }

  /**
   * Stream the items of one window in chronological order. The walk stays
   * between the boundary above the window and the boundary that opens it,
   * and stops after the window's recorded item count, so it never
   * materializes the whole thread history.
   */
  private async *streamWindowItems(
    threadId: string,
    records: readonly WindowRecord[],
    record: WindowRecord
  ): AsyncGenerator<{ item: TurnItem; seq: number }, void, undefined> {
    if (record.itemCount === 0) return
    const index = records.findIndex((entry) => entry.windowId === record.windowId)
    let baseSeq = index
    for (let position = 0; position < index; position += 1) {
      baseSeq += records[position]!.itemCount
    }
    const newer = records[index + 1]
    let seq = baseSeq
    let emitted = 0
    for await (const item of this.streamWindowRangeItems(
      threadId,
      newer?.itemId ?? null,
      record.itemId
    )) {
      if (item.kind === 'context_window') continue
      yield { item, seq }
      seq += 1
      emitted += 1
      if (emitted >= record.itemCount) return
    }
  }

  async listItems(threadId: string, rawArgs: unknown): Promise<HistoryListItemsResult> {
    const args = HistoryListItemsArgsSchema.parse(rawArgs)
    const pageSize = args.pageSize ?? CONTEXT_WINDOWS_PAGE_DEFAULT
    const offset = decodeOffsetCursor(args.cursor, `history:items:${threadId}:${args.windowId}`)
    if (offset instanceof Error) throw offset
    const { records, record } = await this.requireWindowRecords(threadId, args.windowId)
    const items: HistoryItemSummary[] = []
    let scanned = 0
    for await (const entry of this.streamWindowItems(threadId, records, record)) {
      if (scanned >= offset) {
        items.push({
          itemId: entry.item.id,
          kind: entry.item.kind,
          role: entry.item.role,
          seq: entry.seq,
          createdAt: entry.item.createdAt
        })
      }
      scanned += 1
      if (items.length >= pageSize) break
    }
    return {
      windowId: args.windowId,
      items,
      nextCursor: offset + items.length < record.itemCount
        ? encodeOffsetCursor(`history:items:${threadId}:${args.windowId}`, offset + items.length)
        : null
    }
  }

  async readItem(threadId: string, rawArgs: unknown): Promise<HistoryItemReadResult> {
    const args = HistoryReadItemArgsSchema.parse(rawArgs)
    const { records, record } = await this.requireWindowRecords(threadId, args.windowId)
    const offset = args.cursor !== undefined
      ? decodeOffsetCursor(args.cursor, `history:read:${threadId}:${args.windowId}:${args.itemId}`)
      : (args.offset ?? 0)
    if (offset instanceof Error) throw offset
    let target: TurnItem | null = null
    for await (const entry of this.streamWindowItems(threadId, records, record)) {
      if (entry.item.id === args.itemId) { target = entry.item; break }
    }
    if (!target) throw new Error(`history item not found in window ${args.windowId}: ${args.itemId}`)
    const read = segmentRead(itemHistoryText(target), offset)
    return {
      windowId: args.windowId,
      itemId: args.itemId,
      segments: read.segments,
      attachments: await this.attachmentReferences(threadId, target),
      truncated: read.truncated,
      nextCursor: read.nextOffset !== null
        ? encodeOffsetCursor(`history:read:${threadId}:${args.windowId}:${args.itemId}`, read.nextOffset)
        : null,
      nextOffset: read.nextOffset
    }
  }

  private async attachmentReferences(
    threadId: string,
    item: TurnItem
  ): Promise<HistoryAttachmentReference[]> {
    const ids = 'attachmentIds' in item && Array.isArray(item.attachmentIds) ? item.attachmentIds : []
    const refs: HistoryAttachmentReference[] = []
    for (const attachmentId of ids) {
      const resolved = this.resolveAttachment
        ? await this.resolveAttachment(threadId, attachmentId)
        : null
      refs.push(resolved ?? { attachmentId, byteSize: 0, access: 'denied' })
    }
    return refs
  }

  async searchContents(threadId: string, rawArgs: unknown): Promise<HistorySearchContentsResult> {
    const args = HistorySearchContentsArgsSchema.parse(rawArgs)
    const pageSize = args.pageSize ?? CONTEXT_WINDOWS_PAGE_DEFAULT
    const offset = decodeOffsetCursor(
      args.cursor,
      `history:search:${threadId}:${args.windowId ?? ''}:${args.query}`
    )
    if (offset instanceof Error) throw offset
    const records = await this.windowRecords(threadId)
    const record = args.windowId
      ? (records.find((entry) => entry.windowId === args.windowId) ?? null)
      : null
    if (args.windowId && !record) throw new Error(`window not found: ${args.windowId}`)
    const needle = args.query.toLowerCase()
    const matches: HistorySearchContentsResult['matches'] = []
    let scanned = 0
    let pageFull = false
    for await (const hit of this.streamSearchItems(threadId, records, record)) {
      if (scanned < offset) { scanned += 1; continue }
      scanned += 1
      const snippets = matchSnippets(itemHistoryText(hit.item), needle, SEARCH_SNIPPETS_PER_ITEM)
      if (snippets.length > 0) {
        matches.push({ windowId: hit.windowId, itemId: hit.item.id, snippets })
        if (matches.length >= pageSize) { pageFull = true; break }
      }
    }
    return {
      query: args.query,
      matches,
      nextCursor: pageFull
        ? encodeOffsetCursor(`history:search:${threadId}:${args.windowId ?? ''}:${args.query}`, scanned)
        : null
    }
  }

  /**
   * Search stream yielding every retained item in chronological order with
   * the id of the window that contains it. Scoped searches stay inside one
   * window's item range.
   */
  private async *streamSearchItems(
    threadId: string,
    records: readonly WindowRecord[],
    record: WindowRecord | null
  ): AsyncGenerator<{ item: TurnItem; windowId: string }, void, undefined> {
    const targets = record ? [record] : records
    for (const target of targets) {
      for await (const entry of this.streamWindowItems(threadId, records, target)) {
        yield { item: entry.item, windowId: target.windowId }
      }
    }
  }

  /** True when a committed boundary already carries this operation id. */
  async hasWindowOperation(threadId: string, operationId: string): Promise<boolean> {
    for await (const page of this.loadItemPages(threadId)) {
      for (const item of page) {
        if (item.kind === 'context_window' && item.operationId === operationId) return true
      }
    }
    return false
  }

  /**
   * Revision-atomic commit of a `context_window` checkpoint. The transform
   * only inserts the boundary item, so raw history is never rewritten: a cut
   * cannot drop concurrently appended input, a commit conflict rebuilds the
   * pure insert from the latest snapshot, and a write failure before the CAS
   * leaves the original window untouched. Replaying a committed operationId
   * returns the already committed boundary.
   */
  async commitWindowCheckpoint(input: CommitWindowCheckpointInput): Promise<CommitWindowCheckpointResult> {
    const reason = ContextWindowTransitionReasonSchema.parse(input.reason)
    const buildItem = (sourceHistoryRevision: number): ContextWindowTurnItem =>
      ContextWindowTurnItem.parse({
        id: this.ids?.next('context_window') ?? `context_window_${input.operationId}`,
        turnId: input.turnId,
        threadId: input.threadId,
        role: 'system',
        status: 'completed',
        createdAt: this.nowIso(),
        kind: 'context_window',
        schemaVersion: 1,
        windowId: input.windowId,
        previousWindowId: input.previousWindowId ?? null,
        reason,
        sourceHistoryRevision,
        splitBefore: input.splitBefore ?? { kind: 'seq', seq: Number.MAX_SAFE_INTEGER },
        initializationRef: input.initializationRef,
        operationId: input.operationId,
        replacedTokens: Math.max(0, Math.floor(input.replacedTokens ?? 0))
      })

    // Idempotency: an earlier attempt (or a concurrent racing peer) may have
    // committed this operation already.
    for await (const page of this.loadItemPages(input.threadId)) {
      for (const item of page) {
        if (item.kind === 'context_window' && item.operationId === input.operationId) {
          return { status: 'replayed', item }
        }
      }
    }

    const committed = await rewriteItemHistoryWithRetry<{ item: ContextWindowTurnItem; cancelled: boolean }>({
      sessionStore: this.sessionStore,
      threadId: input.threadId,
      maxAttempts: 3,
      build: (snapshot) => {
        const existing = snapshot.items.find(
          (item) => item.kind === 'context_window' && item.operationId === input.operationId
        )
        if (existing && existing.kind === 'context_window') {
          return { changed: false, items: snapshot.items, value: { item: existing, cancelled: false } }
        }
        if (input.signal?.aborted) {
          return { changed: false, items: snapshot.items, value: { item: buildItem(snapshot.revision), cancelled: true } }
        }
        const item = buildItem(snapshot.revision)
        const cut = resolveCutIndex(snapshot.items, input.splitBefore)
        const items = [...snapshot.items.slice(0, cut), item, ...snapshot.items.slice(cut)]
        return { changed: true, items, value: { item, cancelled: false } }
      }
    })
    if (committed.status === 'applied') {
      return { status: 'committed', item: committed.value.item, revision: committed.revision }
    }
    if (committed.status === 'unchanged') {
      return committed.value.cancelled
        ? { status: 'cancelled' }
        : { status: 'replayed', item: committed.value.item }
    }
    return { status: 'conflict' }
  }

  /**
   * Fork snapshot: only note versions committed at or before the fork point
   * are copied to the child, and the child's current content is derived by
   * replaying exactly those versions; later parent writes stay private. The
   * lifecycle persists the child's cloned history before onForked fires, so
   * the child's public item count is exactly the parent's fork-point
   * position and serves as the cutoff.
   */
  async forkThreadData(sourceThreadId: string, targetThreadId: string): Promise<void> {
    const cutoffItemSeq = await this.historyPosition(targetThreadId)
    await this.notes.forkThreadData(sourceThreadId, targetThreadId, cutoffItemSeq)
  }

  /** Cascade delete of feature-owned data through the existing lifecycle. */
  async deleteThreadData(threadId: string): Promise<void> {
    await this.notes.deleteThreadData(threadId)
  }
}

function resolveCutIndex(
  items: readonly TurnItem[],
  splitBefore: ContextWindowSplitPosition | undefined
): number {
  if (!splitBefore) return items.length
  if (splitBefore.kind === 'seq') {
    return Math.min(Math.max(0, Math.floor(splitBefore.seq)), items.length)
  }
  const index = items.findIndex((item) => item.id === splitBefore.itemId)
  return index < 0 ? items.length : index
}
