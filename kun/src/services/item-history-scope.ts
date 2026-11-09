import type { TurnItem } from '../contracts/items.js'
import type { ItemHistoryPageOptions } from '../ports/session-store.js'

export function assertItemHistoryScope(options: ItemHistoryPageOptions): void {
  if (options.exactItemId !== undefined && (!options.durableOnly || !options.turnId ||
    !options.exactItemId || options.exactItemId.length > 256 || options.itemId || options.callId ||
    options.before || options.contentOffset !== undefined || options.maxItems !== 1 ||
    !Number.isSafeInteger(options.maxBytes) || options.maxBytes < 1 || options.maxBytes > 1024 * 1024)) {
    throw new Error('exact item proof requires one bounded durable item and turn')
  }
  if (options.callId !== undefined && (!options.turnId || typeof options.callId !== 'string' ||
    options.callId.length === 0 || options.callId.length > 256)) {
    throw new Error('tool call history requires an exact turn and a valid call id')
  }
}

export function itemMatchesHistoryScope(item: TurnItem, options: ItemHistoryPageOptions): boolean {
  return (!options.turnId || item.turnId === options.turnId) &&
    (!options.callId || (item.kind === 'tool_call' || item.kind === 'tool_result') && item.callId === options.callId)
}
