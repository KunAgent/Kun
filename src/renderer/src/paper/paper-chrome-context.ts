import { createContext, useContext } from 'react'

/**
 * Workbench chrome handles for deep paper UI (R1.1/R1.2): the left sidebar's
 * collapsed state lives in the workbench layout hook, so readers/layout
 * presets reach it through this context instead of prop drilling. The
 * provider sits in PaperWorkspaceView; consumers tolerate it being absent.
 */
export type PaperWorkbenchChrome = {
  leftSidebarCollapsed: boolean
  setLeftSidebarCollapsed: (collapsed: boolean) => void
}

export const PaperWorkbenchChromeContext = createContext<PaperWorkbenchChrome | null>(null)

export function usePaperWorkbenchChrome(): PaperWorkbenchChrome | null {
  return useContext(PaperWorkbenchChromeContext)
}
