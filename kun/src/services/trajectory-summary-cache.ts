import type { TrajectorySummary } from '../contracts/trajectory.js'

type Entry = {
  version: string
  pending?: Promise<TrajectorySummary>
  value?: TrajectorySummary
  expiresAt: number
}

/** Cache compact summaries only, never the hydrated conversation or trace bodies. */
export class TrajectorySummaryCache {
  private readonly entries = new Map<string, Entry>()

  constructor(private readonly capacity = 64, private readonly ttlMs = 2_000) {}

  get(threadId: string, version: string, load: () => Promise<TrajectorySummary>): Promise<TrajectorySummary> {
    const existing = this.entries.get(threadId)
    if (existing?.version === version) {
      if (existing.pending) return existing.pending
      if (existing.value && existing.expiresAt > Date.now()) return Promise.resolve(existing.value)
    }
    const entry: Entry = { version, expiresAt: 0 }
    this.entries.delete(threadId)
    this.entries.set(threadId, entry)
    while (this.entries.size > this.capacity) this.entries.delete(this.entries.keys().next().value!)
    entry.pending = Promise.resolve().then(load).then((value) => {
      entry.value = value
      entry.expiresAt = Date.now() + this.ttlMs
      return value
    }).finally(() => {
      entry.pending = undefined
      if (!entry.value && this.entries.get(threadId) === entry) this.entries.delete(threadId)
    })
    return entry.pending
  }
}
