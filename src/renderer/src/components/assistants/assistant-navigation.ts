// Which personal assistant conversation the Code stage shows, and whether the connect dialog is
// open. Assistants are not Rooms, so this rides on the existing `agent-chat` route; opening any Room
// clears it.
import { create } from 'zustand'
import { useChatStore } from '../../store/chat-store'
import { readBrowserStorageItem, writeBrowserStorageItem } from '../../lib/browser-storage'
import { useAgentChatNavigationStore } from '../rooms/agent-chat-navigation'

export type AssistantSelection = { kind: 'assistant' | 'enrollment'; id: string }

const READ_KEY = 'kun.assistants.readAt'

type Navigation = {
  selection: AssistantSelection | null
  /** When the user last looked at each assistant's conversation, for unread dots. */
  readAt: Record<string, string>
  /** The workbench hosts the connect dialog, like the new-conversation picker, so it is never clipped by the sidebar. */
  connecting: boolean
}

function loadReadMarks(): Record<string, string> {
  try {
    const value = JSON.parse(readBrowserStorageItem(READ_KEY) || '{}') as unknown
    return value && typeof value === 'object' ? value as Record<string, string> : {}
  } catch {
    return {}
  }
}

export const useAssistantNavigationStore = create<Navigation>(() => ({ selection: null, readAt: loadReadMarks(), connecting: false }))

export function openAssistantConversation(selection: AssistantSelection): void {
  useAssistantNavigationStore.setState({ selection })
  useChatStore.getState().setRoute('agent-chat')
}

export function openAddAssistantDialog(): void {
  useAssistantNavigationStore.setState({ connecting: true })
}

export function closeAddAssistantDialog(): void {
  useAssistantNavigationStore.setState({ connecting: false })
}

export function closeAssistantConversation(): void {
  if (useAssistantNavigationStore.getState().selection) useAssistantNavigationStore.setState({ selection: null })
}

export function markAssistantRead(assistantId: string, at: string): void {
  const readAt = { ...useAssistantNavigationStore.getState().readAt }
  if (readAt[assistantId] && readAt[assistantId] >= at) return
  readAt[assistantId] = at
  // Keep the mark list bounded to recently seen assistants.
  const entries = Object.entries(readAt).sort((a, b) => b[1].localeCompare(a[1])).slice(0, 64)
  const next = Object.fromEntries(entries)
  useAssistantNavigationStore.setState({ readAt: next })
  writeBrowserStorageItem(READ_KEY, JSON.stringify(next))
}

// Opening a Room (from the sidebar, a notification or a link) takes the stage back from assistants.
useAgentChatNavigationStore.subscribe((state, previous) => {
  if (state.roomId && (state.roomId !== previous.roomId || state.target !== previous.target || (state.pending && !previous.pending))) {
    closeAssistantConversation()
  }
})
