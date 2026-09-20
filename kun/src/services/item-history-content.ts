import { isPublicTurnItem, type TurnItem } from '../contracts/items.js'
import type { ItemHistoryPage, ItemHistoryPageOptions } from '../ports/session-store.js'
import { assertItemHistoryScope, itemMatchesHistoryScope } from './item-history-scope.js'

export function isItemContentRequest(options: ItemHistoryPageOptions): boolean {
  assertItemHistoryScope(options)
  if (options.itemId !== undefined || options.contentOffset !== undefined) {
    if (!options.turnId || !options.itemId || (options.contentOffset !== undefined &&
      (!Number.isSafeInteger(options.contentOffset) || options.contentOffset < 0))) {
      throw new Error('item content requires an exact turn, item and nonnegative integer offset')
    }
    return true
  }
  return false
}

/** A fragment of the canonical field; display previews never replace its source. */
export function buildItemContentPage(item: TurnItem | undefined, options: ItemHistoryPageOptions): ItemHistoryPage {
  isItemContentRequest(options)
  const empty = { items: [], hasMore: false, itemBytes: 0 } satisfies ItemHistoryPage
  if (!item || !isPublicTurnItem(item) || item.id !== options.itemId || !itemMatchesHistoryScope(item, options)) return empty
  const record = item as TurnItem & Record<string, unknown>
  const field = item.kind === 'tool_call' ? 'arguments'
    : item.kind === 'tool_result' ? 'output'
      : item.kind === 'error' && record.details !== undefined ? 'details' : 'text'
  const value = field === 'text'
    ? record.text ?? record.reviewText ?? record.summary ?? record.prompt ?? record.message ?? ''
    : record[field]
  const source = typeof value === 'string' ? value : JSON.stringify(value ?? null)
  const offset = Math.min(options.contentOffset ?? 0, source.length)
  const maxBytes = Math.max(1, Math.floor(options.maxBytes))
  let end = Math.min(offset + 8 * 1024, source.length)
  if (Buffer.byteLength(source.slice(offset, end), 'utf8') > maxBytes) {
    let low = offset, high = end
    while (low < high) {
      const middle = Math.ceil((low + high) / 2)
      if (Buffer.byteLength(source.slice(offset, middle), 'utf8') <= maxBytes) low = middle
      else high = middle - 1
    }
    end = low
  }
  if (end < source.length && end > offset && /[\uD800-\uDBFF]/.test(source[end - 1]!)) end -= 1
  if (end === offset && offset < source.length) throw new Error('item content byte budget cannot fit the next character')
  return { ...empty, content: {
    itemId: item.id, field, text: source.slice(offset, end), offset,
    ...(end < source.length ? { nextOffset: end } : {}), totalChars: source.length
  } }
}
