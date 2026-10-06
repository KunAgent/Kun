import { create } from 'zustand'
import { useChatStore } from '../../store/chat-store'
import { useAgentChatNavigationStore } from './agent-chat-navigation'

export type AgentChatDialog = 'picker' | 'profile' | 'directory'
export type AgentChatPickerOrigin = { route: string; threadId: string | null; roomId: string | null }
type AgentChatPickerState = {
  dialog: AgentChatDialog | null
  group: boolean
  origin: AgentChatPickerOrigin | null
  serial: number
}

/**
 * One recipient picker for Code: the sidebar, the home shortcuts and empty
 * conversation states all open the same private or group conversation flow.
 */
export const useAgentChatPicker = create<AgentChatPickerState>(() => ({
  dialog: null, group: false, origin: null, serial: 0
}))

function currentOrigin(): AgentChatPickerOrigin {
  const chat = useChatStore.getState()
  return { route: chat.route, threadId: chat.activeThreadId, roomId: useAgentChatNavigationStore.getState().roomId }
}

export function openAgentChatDialog(dialog: AgentChatDialog, options: { group?: boolean } = {}): void {
  useAgentChatPicker.setState((state) => ({
    dialog, group: Boolean(options.group), origin: currentOrigin(), serial: state.serial + 1
  }))
}

export function closeAgentChatDialog(serial: number): void {
  if (useAgentChatPicker.getState().serial !== serial) return
  useAgentChatPicker.setState({ dialog: null, group: false, origin: null })
}

/** A slow creation result may only navigate while the user is still where they started. */
export function agentChatOriginIsCurrent(origin: AgentChatPickerOrigin | null): boolean {
  if (!origin) return false
  const chat = useChatStore.getState()
  return origin.route === chat.route && origin.threadId === chat.activeThreadId &&
    origin.roomId === useAgentChatNavigationStore.getState().roomId
}
