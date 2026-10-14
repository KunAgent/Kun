import type { SessionStore } from '../ports/session-store.js'

/** Never pair a snapshot with the generation of a concurrent canonical replacement. */
export async function versionedHistory<T>(store: SessionStore, threadId: string, read: () => Promise<T>) {
  for (let attempt = 0; attempt < 2; attempt++) {
    const historyVersion = await store.itemHistoryVersion?.(threadId)
    const history = await read()
    if (historyVersion === await store.itemHistoryVersion?.(threadId)) return { history, historyVersion }
  }
  throw new Error('HISTORY_CHANGED')
}
