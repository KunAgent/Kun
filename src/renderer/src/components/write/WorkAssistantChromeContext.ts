import { createContext } from 'react'

/** Chrome supplied by the Work stage, shared by full-page and sidebar hosts. */
export const WorkAssistantChromeContext = createContext<{
  leftSidebarCollapsed: boolean
  onToggleLeftSidebar: () => void
} | null>(null)
