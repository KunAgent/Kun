import { create } from 'zustand'
import { readBrowserStorageItem, writeBrowserStorageItem } from '../lib/browser-storage'
import { writeWorkspaceKey } from './write-thread-registry'
import { useWorkSlotsStore } from './work-slots-store'
import { useWriteWorkspaceStore } from './write-workspace-store'

const SESSION_TABS_KEY = 'kun.work.openSessionTabs.v1'
const MAX_SESSION_TABS = 12

type OpenSessionTabs = Record<string, string[]>
export type WorkLibraryTab = 'artifacts' | 'papers'

function readOpenSessionTabs(): OpenSessionTabs {
  try {
    const parsed = JSON.parse(readBrowserStorageItem(SESSION_TABS_KEY) ?? '{}') as unknown
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return {}
    return Object.fromEntries(Object.entries(parsed as Record<string, unknown>)
      .map(([key, ids]) => [key, Array.isArray(ids) ? ids.filter((id): id is string => typeof id === 'string') : []]))
  } catch {
    return {}
  }
}

/**
 * The Work tab strip: sessions are tabs of their own next to the open files.
 * Which kind owns the stage is the slots store's `assistantMain`; this store
 * adds the open session tabs per space, the optional split, and the in-session
 * file peek (a floating sheet that belongs to the session, unlike the split).
 */
type WorkViewState = {
  sessionTabs: OpenSessionTabs
  libraryTabs: WorkLibraryTab[]
  split: boolean
  peek: boolean
  openSessionTab: (workspaceRoot: string, threadId: string) => void
  closeSessionTab: (workspaceRoot: string, threadId: string) => void
  /** Replace the space's session tab order (the strip's move left / right). */
  reorderSessionTabs: (workspaceRoot: string, threadIds: string[]) => void
  openLibraryTab: (tab: WorkLibraryTab) => void
  closeLibraryTab: (tab: WorkLibraryTab) => void
  showSession: () => void
  showDocument: () => void
  toggleSplit: () => void
  setPeek: (value: boolean) => void
}

export const useWorkViewStore = create<WorkViewState>((set, get) => ({
  sessionTabs: readOpenSessionTabs(),
  libraryTabs: [],
  split: false,
  peek: false,
  openSessionTab: (workspaceRoot, threadId) => {
    const key = writeWorkspaceKey(workspaceRoot)
    const id = threadId.trim()
    if (!key || !id) return
    const current = get().sessionTabs[key] ?? []
    if (current.includes(id)) return
    const sessionTabs = { ...get().sessionTabs, [key]: [...current, id].slice(-MAX_SESSION_TABS) }
    writeBrowserStorageItem(SESSION_TABS_KEY, JSON.stringify(sessionTabs))
    set({ sessionTabs })
  },
  closeSessionTab: (workspaceRoot, threadId) => {
    const key = writeWorkspaceKey(workspaceRoot)
    const current = get().sessionTabs[key] ?? []
    if (!key || !current.includes(threadId)) return
    const sessionTabs = { ...get().sessionTabs, [key]: current.filter((id) => id !== threadId) }
    writeBrowserStorageItem(SESSION_TABS_KEY, JSON.stringify(sessionTabs))
    set({ sessionTabs })
  },
  reorderSessionTabs: (workspaceRoot, threadIds) => {
    const key = writeWorkspaceKey(workspaceRoot)
    if (!key) return
    const ids = [...new Set(threadIds.map((id) => id.trim()).filter(Boolean))].slice(-MAX_SESSION_TABS)
    const sessionTabs = { ...get().sessionTabs, [key]: ids }
    writeBrowserStorageItem(SESSION_TABS_KEY, JSON.stringify(sessionTabs))
    set({ sessionTabs })
  },
  openLibraryTab: (tab) => set((state) => ({
    libraryTabs: state.libraryTabs.includes(tab) ? state.libraryTabs : [...state.libraryTabs, tab]
  })),
  closeLibraryTab: (tab) => set((state) => ({ libraryTabs: state.libraryTabs.filter((item) => item !== tab) })),
  showSession: () => {
    useWorkSlotsStore.getState().setAssistantMain(true)
    // The session gets the stage alone unless the split was turned on.
    if (!get().split) set({ peek: false })
  },
  showDocument: () => {
    useWorkSlotsStore.getState().setAssistantMain(false)
    set({ peek: false })
    useWriteWorkspaceStore.getState().setAssistantOpen(get().split)
  },
  toggleSplit: () => {
    const split = !get().split
    set({ split, peek: false })
    if (!useWorkSlotsStore.getState().assistantMain) useWriteWorkspaceStore.getState().setAssistantOpen(split)
  },
  setPeek: (value) => set({ peek: value, ...(value ? { split: false } : {}) })
}))

/** Open session tab ids of `workspaceRoot`. */
export function useOpenSessionTabs(workspaceRoot: string): string[] {
  return useWorkViewStore((state) => state.sessionTabs[writeWorkspaceKey(workspaceRoot)] ?? EMPTY)
}

const EMPTY: string[] = []
