import { create } from 'zustand'

const STORAGE_KEY = 'kun.sidebar.scope.v1'

export type SidebarScope = 'code' | 'chats'

function readStored(): SidebarScope {
  try {
    return window.localStorage.getItem(STORAGE_KEY) === 'chats' ? 'chats' : 'code'
  } catch {
    return 'code'
  }
}

/**
 * The Code sidebar lists either projects (Code) or Agent private and group
 * conversations (Chats). The mode switch flips it; the route stays on Code so
 * opening a conversation behaves exactly as before.
 */
type SidebarScopeState = {
  scope: SidebarScope
  setScope: (scope: SidebarScope) => void
}

export const useSidebarScopeStore = create<SidebarScopeState>((set, get) => ({
  scope: readStored(),
  setScope: (scope) => {
    if (get().scope === scope) return
    try {
      window.localStorage.setItem(STORAGE_KEY, scope)
    } catch {
      // The preference is a convenience; losing it is harmless.
    }
    set({ scope })
  }
}))
