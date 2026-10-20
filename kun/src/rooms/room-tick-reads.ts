import { AsyncLocalStorage } from 'node:async_hooks'

type TickReads = { open: boolean; reads: Map<string, Promise<unknown>> }

const tickReads = new AsyncLocalStorage<TickReads>()

/**
 * A coordinator pass asks for the same rooms, requests, topics, members and
 * feature flags many times (every peer topic re-reads its room and requests),
 * and each read is a Manager round trip. Inside the pass's own async context,
 * identical reads share one round trip and every caller receives its own copy.
 *
 * Any write made in the pass, successful or not, drops the cached reads, so
 * read-after-write and conflict retries observe fresh state. The cache closes
 * when the pass ends: work the pass started that outlives it, and every other
 * caller (HTTP routes, event handlers), always reads through.
 */
export async function withRoomTickReads<T>(operation: () => Promise<T>): Promise<T> {
  const context: TickReads = { open: true, reads: new Map() }
  try {
    return await tickReads.run(context, operation)
  } finally {
    context.open = false
    context.reads.clear()
  }
}

export function tickCachedRead<T>(key: string, read: () => Promise<T>): Promise<T> {
  const context = tickReads.getStore()
  if (!context?.open) return read()
  let shared = context.reads.get(key) as Promise<T> | undefined
  if (!shared) {
    const pending = read()
    shared = pending
    context.reads.set(key, pending)
    pending.catch(() => {
      if (context.reads.get(key) === pending) context.reads.delete(key)
    })
  }
  return shared.then((value) => structuredClone(value))
}

/** Called around every write so the pass never reuses a read from before it. */
export function invalidateTickReads(): void {
  tickReads.getStore()?.reads.clear()
}
