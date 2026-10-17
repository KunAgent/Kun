import type { TurnItem } from '../../../contracts/items.js'
import { buildPublicItemHistoryPage, timelineSafeItem } from '../../../services/item-history-page.js'

/**
 * A desktop timeline page holds up to 4 MiB of items because it is read over localhost. A phone reads the same
 * page through the relay, which ran near 100 KB/s on a proxied link, within a 30 s invoke timeout, and one relay
 * message is capped at 4 MiB. A long Harness task's newest page (258 items, 4.18 MB of tool calls and results)
 * timed out there and sat 6 KB below the cap. The phone shows at most 16 000 characters of an item and reads the
 * rest with message.get, so oversized items travel as flagged previews and a page stops at a budget that
 * arrives in seconds.
 */
export const RELAY_HISTORY_ITEM_BYTES = 16 * 1024
export const RELAY_HISTORY_PAGE_BYTES = 512 * 1024
const SOURCE_CURSOR = 'history:'

type HistoryTurn = { id: string; items?: TurnItem[] }
type TimelineHistory = {
  turns?: HistoryTurn[]
  activeTurn?: { id?: string } | null
  latestTurn?: { id?: string } | null
  timeline?: { nextCursor?: string; hasMore?: boolean; itemCount?: number; itemBytes?: number }
}

/** Marks a preview the way the phone already reads partial items, so it offers to read the original. */
function relayItem(item: TurnItem): TurnItem {
  const bounded = timelineSafeItem(item, RELAY_HISTORY_ITEM_BYTES)
  return bounded === item ? item : ({ ...bounded, truncated: true } as unknown as TurnItem)
}

function withItems<T extends TimelineHistory>(history: T, items: readonly TurnItem[], keepEmpty: boolean): HistoryTurn[] {
  const byTurn = new Map<string, TurnItem[]>()
  for (const item of items) byTurn.set(item.turnId, [...(byTurn.get(item.turnId) ?? []), item])
  return (history.turns ?? []).filter((turn) => keepEmpty || byTurn.has(turn.id))
    .map((turn) => ({ ...turn, items: byTurn.get(turn.id) ?? [] }))
}

/**
 * Bounds one code.history page for the relay. `relayed` is what the phone receives; `retained` keeps the
 * original items of that page for host-side work such as artifact discovery, which needs full tool output.
 */
export function relayHistoryPage<T extends TimelineHistory>(history: T, cursor?: string): { relayed: T; retained: T } {
  const original = (history.turns ?? []).flatMap((turn) => turn.items ?? [])
  const items = original.map(relayItem)
  // An imported source page continues with an opaque reference cursor, so only its item sizes are bounded.
  const source = cursor?.startsWith(SOURCE_CURSOR) === true ||
    items.some((item) => Boolean((item as { sourceHistoryOrder?: unknown }).sourceHistoryOrder))
  const anchorTurnId = cursor ? undefined : history.activeTurn?.id ?? history.latestTurn?.id
  const page = source ? undefined : buildPublicItemHistoryPage(items, {
    ...(anchorTurnId ? { anchorTurnId } : {}),
    maxItems: Math.max(1, items.length),
    maxBytes: RELAY_HISTORY_PAGE_BYTES
  })
  if (!page) return { relayed: { ...history, turns: withItems(history, items, true) }, retained: history }
  const kept = new Set(page.items.map((item) => item.id))
  // Without a trimmed window the desktop's own cursor still marks where the next older page starts.
  const trimmed = page.hasMore && Boolean(page.nextCursor)
  return {
    relayed: {
      ...history,
      turns: withItems(history, page.items, false),
      timeline: {
        ...history.timeline,
        ...(trimmed ? { hasMore: true, nextCursor: page.nextCursor } : {}),
        itemCount: page.items.length,
        itemBytes: page.itemBytes
      }
    },
    retained: { ...history, turns: withItems(history, original.filter((item) => kept.has(item.id)), false) }
  }
}
