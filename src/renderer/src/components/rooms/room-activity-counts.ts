import { create } from 'zustand'
import type { RoomSidebarEntry } from '@shared/rooms-api'

export type RoomActivityCounts = { runningCount: number; attentionCount: number }

/**
 * Host-computed running and attention counts from the Code conversation list.
 * The open conversation reads its own counts here instead of issuing a second
 * sidebar query; without a loaded list it simply shows no task counts.
 */
export const useRoomActivityCounts = create<{ counts: Record<string, RoomActivityCounts> }>(() => ({ counts: {} }))

export function publishRoomActivityCounts(entries: RoomSidebarEntry[]): void {
  const current = useRoomActivityCounts.getState().counts
  let changed = false
  const next = { ...current }
  for (const entry of entries) {
    if (!entry.roomId) continue
    const previous = current[entry.roomId]
    if (previous?.runningCount === entry.runningCount && previous.attentionCount === entry.attentionCount) continue
    next[entry.roomId] = { runningCount: entry.runningCount, attentionCount: entry.attentionCount }
    changed = true
  }
  if (changed) useRoomActivityCounts.setState({ counts: next })
}
