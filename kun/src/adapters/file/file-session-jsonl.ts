import { randomUUID } from 'node:crypto'
import { createReadStream } from 'node:fs'
import { rm, stat, type FileHandle } from 'node:fs/promises'
import { RuntimeEvent as RuntimeEventSchema, type RuntimeEvent } from '../../contracts/events.js'
import { isPublicTurnItem, type TurnItem } from '../../contracts/items.js'
import type { ItemHistoryPage, ItemHistoryPageOptions } from '../../ports/session-store.js'
import { buildPublicItemHistoryPage, timelineSafeItem } from '../../services/item-history-page.js'
import { yieldToEventLoop } from '../hybrid/hybrid-thread-support.js'
import { renameFileWithRetry } from './atomic-write.js'
import { writeJsonlLines, type CreateJsonlWriteStream } from './jsonl-write-stream.js'

const MS_PER_DAY = 86_400_000
const DEFAULT_ITEM_HISTORY_MAX_RECORD_BYTES = 16 * 1024 * 1024
// A valid model tool argument may contain 1 MiB of JSON, whose escaping can
// nearly double the persisted item event. Unresolved `__raw` strings are
// summarized before persistence, while replay remains bounded for valid calls.
export const DEFAULT_EVENT_REPLAY_MAX_RECORD_BYTES = 4 * 1024 * 1024
/** Let lease/heartbeat timers run while parsing large append-only logs. */
const YIELD_EVERY_LINES = 64

export function compactUsageEvents(
  events: RuntimeEvent[],
  options: { nowIso: string; retentionDays: number }
): RuntimeEvent[] {
  const cutoffMs = Date.parse(options.nowIso) - options.retentionDays * MS_PER_DAY
  if (!Number.isFinite(cutoffMs)) return events
  const usageByIndex = new Map<number, RuntimeEvent>()
  for (let index = 0; index < events.length; index += 1) {
    const event = events[index]
    if (event?.kind === 'usage') usageByIndex.set(index, event)
  }
  if (usageByIndex.size === 0) return events
  const keepUsage = retainedUsageIndexes(usageByIndex, cutoffMs)
  return events.filter((event, index) => event.kind !== 'usage' || keepUsage.has(index))
}

/**
 * Compact usage rows in an events.jsonl without materializing the whole file.
 * Pass 1 keeps only usage events in memory; pass 2 streams a filtered rewrite.
 */
export async function compactUsageEventsJsonlFile(
  path: string,
  options: {
    nowIso: string
    retentionDays: number
    maxRecordBytes: number
    commitReplacement?: (replace: () => Promise<void>) => Promise<boolean>
    withSourceRead?: <T>(operation: () => Promise<T>) => Promise<T>
    createWriteStream?: CreateJsonlWriteStream
  }
): Promise<boolean> {
  const cutoffMs = Date.parse(options.nowIso) - options.retentionDays * MS_PER_DAY
  if (!Number.isFinite(cutoffMs)) return false

  const usageByIndex = new Map<number, RuntimeEvent>()
  let lineIndex = 0
  await withSourceRead(options, async () => {
    for await (const record of iterateJsonlEventRecords(path, options.maxRecordBytes)) {
      if (record.event?.kind === 'usage') usageByIndex.set(lineIndex, record.event)
      lineIndex += 1
      if (lineIndex % YIELD_EVERY_LINES === 0) await yieldToEventLoop()
    }
  })
  if (usageByIndex.size === 0) return false

  const keepUsageIndexes = retainedUsageIndexes(usageByIndex, cutoffMs)
  if (keepUsageIndexes.size === usageByIndex.size) return false

  const tmp = `${path}.${process.pid}.${Date.now()}.${randomUUID()}.tmp`
  try {
    await withSourceRead(options, () => rewriteJsonlKeepingLines(path, tmp, {
      maxRecordBytes: options.maxRecordBytes,
      keepLine: (event, index) => event.kind !== 'usage' || keepUsageIndexes.has(index),
      createWriteStream: options.createWriteStream
    }))
    const replace = async (): Promise<void> => renameFileWithRetry(tmp, path)
    if (options.commitReplacement) {
      const committed = await options.commitReplacement(replace)
      return committed
    }
    await replace()
    return true
  } finally {
    // A stale snapshot deliberately declines replacement. Always remove its
    // prepared rewrite; after a successful rename this is a harmless no-op.
    await rm(tmp, { force: true }).catch(() => undefined)
  }
}

