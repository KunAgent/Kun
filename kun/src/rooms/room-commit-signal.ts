const listeners = new Set<() => void>()

/**
 * Wakes room event pollers in this process after a room write. Room event
 * streams back off while a room is quiet; nearly every write comes from this
 * Runtime, so a commit here makes its events visible without waiting out the
 * backoff. Writes from another process still appear within the backoff cap.
 */
export function onRoomStoreCommit(listener: () => void): () => void {
  listeners.add(listener)
  return () => { listeners.delete(listener) }
}

export function notifyRoomStoreCommit(): void {
  for (const listener of [...listeners]) {
    try { listener() } catch { /* A poller's wake-up never fails the write. */ }
  }
}
