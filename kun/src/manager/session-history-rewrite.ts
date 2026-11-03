import { isDeepStrictEqual } from 'node:util'
import { ItemHistoryRewriteSchema } from '../contracts/item-history-rewrite.js'
import type { TurnItem } from '../contracts/items.js'
import type { ItemHistoryCommit, ItemHistorySnapshot, SessionStore } from '../ports/session-store.js'

/** Preserve order and full fidelity without uploading unchanged history bodies. */
export function referenceUnchangedItems(snapshot: ItemHistorySnapshot, items: TurnItem[]) {
  const originals = new Map(snapshot.items.map((item) => [item.id, item]))
  return items.map((item) => isDeepStrictEqual(originals.get(item.id), item) ? item.id : item)
}

export async function rewriteSessionHistory(
  store: SessionStore,
  value: unknown,
  assertCurrent?: () => void
): Promise<ItemHistoryCommit> {
  const body = ItemHistoryRewriteSchema.parse(value)
  let items = body.items
  if (!items) {
    const snapshot = await store.loadItemSnapshot(body.threadId)
    if (snapshot.revision !== body.expectedRevision) {
      return { applied: false, reason: 'conflict', revision: snapshot.revision }
    }
    const originals = new Map(snapshot.items.map((item) => [item.id, item]))
    items = body.itemReferences!.map((entry) => {
      if (typeof entry !== 'string') return entry
      const item = originals.get(entry)
      if (!item) throw new Error(`Item history reference is missing: ${entry}`)
      return item
    })
  }
  // Loading history may yield while a lease expires. Recheck before committing.
  assertCurrent?.()
  return store.rewriteItemsIfRevision(body.threadId, body.expectedRevision, items)
}