function retainedUsageIndexes(
  usageByIndex: Map<number, RuntimeEvent>,
  cutoffMs: number
): Set<number> {
  const usageIndexes = [...usageByIndex.keys()].sort((a, b) => a - b)
  let latestUsageIndex = -1
  let latestBeforeCutoffIndex = -1
  for (const index of usageIndexes) {
    latestUsageIndex = index
    const event = usageByIndex.get(index)!
    const timestamp = Date.parse(event.timestamp)
    if (Number.isFinite(timestamp) && timestamp < cutoffMs) {
      latestBeforeCutoffIndex = index
    }
  }
  const keep = new Set<number>()
  const latestUsageIndexByBucket = new Map<string, number>()
  for (const index of usageIndexes) {
    const event = usageByIndex.get(index)!
    if (!shouldRetainUsageEvent(event, index, {
      cutoffMs,
      latestUsageIndex,
      latestBeforeCutoffIndex
    })) {
      continue
    }
    const bucket = usageCoalescingBucket(event)
    const previous = latestUsageIndexByBucket.get(bucket)
    if (previous !== undefined && previous !== latestBeforeCutoffIndex) {
      keep.delete(previous)
    }
    keep.add(index)
    latestUsageIndexByBucket.set(bucket, index)
  }
  return keep
}

async function* iterateJsonlEventRecords(
  path: string,
  maxRecordBytes: number
): AsyncIterable<{ line: string; event: RuntimeEvent | null }> {
  let remainder = ''
  try {
    const stream = createReadStream(path, {
      encoding: 'utf-8',
      highWaterMark: Math.min(maxRecordBytes, 64 * 1024)
    })
    for await (const chunk of stream) {
      remainder += typeof chunk === 'string' ? chunk : chunk.toString('utf-8')
      let newline = remainder.indexOf('\n')
      while (newline >= 0) {
        const line = remainder.slice(0, newline)
        remainder = remainder.slice(newline + 1)
        if (line.trim()) {
          yield { line, event: parseReplayEventRecord(line, maxRecordBytes) }
        }
        newline = remainder.indexOf('\n')
      }
      if (Buffer.byteLength(remainder, 'utf-8') > maxRecordBytes) {
        throw new Error(`event replay record exceeds ${maxRecordBytes} bytes`)
      }
    }
    if (remainder.trim()) {
      yield { line: remainder, event: parseReplayEventRecord(remainder, maxRecordBytes) }
    }
  } catch (error) {
    if ((error as { code?: string }).code === 'ENOENT') return
    throw error
  }
}

async function rewriteJsonlKeepingLines(
  sourcePath: string,
  targetPath: string,
  options: {
    maxRecordBytes: number
    keepLine: (event: RuntimeEvent, index: number) => boolean
    createWriteStream?: CreateJsonlWriteStream
  }
): Promise<void> {
  await writeJsonlLines(targetPath, keptJsonlLines(sourcePath, options), {
    createWriteStream: options.createWriteStream
  })
}

async function* keptJsonlLines(
  sourcePath: string,
  options: { maxRecordBytes: number; keepLine: (event: RuntimeEvent, index: number) => boolean }
): AsyncIterable<string> {
  let lineIndex = 0
  for await (const record of iterateJsonlEventRecords(sourcePath, options.maxRecordBytes)) {
    if ((record.event && options.keepLine(record.event, lineIndex)) || !record.event) {
      yield `${record.line}\n`
    }
    lineIndex += 1
    if (lineIndex % YIELD_EVERY_LINES === 0) await yieldToEventLoop()
  }
}

function shouldRetainUsageEvent(
  event: RuntimeEvent,
  index: number,
  options: { cutoffMs: number; latestUsageIndex: number; latestBeforeCutoffIndex: number }
): boolean {
  if (event.kind !== 'usage') return true
  if (index === options.latestUsageIndex || index === options.latestBeforeCutoffIndex) return true
  const timestamp = Date.parse(event.timestamp)
  if (!Number.isFinite(timestamp)) return true
  return timestamp >= options.cutoffMs
}

