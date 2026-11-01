import type { ReactElement } from 'react'
import { ChevronRight, Clock3 } from 'lucide-react'

/**
 * Sidebar footer that points the scheduled-run sessions (hidden from the
 * project lists) at the Automation view that owns them.
 */
export function SidebarScheduledThreadsHint({ count, label, onOpen }: {
  count: number
  label: string
  onOpen: () => void
}): ReactElement | null {
  if (count <= 0) return null
  return <button
    type="button"
    data-sidebar-scheduled-threads-hint={count}
    onClick={onOpen}
    title={label}
    className="mx-1 mb-1 flex shrink-0 items-center gap-1.5 rounded-[9px] border border-dashed border-ds-border px-2 py-1.5 text-left text-[11.5px] leading-4 text-ds-faint transition hover:bg-[var(--ds-sidebar-row-hover)] hover:text-ds-muted"
  >
    <Clock3 className="h-3 w-3 shrink-0" strokeWidth={1.9} aria-hidden />
    <span className="min-w-0 flex-1 truncate">{label}</span>
    <ChevronRight className="h-3 w-3 shrink-0" strokeWidth={1.9} aria-hidden />
  </button>
}
