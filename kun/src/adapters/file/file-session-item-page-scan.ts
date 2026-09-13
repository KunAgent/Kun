import type { FileHandle } from 'node:fs/promises'
import { isPublicTurnItem, type TurnItem } from '../../contracts/items.js'
import type { ItemHistoryPage, ItemHistoryPageOptions } from '../../ports/session-store.js'
import { buildPublicItemHistoryPage, timelineSafeItem } from '../../services/item-history-page.js'
import { buildItemContentPage, isItemContentRequest } from '../../services/item-history-content.js'

const DEFAULT_ITEM_HISTORY_MAX_RECORD_BYTES = 16 * 1024 * 1024
const serializedBytes = (value: unknown): number => Buffer.byteLength(JSON.stringify(value), 'utf8')

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
  const contentMode = isItemContentRequest(options)
  let contentItem: TurnItem | undefined
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

    if (options.turnId && item.turnId !== options.turnId) return
    if (contentMode) {
      if (item.id === options.itemId && isPublicTurnItem(item)) contentItem = item
      return
    }
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

  if (contentMode) return buildItemContentPage(contentItem, options)
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