/**
 * Rewrite `events.jsonl`, keeping only events at or after `fromSeqInclusive`.
 * Streamed two-pass so a 130 MiB log never materializes in memory; the
 * replacement uses the same atomic tmp+rename discipline as item rewrites.
 */
export async function trimEventsJsonlFromSeq(
  path: string,
  fromSeqInclusive: number,
  options: {
    maxRecordBytes: number
    commitReplacement?: (replace: () => Promise<void>) => Promise<boolean>
    withSourceRead?: <T>(operation: () => Promise<T>) => Promise<T>
    createWriteStream?: CreateJsonlWriteStream
  }
): Promise<{ trimmed: boolean; keptEvents: number }> {
  const tmp = `${path}.${process.pid}.${Date.now()}.${randomUUID()}.tmp`
  let keptEvents = 0
  try {
    await withSourceRead(options, () => writeJsonlLines(tmp, trimmedJsonlLines(
      path,
      fromSeqInclusive,
      options.maxRecordBytes,
      () => { keptEvents += 1 }
    ), { createWriteStream: options.createWriteStream }))
    const replace = async (): Promise<void> => { await renameFileWithRetry(tmp, path) }
    if (options.commitReplacement) {
      const committed = await options.commitReplacement(replace)
      return { trimmed: committed, keptEvents }
    }
    await replace()
    return { trimmed: true, keptEvents }
  } finally {
    await rm(tmp, { force: true }).catch(() => undefined)
  }
}

async function* trimmedJsonlLines(
  path: string,
  fromSeqInclusive: number,
  maxRecordBytes: number,
  onKept: () => void
): AsyncIterable<string> {
  let lineIndex = 0
  for await (const record of iterateJsonlEventRecords(path, maxRecordBytes)) {
    const keep = !record.event || record.event.seq >= fromSeqInclusive
    if (keep && record.line.trim()) {
      onKept()
      yield `${record.line}\n`
    }
    lineIndex += 1
    if (lineIndex % YIELD_EVERY_LINES === 0) await yieldToEventLoop()
  }
}

/**
 * Return the seq of the first parseable event in the log, or 0 when the log
 * is missing/empty. Used as the SSE replay floor; trimming only removes a
 * prefix, so the head record alone determines the floor.
 */
export async function firstEventSeqFromJsonl(path: string, maxRecordBytes: number): Promise<number> {
  for await (const record of iterateJsonlEventRecords(path, maxRecordBytes)) {
    if (record.event) return record.event.seq
  }
  return 0
}

/**
 * Revision-fenced event-prefix trim shared by FileSessionStore. `guards`
 * capture the store's revision/stat checks so the rewrite only commits when
 * the log is unchanged since the scan began.
 */
export async function trimEventsWithGuards(options: {
  path: string
  fromSeqInclusive: number
  maxRecordBytes: number
  info: { size: number; mtimeMs: number }
  revisionBefore: number
  readRevision: () => number
  bumpRevision: () => void
  invalidateCache: () => void
  withWrite: (operation: () => Promise<boolean>) => Promise<boolean>
  withRead: <T>(operation: () => Promise<T>) => Promise<T>
  withReplacement: <T>(operation: () => Promise<T>) => Promise<T>
  scheduleRetry: () => void
}): Promise<{ afterBytes: number }> {
  const trimmed = await trimEventsJsonlFromSeq(options.path, options.fromSeqInclusive, {
    maxRecordBytes: options.maxRecordBytes,
    withSourceRead: options.withRead,
    commitReplacement: (replace) => options.withReplacement(() => options.withWrite(async () => {
      const currentInfo = await stat(options.path).catch(() => null)
      if (
        options.readRevision() !== options.revisionBefore ||
        !currentInfo ||
        currentInfo.size !== options.info.size ||
        currentInfo.mtimeMs !== options.info.mtimeMs
      ) {
        return false
      }
      await replace()
      options.bumpRevision()
      options.invalidateCache()
      return true
    }))
  })
  if (!trimmed.trimmed) options.scheduleRetry()
  const after = await stat(options.path).catch(() => null)
  return { afterBytes: after?.size ?? 0 }
}

