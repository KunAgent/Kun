import { create } from 'zustand'
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

/**
 * The rail's own mark: its column of tool chips with an arrow toward where it
 * goes (folding) or comes back from (reopening), so it never reads as the
 * side-panel toggle next to it.
 */
function RailGlyph({ direction, size }: { direction: 'fold' | 'reopen'; size: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.9}
      strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d={direction === 'fold' ? 'M4 8l3.5 4L4 16' : 'M7 8l-3.5 4L7 16'} />
      <rect x={11} y={3} width={9} height={5} rx={2} />
      <rect x={11} y={9.5} width={9} height={5} rx={2} />
      <rect x={11} y={16} width={9} height={5} rx={2} />
    </svg>
  )
}

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
      <RailGlyph direction="fold" size={16} />
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
      <RailGlyph direction="reopen" size={18} />
    </button>
  )
}
