// Which personal assistant conversation the Code stage shows. Assistants are not Rooms, so this
// rides on the existing `agent-chat` route; opening any Room clears it.
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
}

function loadReadMarks(): Record<string, string> {
  try {
    const value = JSON.parse(readBrowserStorageItem(READ_KEY) || '{}') as unknown
    return value && typeof value === 'object' ? value as Record<string, string> : {}
  } catch {
    return {}
  }
}

export const useAssistantNavigationStore = create<Navigation>(() => ({ selection: null, readAt: loadReadMarks() }))

export function openAssistantConversation(selection: AssistantSelection): void {
  useAssistantNavigationStore.setState({ selection })
  useChatStore.getState().setRoute('agent-chat')
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