function withSourceRead<T>(
  options: { withSourceRead?: <Value>(operation: () => Promise<Value>) => Promise<Value> },
  operation: () => Promise<T>
): Promise<T> {
  return options.withSourceRead ? options.withSourceRead(operation) : operation()
}

function usageCoalescingBucket(event: RuntimeEvent): string {
  if (event.kind !== 'usage') return ''
  const day = Number.isFinite(Date.parse(event.timestamp))
    ? new Date(event.timestamp).toISOString().slice(0, 10)
    : event.timestamp
  return `${day}:${event.model ?? ''}`
}

export function parseReplayEventRecord(line: string, maxRecordBytes: number): RuntimeEvent | null {
  if (!line.trim()) return null
  if (Buffer.byteLength(line, 'utf-8') > maxRecordBytes) {
    throw new Error(`event replay record exceeds ${maxRecordBytes} bytes`)
  }
  try {
    const value = JSON.parse(line) as unknown
    const parsed = RuntimeEventSchema.safeParse(value)
    // Keep the existing JSONL tolerance: one corrupt historical record must
    // not poison replay of the rest of the thread.
    return parsed.success ? parsed.data : null
  } catch {
    // Keep the existing JSONL tolerance: one corrupt historical record must
    // not poison replay of the rest of the thread.
    return null
  }
}

export function warnUsageCompaction(threadId: string, error: unknown): void {
  const message = error instanceof Error ? error.message : String(error)
  console.warn(`[kun] usage event compaction failed for ${threadId}; keeping append-only log: ${message}`)
}

/** Stream durable newline-terminated runtime events from an append-only log. */
export async function* iterateRuntimeEventsJsonl(
  path: string,
  sinceSeq: number,
  maxRecordBytes: number,
  startOffset = 0
): AsyncIterable<RuntimeEvent> {
  let remainder = ''
  try {
    const stream = createReadStream(path, {
      encoding: 'utf-8',
      start: Math.max(0, startOffset),
      highWaterMark: Math.min(maxRecordBytes, 64 * 1024)
    })
    for await (const chunk of stream) {
      remainder += typeof chunk === 'string' ? chunk : chunk.toString('utf-8')
      let newline = remainder.indexOf('\n')
      while (newline >= 0) {
        const event = parseReplayEventRecord(remainder.slice(0, newline), maxRecordBytes)
        remainder = remainder.slice(newline + 1)
        if (event && event.seq > sinceSeq) yield event
        newline = remainder.indexOf('\n')
      }
      if (Buffer.byteLength(remainder, 'utf-8') > maxRecordBytes) {
        throw new Error(`event replay record exceeds ${maxRecordBytes} bytes`)
      }
    }
    // Bytes after the final newline belong to an in-flight append.
    if (remainder.trim() && Buffer.byteLength(remainder, 'utf-8') > maxRecordBytes) {
      throw new Error(`event replay record exceeds ${maxRecordBytes} bytes`)
    }
  } catch (error) {
    if ((error as { code?: string }).code !== 'ENOENT') throw error
  }
}

