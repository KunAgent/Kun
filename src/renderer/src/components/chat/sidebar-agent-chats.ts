import type { RoomSidebarEntry, RoomSidebarQuery } from '@shared/rooms-api'

/** Code lists private and group conversations; Agent pair transcripts stay in Agent details. */
export const AGENT_CHATS_COLLAPSED_COUNT = 4

export type ConversationFilter = 'all' | 'unread' | 'attention' | 'group'
export type ConversationListState = 'active' | 'archived' | 'deleted'
export const CONVERSATION_FILTERS: readonly ConversationFilter[] = ['all', 'unread', 'attention', 'group']

export function conversationSidebarQuery(
  listState: ConversationListState,
  filter: ConversationFilter,
  search: string
): RoomSidebarQuery {
  return {
    kind: filter === 'group' ? 'group' : 'all',
    search,
    ...(filter === 'unread' ? { unreadOnly: true } : filter === 'attention' ? { attentionOnly: true } : {}),
    ...(listState === 'archived' ? { archivedOnly: true } : listState === 'deleted' ? { deletedOnly: true } : {})
  }
}

export function isListedConversation(entry: RoomSidebarEntry): boolean {
  return entry.kind === 'user_agent' || entry.kind === 'group'
}

export function conversationHasUnread(entry: RoomSidebarEntry): boolean {
  // Storage sequence numbers are global cursors, never per-room unread counts.
  return !entry.deleted && entry.latestMessageSeq > entry.readSeq
}

export function visibleAgentChatEntries(
  entries: RoomSidebarEntry[],
  expanded: boolean,
  query: string,
  selectedRoomId: string | null,
  includeDeleted = false
): RoomSidebarEntry[] {
  const conversations = entries.filter((entry) => isListedConversation(entry) && (includeDeleted || !entry.deleted))
  if (expanded || query.trim()) return conversations
  const visible = conversations.slice(0, AGENT_CHATS_COLLAPSED_COUNT)
  const selected = conversations.find((entry) => entry.roomId && entry.roomId === selectedRoomId)
  if (selected && !visible.some((entry) => entry.id === selected.id)) visible.splice(AGENT_CHATS_COLLAPSED_COUNT - 1, 1, selected)
  return visible
}
