import type { TurnItem } from '../contracts/items.js'

const DEFAULT_LIMIT = 4_096

/**
 * Delegated mappers rebuild an item from the wire on every chunk or update,
 * and every rebuild stamps a fresh `createdAt`. Persisting that moved each
 * item to its last update: tool calls lasted 0 ms and model output lost its
 * first-token time. This keeps the first-seen `createdAt` (and the first
 * `finishedAt`) of every item it stamps.
 */
export class DelegatedItemTimes {
  private readonly times = new Map<string, { createdAt: string; finishedAt?: string }>()

  constructor(private readonly limit = DEFAULT_LIMIT) {}

  stamp<T extends TurnItem>(item: T): T {
    const key = `${item.threadId}\u0000${item.id}`
    const first = this.times.get(key)
    if (!first) {
      if (this.times.size >= this.limit) this.times.delete(this.times.keys().next().value!)
      this.times.set(key, {
        createdAt: item.createdAt,
        ...(item.finishedAt ? { finishedAt: item.finishedAt } : {})
      })
      return item
    }
    first.finishedAt ??= item.finishedAt
    return {
      ...item,
      createdAt: first.createdAt,
      ...(first.finishedAt ? { finishedAt: first.finishedAt } : {})
    }
  }
}
