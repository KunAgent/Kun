import type { RoomSidebarEntry } from '@shared/rooms-api'
import { readBrowserStorageItem, writeBrowserStorageItem } from '../../lib/browser-storage'

export const AGENT_CHATS_HEIGHT_KEY = 'kun.code.agent-chats.height'
export const AGENT_CHATS_MIN_HEIGHT = 160
export const AGENT_CHATS_MAX_HEIGHT = 360
export const AGENT_CHATS_DEFAULT_HEIGHT = 240

export function clampAgentChatsHeight(height: number): number {
  const next = Number.isFinite(height) ? height : AGENT_CHATS_DEFAULT_HEIGHT
  return Math.round(Math.max(AGENT_CHATS_MIN_HEIGHT, Math.min(AGENT_CHATS_MAX_HEIGHT, next)))
}

export function readAgentChatsHeight(): number {
  const saved = readBrowserStorageItem(AGENT_CHATS_HEIGHT_KEY)
  return clampAgentChatsHeight(saved?.trim() ? Number(saved) : AGENT_CHATS_DEFAULT_HEIGHT)
}

export function saveAgentChatsHeight(height: number): number {
  const next = clampAgentChatsHeight(height)
  writeBrowserStorageItem(AGENT_CHATS_HEIGHT_KEY, String(next))
  return next
}

export function visibleAgentChatEntries(
  entries: RoomSidebarEntry[],
  expanded: boolean,
  query: string,
  selectedRoomId: string | null,
  includeDeleted = false
): RoomSidebarEntry[] {
  const privateChats = entries.filter((entry) => entry.kind === 'user_agent' && (includeDeleted || !entry.deleted))
  if (expanded || query.trim()) return privateChats
  const visible = privateChats.slice(0, 3)
  const selected = privateChats.find((entry) => entry.roomId && entry.roomId === selectedRoomId)
  if (selected && !visible.some((entry) => entry.id === selected.id)) visible.splice(2, 1, selected)
  return visible
}
