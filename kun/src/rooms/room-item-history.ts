import type { TurnItem } from '../contracts/items.js'
import type { SessionStore } from '../ports/session-store.js'

/** Newest-first bounded pages. Ignore pinned anchors: they are not a paging boundary. */
export async function* roomTurnItems(sessions: SessionStore, threadId: string, turnId: string): AsyncIterable<TurnItem> {
  if (!sessions.loadItemPage) {
    for (const item of (await sessions.loadItems(threadId)).reverse()) {
      if (item.threadId === threadId && item.turnId === turnId) {
        yield item
      }
    }
    return
  }
  let before: string | undefined
  const cursors = new Set<string>()
  const seen = new Set<string>()
  do {
    const page = await sessions.loadItemPage(threadId, { before, maxItems: 200, maxBytes: 1024 * 1024 })
    for (const item of [...page.items].reverse()) {
      if (seen.has(item.id)) continue
      seen.add(item.id)
      if (item.threadId === threadId && item.turnId === turnId) {
        yield item
      }
    }
    if (!page.hasMore) return
    if (!page.nextCursor || cursors.has(page.nextCursor)) throw new Error('room evidence history pagination did not advance')
    cursors.add(page.nextCursor)
    before = page.nextCursor
  } while (before)
}