export async function readLatestItemsFromJsonl(
  path: string,
  options: {
    maxRecordBytes?: number
    rejectMalformed?: boolean
  } = {}
): Promise<{
  items: TurnItem[]
  rawCount: number
  malformedCount: number
  incompleteTrailingRecord: boolean
}> {
  const maxRecordBytes = Math.max(
    1,
    Math.floor(options.maxRecordBytes ?? DEFAULT_ITEM_HISTORY_MAX_RECORD_BYTES)
  )
  const latestById = new Map<string, TurnItem>()
  const firstSeenIds: string[] = []
  let remainder = ''
  let rawCount = 0
  let malformedCount = 0
  let incompleteTrailingRecord = false
  let linesSinceYield = 0

  const acceptLine = async (line: string, trailing = false): Promise<void> => {
    if (!line.trim()) return
    if (Buffer.byteLength(line, 'utf-8') > maxRecordBytes) {
      throw new Error(`item history record exceeds ${maxRecordBytes} bytes`)
    }
    try {
      const item = JSON.parse(line) as TurnItem
      if (!item || typeof item !== 'object' || typeof item.id !== 'string' || !item.id) {
        malformedCount += 1
        return
      }
      rawCount += 1
      if (!latestById.has(item.id)) firstSeenIds.push(item.id)
      latestById.set(item.id, item)
    } catch {
      if (trailing) incompleteTrailingRecord = true
      else malformedCount += 1
    }
    linesSinceYield += 1
    if (linesSinceYield >= YIELD_EVERY_LINES) {
      linesSinceYield = 0
      await yieldToEventLoop()
    }
  }

  try {
    const stream = createReadStream(path, {
      encoding: 'utf-8',
      highWaterMark: Math.min(maxRecordBytes, 64 * 1024)
    })
    for await (const chunk of stream) {
      remainder += typeof chunk === 'string' ? chunk : chunk.toString('utf-8')
      let newline = remainder.indexOf('\n')
      while (newline >= 0) {
        await acceptLine(remainder.slice(0, newline))
        remainder = remainder.slice(newline + 1)
        newline = remainder.indexOf('\n')
      }
      if (Buffer.byteLength(remainder, 'utf-8') > maxRecordBytes) {
        throw new Error(`item history record exceeds ${maxRecordBytes} bytes`)
      }
    }
    await acceptLine(remainder, true)
  } catch (error) {
    if ((error as { code?: string }).code !== 'ENOENT') throw error
  }

  const rejectedRecords = malformedCount + (incompleteTrailingRecord ? 1 : 0)
  if (options.rejectMalformed && rejectedRecords > 0) {
    throw new Error(`item history contains ${rejectedRecords} malformed record(s)`)
  }
  return {
    items: firstSeenIds.map((id) => latestById.get(id)!),
    rawCount,
    malformedCount,
    incompleteTrailingRecord
  }
}

/**
 * Scan an append-only item log without retaining every item payload. A set of
 * stable ids preserves first-seen ordering, while each rolling window keeps at
 * most one page plus a sentinel used to derive `hasMore`.
 */
