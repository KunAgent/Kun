import { useState, type ReactElement, type ReactNode } from 'react'
import { ChevronRight, Compass, LibraryBig, Newspaper, Rss, Trophy } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import type { WritePaperViewId } from '../../../write/write-workspace-store-types'
import { openPaperViewTab } from '../../../paper/paper-view'

const DISCOVER_OPEN_KEY = 'kun.paper.discoverNavOpen'

const DISCOVER_SOURCES: Array<{ view: WritePaperViewId; labelKey: string; icon: ReactNode }> = [
  { view: 'discover:arxiv', labelKey: 'writePaperDiscoverNav_arxiv', icon: <Newspaper className="h-3.5 w-3.5" strokeWidth={1.8} /> },
  { view: 'discover:venue', labelKey: 'writePaperDiscoverNav_venue', icon: <Trophy className="h-3.5 w-3.5" strokeWidth={1.8} /> },
  { view: 'discover:feeds', labelKey: 'writePaperDiscoverNav_feeds', icon: <Rss className="h-3.5 w-3.5" strokeWidth={1.8} /> }
]

function readOpen(): boolean {
  try {
    return window.localStorage.getItem(DISCOVER_OPEN_KEY) !== '0'
  } catch {
    return true
  }
}

function writeOpen(open: boolean): void {
  try {
    window.localStorage.setItem(DISCOVER_OPEN_KEY, open ? '1' : '0')
  } catch {
    // Browser storage can be unavailable; the default (open) still works.
  }
}

/** Compact 28px rows, same density as the paper tree below. */
function NavRow({
  icon,
  label,
  trailing,
  active,
  indent,
  onClick
}: {
  icon: ReactNode
  label: string
  trailing?: ReactNode
  active?: boolean
  indent?: boolean
  onClick: () => void
}): ReactElement {
  return (
    <button
      type="button"
      data-active={active ? 'true' : 'false'}
      onClick={onClick}
      className={`group flex h-7 w-full items-center gap-1.5 rounded-md text-left text-[13px] transition-colors duration-75 ${
        indent ? 'pl-7 pr-2' : 'px-2'
      } ${
        active
          ? 'bg-[var(--ds-sidebar-row-active)] font-medium text-ds-ink'
          : 'text-ds-muted hover:bg-ds-hover hover:text-ds-ink'
      }`}
    >
      <span className="flex h-4 w-4 shrink-0 items-center justify-center text-ds-muted">{icon}</span>
      <span className="min-w-0 flex-1 truncate">{label}</span>
      {trailing}
    </button>
  )
}

/**
 * Virtual nodes above the paper tree: the library table and the discover
 * sources (arXiv today, venues, feeds), each opening its own center tab.
 */
export function PaperSidebarNav({
  activeView,
  total
}: {
  activeView: WritePaperViewId | null
  total: number
}): ReactElement {
  const { t } = useTranslation('common')
  const [discoverOpen, setDiscoverOpen] = useState(readOpen)
  const toggleDiscover = (): void => {
    setDiscoverOpen((open) => {
      writeOpen(!open)
      return !open
    })
  }
  return (
    <div className="flex flex-col gap-px px-1.5">
      <NavRow
        icon={<LibraryBig className="h-3.5 w-3.5" strokeWidth={1.8} />}
        label={t('writePaperModeLibraryView')}
        active={activeView === 'library'}
        onClick={() => openPaperViewTab('library')}
        trailing={<span className="shrink-0 text-[11px] tabular-nums text-ds-faint">{total}</span>}
      />
      <NavRow
        icon={(
          <>
            <Compass className="h-3.5 w-3.5 group-hover:hidden" strokeWidth={1.8} />
            <ChevronRight
              className={`hidden h-3.5 w-3.5 transition-transform group-hover:block ${discoverOpen ? 'rotate-90' : ''}`}
              strokeWidth={1.9}
            />
          </>
        )}
        label={t('writePaperModeDiscover')}
        onClick={toggleDiscover}
      />
      {discoverOpen
        ? DISCOVER_SOURCES.map((source) => (
            <NavRow
              key={source.view}
              indent
              icon={source.icon}
              label={t(source.labelKey)}
              active={activeView === source.view}
              onClick={() => openPaperViewTab(source.view)}
            />
          ))
        : null}
    </div>
  )
}
