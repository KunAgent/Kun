import { useEffect, useRef, useState, type ReactElement, type ReactNode, type RefObject } from 'react'
import { History, Loader2, Plus, Sparkles, X } from 'lucide-react'
import type { ResearchSessionSummary } from '../../../paper/paper-research-sessions'
import type { PaperSearchHistoryEntry } from '../../../paper/paper-search-prefs'
import { threadLooksRunning } from '../../../store/chat-store-runtime-helpers'
import { writeBasenameFromPath } from '../../../write/write-workspace-store'
import { normalizePath } from '../../../write/write-workspace-store-helpers'
import { formatRelativeTime } from '../../../lib/format-relative-time'
import layout from './PaperSearchLayout.module.css'

const RAIL_KEY = 'kun.paper.searchRailOpen'
const NARROW_PX = 980

function readRailOpen(): boolean {
  try {
    return window.localStorage.getItem(RAIL_KEY) !== '0'
  } catch {
    return true
  }
}

/**
 * Shared right-column state for the search page: persisted open flag,
 * narrow-container detection (rail becomes an overlay), and Escape /
 * outside-pointer closing while overlaid.
 */
export function usePaperSearchRail(
  surfaceRef: RefObject<HTMLElement | null>
): {
  railOpen: boolean
  narrow: boolean
  railRef: RefObject<HTMLElement | null>
  toggleRail: () => void
  closeRail: () => void
} {
  const [railOpen, setRailOpen] = useState(readRailOpen)
  const [narrow, setNarrow] = useState(false)
  const railRef = useRef<HTMLElement | null>(null)

  useEffect(() => {
    const node = surfaceRef.current
    if (!node || typeof ResizeObserver !== 'function') return
    const observer = new ResizeObserver((entries) => {
      const width = entries[0]?.contentRect.width ?? 0
      setNarrow(width > 0 && width <= NARROW_PX)
    })
    observer.observe(node)
    return () => observer.disconnect()
  }, [surfaceRef])

  const setOpen = (open: boolean): void => {
    setRailOpen(open)
    try {
      window.localStorage.setItem(RAIL_KEY, open ? '1' : '0')
    } catch {
      // Panel memory is a convenience only.
    }
  }

  useEffect(() => {
    if (!narrow || !railOpen) return
    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') setOpen(false)
    }
    const onPointerDown = (event: PointerEvent): void => {
      if (!railRef.current?.contains(event.target as Node)) setOpen(false)
    }
    document.addEventListener('keydown', onKeyDown)
    document.addEventListener('pointerdown', onPointerDown, true)
    return () => {
      document.removeEventListener('keydown', onKeyDown)
      document.removeEventListener('pointerdown', onPointerDown, true)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [narrow, railOpen])

  return {
    railOpen,
    narrow,
    railRef,
    toggleRail: () => setOpen(!railOpen),
    closeRail: () => setOpen(false)
  }
}

/** Right rail container shared by quick-search history and Agent sessions. */
export function PaperSearchRail({
  overlay,
  railRef,
  header,
  flush = false,
  children
}: {
  overlay: boolean
  railRef: RefObject<HTMLElement | null>
  header: ReactNode
  /** Children fill the rail body directly (own scrolling/padding), e.g. the pool. */
  flush?: boolean
  children: ReactNode
}): ReactElement {
  return (
    <aside ref={railRef} className={layout.rail} data-overlay={overlay ? 'true' : 'false'}>
      <div className={layout.historyHeader}>{header}</div>
      {flush ? (
        <div className="flex min-h-0 flex-1 flex-col">{children}</div>
      ) : (
        <div className={layout.historyList}>{children}</div>
      )}
    </aside>
  )
}

export function PaperSearchRailClose({ onClose, label }: { onClose: () => void; label: string }): ReactElement {
  return (
    <button
      type="button"
      onClick={onClose}
      aria-label={label}
      title={label}
      className="ml-auto inline-flex h-6 w-6 shrink-0 items-center justify-center rounded-md text-ds-faint transition hover:bg-ds-hover hover:text-ds-ink"
    >
      <X className="h-3.5 w-3.5" strokeWidth={2} />
    </button>
  )
}

export type AgentHistorySession = ResearchSessionSummary & { libraryRoot: string }

/**
 * Agent research sessions across every workspace (§3.3): 「新建检索」 row on
 * top, then each session titled by its conversation and subtitled with its
 * workspace name + relative time.
 */
export function PaperAgentSessionRows({
  sessions,
  activeRoot,
  activeSessionId,
  locale,
  onSelect,
  onNew,
  emptyLabel,
  newLabel,
  runningLabel
}: {
  sessions: readonly AgentHistorySession[]
  /** Normalized mounted root — active highlight compares root + sessionId. */
  activeRoot: string
  activeSessionId: string | null
  locale: string
  onSelect: (session: AgentHistorySession) => void
  onNew: () => void
  emptyLabel: string
  newLabel: string
  runningLabel: string
}): ReactElement {
  const active = (session: AgentHistorySession): boolean =>
    session.sessionId === activeSessionId &&
    normalizePath(session.libraryRoot) === normalizePath(activeRoot)
  return (
    <>
      <button type="button" data-paper-research-new onClick={onNew} className={layout.historyRow}>
        <span className={layout.historyTitle}>
          <Plus className="h-3 w-3" strokeWidth={2} />
          <span>{newLabel}</span>
        </span>
      </button>
      {sessions.map((session) => {
        const running = threadLooksRunning(session)
        const workspace = writeBasenameFromPath(session.libraryRoot) || session.libraryRoot
        return (
          <button
            key={`${session.libraryRoot}/${session.sessionId}`}
            type="button"
            data-active={active(session) ? 'true' : 'false'}
            title={`${workspace} · ${session.title}`}
            onClick={() => onSelect(session)}
            className={layout.historyRow}
          >
            <span className={layout.historyTitle}>
              {running ? (
                <Loader2 className="h-3 w-3 animate-spin text-[var(--ds-accent)]" strokeWidth={2} />
              ) : (
                <Sparkles className="h-3 w-3" strokeWidth={1.8} />
              )}
              <span>{session.title}</span>
            </span>
            <span className={layout.historyMeta}>
              {workspace}
              {' · '}
              {running && !session.updatedAt
                ? runningLabel
                : formatRelativeTime(session.updatedAt ?? '', locale)}
            </span>
          </button>
        )
      })}
      {sessions.length === 0 ? <p className={layout.historyEmpty}>{emptyLabel}</p> : null}
    </>
  )
}

/** Quick-search history rows (`kun.paper.searchHistory` order is kept). */
export function PaperQuickSearchRows({
  entries,
  locale,
  emptyLabel,
  onPick
}: {
  entries: readonly PaperSearchHistoryEntry[]
  locale: string
  emptyLabel: string
  onPick: (entry: PaperSearchHistoryEntry) => void
}): ReactElement {
  return (
    <>
      {entries.map((entry) => (
        <button
          key={`${entry.at}:${entry.query}`}
          type="button"
          title={new Date(entry.at).toLocaleString()}
          onClick={() => onPick(entry)}
          className={layout.historyRow}
        >
          <span className={layout.historyTitle}>
            <History className="h-3 w-3" strokeWidth={1.8} />
            <span>{entry.query}</span>
          </span>
          <span className={layout.historyMeta}>
            {formatRelativeTime(new Date(entry.at).toISOString(), locale)}
          </span>
        </button>
      ))}
      {entries.length === 0 ? <p className={layout.historyEmpty}>{emptyLabel}</p> : null}
    </>
  )
}