export async function readItemPageFromJsonl(
  handle: FileHandle,
  sourceBytes: number,
  options: ItemHistoryPageOptions
): Promise<ItemHistoryPage> {
  const maxItems = Math.max(1, Math.floor(options.maxItems))
  const maxBytes = Math.max(1, Math.floor(options.maxBytes))
  const seenIds = new Set<string>()
  const latestWindow = createItemPageWindow()
  const beforeWindow = createItemPageWindow()
  let beforeFound = options.before === undefined
  const anchor = { item: null as TurnItem | null }
  const anchorTurnId = options.before ? undefined : options.anchorTurnId?.trim()
  let remainder = ''

  const acceptLine = (line: string): void => {
    if (!line.trim()) return
    if (Buffer.byteLength(line, 'utf-8') > DEFAULT_ITEM_HISTORY_MAX_RECORD_BYTES) {
      throw new Error(`item history record exceeds ${DEFAULT_ITEM_HISTORY_MAX_RECORD_BYTES} bytes`)
    }
    let item: TurnItem
    try {
      item = JSON.parse(line) as TurnItem
    } catch {
      return
    }
    if (!item || typeof item !== 'object' || typeof item.id !== 'string' || !item.id) return

    const safeItem = isPublicTurnItem(item) ? timelineSafeItem(item, maxBytes) : item
    const firstSeen = !seenIds.has(item.id)
    if (firstSeen) {
      seenIds.add(item.id)
      if (isPublicTurnItem(item)) {
        appendPageWindowItem(latestWindow, safeItem, maxItems, maxBytes)
        if (
          anchorTurnId &&
          !anchor.item &&
          item.kind === 'user_message' &&
          item.turnId === anchorTurnId
        ) {
          anchor.item = safeItem
        }
      }
      if (!beforeFound && item.id === options.before) {
        beforeFound = true
      } else if (!beforeFound && isPublicTurnItem(item)) {
        appendPageWindowItem(beforeWindow, safeItem, maxItems, maxBytes)
      }
      return
    }

    // Updates are appended after the original record. Refresh a retained
    // candidate in place so terminal state is current without moving its
    // original timeline position.
    if (isPublicTurnItem(item)) {
      updatePageWindowItem(latestWindow, safeItem, maxItems, maxBytes)
      updatePageWindowItem(beforeWindow, safeItem, maxItems, maxBytes)
      if (anchor.item && item.id === anchor.item.id) {
        anchor.item = safeItem
      }
    }
  }

  try {
    const stream = handle.createReadStream({
      encoding: 'utf-8',
      start: 0,
      end: sourceBytes - 1,
      autoClose: false,
      highWaterMark: 64 * 1024
    })
    try {
      for await (const chunk of stream) {
        remainder += typeof chunk === 'string' ? chunk : chunk.toString('utf-8')
        let newline = remainder.indexOf('\n')
        while (newline >= 0) {
          acceptLine(remainder.slice(0, newline))
          remainder = remainder.slice(newline + 1)
          newline = remainder.indexOf('\n')
        }
        if (Buffer.byteLength(remainder, 'utf-8') > DEFAULT_ITEM_HISTORY_MAX_RECORD_BYTES) {
          throw new Error(`item history record exceeds ${DEFAULT_ITEM_HISTORY_MAX_RECORD_BYTES} bytes`)
        }
      }
      acceptLine(remainder)
    } finally {
      stream.destroy()
    }
  } finally {
    await handle.close().catch(() => undefined)
  }

  const selectedWindow = options.before && beforeFound ? beforeWindow : latestWindow
  const windowItems = selectedWindow.ids.flatMap((id) => {
    const item = selectedWindow.items.get(id)
    return item ? [item] : []
  })
  // The anchor is only materialized when the running turn's opening user
  // message was trimmed out of the rolling window; the helper re-locates it
  // by turn and re-applies the item/byte budget.
  const anchorCandidateId = anchor.item?.id
  const anchoredPage = Boolean(
    !options.before &&
    anchorCandidateId !== undefined &&
    !selectedWindow.items.has(anchorCandidateId)
  )
  const page = buildPublicItemHistoryPage(
    anchoredPage ? [anchor.item!, ...windowItems] : windowItems,
    {
      ...(anchoredPage ? { anchorTurnId: anchorTurnId! } : {}),
      maxItems,
      maxBytes
    }
  )
  if (selectedWindow.droppedBefore && page.items[0]) {
    // On an anchored page the cursor stays at the retained continuous window
    // so the next older page covers the anchor and the gap between it and
    // the window.
    const cursor = anchoredPage && page.items.length > 1 ? page.items[1] : page.items[0]
    return { ...page, nextCursor: cursor.id, hasMore: true }
  }
  return page
}

type ItemPageWindow = {
  ids: string[]
  items: Map<string, TurnItem>
  itemBytes: number
  droppedBefore: boolean
}

function createItemPageWindow(): ItemPageWindow {
  return { ids: [], items: new Map(), itemBytes: 0, droppedBefore: false }
}

function appendPageWindowItem(
  window: ItemPageWindow,
  item: TurnItem,
  maxItems: number,
  maxBytes: number
): void {
  window.ids.push(item.id)
  window.items.set(item.id, item)
  window.itemBytes += serializedBytes(item)
  trimPageWindow(window, maxItems, maxBytes)
}

function updatePageWindowItem(
  window: ItemPageWindow,
  item: TurnItem,
  maxItems: number,
  maxBytes: number
): void {
  const previous = window.items.get(item.id)
  if (!previous) return
  window.items.set(item.id, item)
  window.itemBytes += serializedBytes(item) - serializedBytes(previous)
  trimPageWindow(window, maxItems, maxBytes)
}

function trimPageWindow(
  window: ItemPageWindow,
  maxItems: number,
  maxBytes: number
): void {
  while (
    window.ids.length > maxItems ||
    (window.itemBytes > maxBytes && window.ids.length > 1)
  ) {
    const removed = window.ids.shift()
    if (!removed) break
    const removedItem = window.items.get(removed)
    if (removedItem) window.itemBytes -= serializedBytes(removedItem)
    window.items.delete(removed)
    window.droppedBefore = true
  }
}

export function serializedBytes(value: unknown): number {
  return Buffer.byteLength(JSON.stringify(value), 'utf-8')
}
