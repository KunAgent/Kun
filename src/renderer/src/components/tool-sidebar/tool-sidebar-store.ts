import { create } from 'zustand'
import {
  readBrowserStorageItem,
  writeBrowserStorageItem
} from '../../lib/browser-storage'

export type PanelType =
  | 'todo'
  | 'plan'
  | 'changes'
  | 'browser'
  | 'file'
  | 'terminal'
  | 'files'
  | 'sdd-ai'

export type PanelTab = {
  id: string
  type: PanelType
  meta?: Record<string, unknown>
}

type ToolSidebarState = {
  open: boolean
  tabs: PanelTab[]
  activeTabId: string | null
  openTab: (type: PanelType, meta?: Record<string, unknown>) => void
  closeTab: (id: string) => void
  setActiveTab: (id: string) => void
  toggleOpen: () => void
  setOpen: (open: boolean) => void
  close: () => void
  closeTabsByType: (type: PanelType) => void
  hasTab: (type: PanelType) => boolean
  toggleTab: (type: PanelType, meta?: Record<string, unknown>) => void
}

const STORAGE_KEY = 'kun.layout.toolSidebar'
const PERSISTABLE_TYPES: ReadonlySet<PanelType> = new Set([
  'todo',
  'changes',
  'browser',
  'terminal',
  'files'
])

function tabIdForType(type: PanelType): string {
  return type
}

function loadPersisted(): { tabs: PanelTab[]; activeTabId: string | null; open: boolean } {
  const raw = readBrowserStorageItem(STORAGE_KEY)
  if (!raw) return { tabs: [], activeTabId: null, open: false }
  try {
    const parsed = JSON.parse(raw) as {
      tabs?: PanelTab[]
      activeTabId?: string | null
      open?: boolean
    }
    const tabs = (parsed.tabs ?? []).filter(
      (tab) => PERSISTABLE_TYPES.has(tab.type) && typeof tab.id === 'string'
    )
    const activeTabId =
      typeof parsed.activeTabId === 'string' &&
      tabs.some((tab) => tab.id === parsed.activeTabId)
        ? parsed.activeTabId
        : (tabs[0]?.id ?? null)
    return { tabs, activeTabId, open: parsed.open === true }
  } catch {
    return { tabs: [], activeTabId: null, open: false }
  }
}

function persist(state: {
  tabs: PanelTab[]
  activeTabId: string | null
  open: boolean
}): void {
  const persistable = state.tabs.filter((tab) => PERSISTABLE_TYPES.has(tab.type))
  const activeTabId = persistable.some((tab) => tab.id === state.activeTabId)
    ? state.activeTabId
    : (persistable[0]?.id ?? null)
  writeBrowserStorageItem(
    STORAGE_KEY,
    JSON.stringify({ tabs: persistable, activeTabId, open: state.open })
  )
}

function removeTab(tabs: PanelTab[], id: string): {
  tabs: PanelTab[]
  activeTabId: string | null
} {
  const next = tabs.filter((tab) => tab.id !== id)
  const closedIndex = tabs.findIndex((tab) => tab.id === id)
  const fallback = next[Math.max(0, closedIndex - 1)]?.id ?? next[0]?.id ?? null
  return { tabs: next, activeTabId: fallback }
}

const initial = loadPersisted()

export const useToolSidebarStore = create<ToolSidebarState>((set, get) => ({
  open: initial.open,
  tabs: initial.tabs,
  activeTabId: initial.activeTabId,

  openTab: (type, meta) => {
    set((state) => {
      const id = tabIdForType(type)
      const existing = state.tabs.find((tab) => tab.id === id)
      const tabs = existing
        ? state.tabs.map((tab) =>
            tab.id === id ? { ...tab, meta: meta ?? tab.meta } : tab
          )
        : [...state.tabs, { id, type, ...(meta ? { meta } : {}) }]
      const next = { tabs, activeTabId: id, open: true }
      persist(next)
      return next
    })
  },

  closeTab: (id) => {
    set((state) => {
      const { tabs, activeTabId } = removeTab(state.tabs, id)
      const open = tabs.length > 0 && state.open
      const next = { tabs, activeTabId, open }
      persist(next)
      return next
    })
  },

  setActiveTab: (id) => {
    set((state) => {
      if (!state.tabs.some((tab) => tab.id === id)) return state
      const next = { tabs: state.tabs, activeTabId: id, open: true }
      persist(next)
      return next
    })
  },

  toggleOpen: () => {
    set((state) => {
      const next = {
        tabs: state.tabs,
        activeTabId: state.activeTabId,
        open: !state.open
      }
      persist(next)
      return next
    })
  },

  setOpen: (open) => {
    set((state) => {
      const next = {
        tabs: state.tabs,
        activeTabId: state.activeTabId,
        open
      }
      persist(next)
      return next
    })
  },

  close: () => {
    set((state) => {
      const next = { tabs: state.tabs, activeTabId: state.activeTabId, open: false }
      persist(next)
      return next
    })
  },

  closeTabsByType: (type) => {
    set((state) => {
      const id = tabIdForType(type)
      if (!state.tabs.some((tab) => tab.id === id)) return state
      const { tabs, activeTabId } = removeTab(state.tabs, id)
      const open = tabs.length > 0 && state.open
      const next = { tabs, activeTabId, open }
      persist(next)
      return next
    })
  },

  hasTab: (type) => get().tabs.some((tab) => tab.type === type),

  toggleTab: (type, meta) => {
    const state = get()
    const id = tabIdForType(type)
    if (state.activeTabId === id && state.open) {
      get().close()
      return
    }
    get().openTab(type, meta)
  }
}))

export function useActiveTabType(): PanelType | null {
  return useToolSidebarStore((state) => {
    if (!state.activeTabId) return null
    return state.tabs.find((tab) => tab.id === state.activeTabId)?.type ?? null
  })
}

export function useToolSidebarOpen(): boolean {
  return useToolSidebarStore((state) => state.open)
}
