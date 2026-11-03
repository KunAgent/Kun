import type { RoomStoreCommit } from './room-store.js'

/** Kinds only: observers never retain or fan out room content or ownership identifiers. */
export type RoomCommitChange = { documents: readonly string[]; events: readonly string[] }
const listeners = new Set<(change?: RoomCommitChange) => void>()

/**
 * Wakes room event pollers in this process after a room write. Room event
 * streams back off while a room is quiet; nearly every write comes from this
 * Runtime, so a commit here makes its events visible without waiting out the
 * backoff. Writes from another process still appear within the backoff cap.
 */
export function onRoomStoreCommit(listener: (change?: RoomCommitChange) => void): () => void {
  listeners.add(listener)
  return () => { listeners.delete(listener) }
}

export function notifyRoomStoreCommit(input?: RoomStoreCommit): void {
  if (!listeners.size) return
  const change = input ? { documents: [...new Set(input.puts?.map((put) => put.kind) ?? [])],
    events: [...new Set(input.events?.map((event) => event.kind) ?? [])] } : undefined
  for (const listener of [...listeners]) {
    try { listener(change) } catch { /* A poller's wake-up never fails the write. */ }
  }
}
