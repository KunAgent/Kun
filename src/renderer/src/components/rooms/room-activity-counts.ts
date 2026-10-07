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

export type LatestPrivateConversation = {
  roomId: string
  agentId: string
  name: string
  avatar?: RoomSidebarEntry['avatar']
  preview: string
}

/** The most recent Agent private chat in the unfiltered Code list, for the Code home card. */
export const useLatestPrivateConversation = create<{ entry: LatestPrivateConversation | null }>(() => ({ entry: null }))

export function publishLatestPrivateConversation(entries: RoomSidebarEntry[]): void {
  let latest: RoomSidebarEntry | null = null
  for (const entry of entries) {
    if (entry.kind !== 'user_agent' || !entry.roomId || !entry.agentId || entry.deleted || entry.archived) continue
    const at = entry.latestMessage?.createdAt ?? ''
    if (!latest || at > (latest.latestMessage?.createdAt ?? '')) latest = entry
  }
  const next = latest ? { roomId: latest.roomId!, agentId: latest.agentId!, name: latest.name || latest.title,
    avatar: latest.avatar, preview: latest.latestMessage?.preview ?? '' } : null
  const current = useLatestPrivateConversation.getState().entry
  if (current?.roomId === next?.roomId && current?.name === next?.name && current?.preview === next?.preview &&
    current?.avatar === next?.avatar) return
  useLatestPrivateConversation.setState({ entry: next })
}
