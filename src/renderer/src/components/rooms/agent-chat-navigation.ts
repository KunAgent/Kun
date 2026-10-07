import { create } from 'zustand'
import type { Room } from '@shared/rooms-api'
import { useChatStore } from '../../store/chat-store'
import { readBrowserStorageItem, removeBrowserStorageItem, writeBrowserStorageItem } from '../../lib/browser-storage'
import { agentPath } from './agent-client'
import { roomsRequest } from './rooms-client'

export const AGENT_CHAT_SELECTED_KEY = 'kun.agentChats.selected'

type AgentChatNavigation = {
  roomId: string | null
  error: string
  pending: boolean
  target: AgentChatTarget | null
}
/** What to reveal once a conversation opens: a run, a message, or the conversation info board. */
type AgentChatTarget = { roomId: string; runId?: string; messageId?: string; info?: boolean }

export const useAgentChatNavigationStore = create<AgentChatNavigation>(() => ({
  roomId: readBrowserStorageItem(AGENT_CHAT_SELECTED_KEY) || null,
  error: '',
  pending: false,
  target: null
}))

let navigationSerial = 0

export function openAgentConversationRoom(roomId: string, target?: Omit<AgentChatTarget, 'roomId'>): void {
  if (!roomId) return
  navigationSerial++
  writeBrowserStorageItem(AGENT_CHAT_SELECTED_KEY, roomId)
  useAgentChatNavigationStore.setState({ roomId, error: '', pending: false, target: target ? { roomId, ...target } : null })
  useChatStore.getState().setRoute('agent-chat')
}

/** A removed or hidden conversation must not stay selected; Code returns to its task surface. */
export function leaveAgentConversation(roomId: string): void {
  if (!roomId || useAgentChatNavigationStore.getState().roomId !== roomId) return
  navigationSerial++
  removeBrowserStorageItem(AGENT_CHAT_SELECTED_KEY)
  useAgentChatNavigationStore.setState({ roomId: null, error: '', pending: false, target: null })
  if (useChatStore.getState().route === 'agent-chat') useChatStore.getState().setRoute('chat')
}

export async function openAgentConversation(agentId: string): Promise<void> {
  const serial = ++navigationSerial
  useAgentChatNavigationStore.setState({ roomId: null, error: '', pending: true })
  useChatStore.getState().setRoute('agent-chat')
  try {
    const result = await roomsRequest<{ room: Room }>(agentPath(agentId) + '/conversation', 'POST', {})
    if (serial !== navigationSerial || useChatStore.getState().route !== 'agent-chat') return
    if (result.room.conversationKind !== 'user_agent') throw new Error('Private conversation required')
    openAgentConversationRoom(result.room.id)
  } catch (cause) {
    if (serial !== navigationSerial || useChatStore.getState().route !== 'agent-chat') return
    const error = cause instanceof Error ? cause.message : String(cause)
    useAgentChatNavigationStore.setState({ error, pending: false })
    throw cause
  }
}

// A slow Agent lookup must never pull a user back from a project task or Rooms.
useChatStore.subscribe((state, previous) => {
  if (previous.route === 'agent-chat' && state.route !== 'agent-chat') {
    navigationSerial++
    useAgentChatNavigationStore.setState({ pending: false })
  }
})
