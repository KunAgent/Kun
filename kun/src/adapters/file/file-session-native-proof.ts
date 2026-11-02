import { stat } from 'node:fs/promises'
import { isDeepStrictEqual } from 'node:util'
import type { TurnItem } from '../../contracts/items.js'
import type { ItemHistoryPage, ItemHistoryPageOptions } from '../../ports/session-store.js'
import { readLiveItems } from './file-session-live-items.js'

/** Verify the bounded durable proof against the exact view the model can read. */
export async function loadSingleDurableTurnProof(input: {
  options: ItemHistoryPageOptions
  liveItemsPath: string
  flushPending: () => Promise<unknown>
  withThreadWrite: <T>(operation: () => Promise<T>) => Promise<T>
  cachedItems: () => readonly TurnItem[] | undefined
  load: () => Promise<ItemHistoryPage>
}): Promise<ItemHistoryPage> {
  const { options } = input
  await input.flushPending()
  return input.withThreadWrite(async () => {
    const info = await stat(input.liveItemsPath).catch(() => null)
    if (info && info.size > options.maxBytes) throw new Error('live item proof exceeds budget')
    const live = await readLiveItems(input.liveItemsPath)
    if (live.some(({ item }) => item.turnId === options.turnId && item.id !== options.exactItemId)) {
      throw new Error('live turn contains an unreserved item')
    }
    const page = await input.load()
    const cached = input.cachedItems()
    if (cached) {
      const items = cached.filter((item) => item.turnId === options.turnId)
      // JSON normalization removes optional undefined fields omitted from disk.
      if (items.length !== 1 || page.items.length !== 1 ||
        !isDeepStrictEqual(JSON.parse(JSON.stringify(items[0])), JSON.parse(JSON.stringify(page.items[0])))) {
        throw new Error('cached turn differs from its durable proof')
      }
    }
    return page
  })
}
