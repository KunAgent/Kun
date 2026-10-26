import { create } from 'zustand'
import { PanelRightClose } from 'lucide-react'
import { useTranslation } from 'react-i18next'

const STORAGE_KEY = 'kun.rail.collapsed.v1'

function readStored(): boolean {
  try {
    return window.localStorage.getItem(STORAGE_KEY) === '1'
  } catch {
    return false
  }
}

/** Whether the right tool rail is folded away; the top bar then shows a reopen button. */
type RailCollapseState = {
  collapsed: boolean
  setCollapsed: (value: boolean) => void
}

export const useRailCollapseStore = create<RailCollapseState>((set, get) => ({
  collapsed: readStored(),
  setCollapsed: (value) => {
    if (get().collapsed === value) return
    try {
      window.localStorage.setItem(STORAGE_KEY, value ? '1' : '0')
    } catch {
      // The preference is a convenience; losing it is harmless.
    }
    set({ collapsed: value })
  }
}))

/** Folds the rail away; sits at the top of the rail. */
export function RailCollapseButton({ className = '' }: { className?: string }) {
  const { t } = useTranslation('common')
  const setCollapsed = useRailCollapseStore((state) => state.setCollapsed)
  return (
    <button
      type="button"
      onClick={() => setCollapsed(true)}
      className={`kun-rail-toggle ${className}`}
      data-tooltip={t('railCollapse')}
      aria-label={t('railCollapse')}
    >
      <PanelRightClose className="h-[16px] w-[16px]" strokeWidth={1.8} />
    </button>
  )
}

/** Brings the rail back; rendered by the top bar only while the rail is folded. */
export function RailReopenButton() {
  const { t } = useTranslation('common')
  const collapsed = useRailCollapseStore((state) => state.collapsed)
  const setCollapsed = useRailCollapseStore((state) => state.setCollapsed)
  if (!collapsed) return null
  return (
    <button
      type="button"
      onClick={() => setCollapsed(false)}
      className="kun-rail-reopen"
      data-tooltip={t('railExpand')}
      aria-label={t('railExpand')}
    >
      <PanelRightClose className="h-[17px] w-[17px] rotate-180" strokeWidth={1.8} />
    </button>
  )
}
