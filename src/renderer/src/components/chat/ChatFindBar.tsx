import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactElement
} from 'react'
import { useTranslation } from 'react-i18next'
import { ChevronDown, ChevronUp, Search, X } from 'lucide-react'
import type { ChatBlock } from '../../agent/types'
import {
  closeChatFind,
  collectChatFindHits,
  requestChatFindJump,
  useChatFindStore
} from './chat-find'

const FIND_DEBOUNCE_MS = 120

/**
 * Floating in-conversation find bar (Ctrl+F / Cmd+F). Searches the loaded
 * transcript client-side and lands on the exact block via the timeline's
 * turn-reveal plumbing — a hit inside a collapsed earlier page is revealed
 * before it is scrolled into view.
 */
export function ChatFindBar({
  activeThreadId,
  blocks
}: {
  activeThreadId: string | null
  blocks: ChatBlock[]
}): ReactElement | null {
  const { t } = useTranslation('common')
  const open = useChatFindStore((state) => state.openThreadId === activeThreadId)
  const inputRef = useRef<HTMLInputElement>(null)
  const restoreFocusRef = useRef<Element | null>(null)
  const [query, setQuery] = useState('')
  const [debouncedQuery, setDebouncedQuery] = useState('')
  const [index, setIndex] = useState(0)

  // Open grabs the current text selection as the query — the classic
  // find-something-you-saw gesture — and returns focus when dismissed.
  useEffect(() => {
    if (!open) return
    restoreFocusRef.current = document.activeElement
    const selection = window.getSelection()?.toString().trim() ?? ''
    setQuery(selection.slice(0, 120))
    setIndex(0)
    const frame = window.requestAnimationFrame(() => {
      inputRef.current?.focus()
      inputRef.current?.select()
    })
    return () => {
      window.cancelAnimationFrame(frame)
      const restore = restoreFocusRef.current
      if (restore instanceof HTMLElement && restore.isConnected) restore.focus()
    }
  }, [open])

  useEffect(() => {
    const timer = window.setTimeout(() => setDebouncedQuery(query), FIND_DEBOUNCE_MS)
    return () => window.clearTimeout(timer)
  }, [query])

  const hits = useMemo(
    () => (open ? collectChatFindHits(blocks, debouncedQuery) : []),
    [blocks, debouncedQuery, open]
  )

  useEffect(() => {
    setIndex((current) => Math.min(current, Math.max(0, hits.length - 1)))
  }, [hits.length])

  const land = (next: number): void => {
    const hit = hits[next]
    if (!hit || !activeThreadId) return
    setIndex(next)
    requestChatFindJump(activeThreadId, hit.turnKey, hit.blockId)
  }
  const move = (delta: number): void => {
    if (!hits.length) return
    land((index + delta + hits.length) % hits.length)
  }

  // A fresh result set lands on its first hit, mirroring browser find.
  const landedHitsRef = useRef<typeof hits>([])
  useEffect(() => {
    if (landedHitsRef.current === hits) return
    landedHitsRef.current = hits
    if (hits.length > 0) land(0)
    // `land` reads the hits that produced this pass; indexing state updates
    // inside are intentional.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [hits])

  if (!open || !activeThreadId) return null

  const trimmed = debouncedQuery.trim()
  const countLabel = !trimmed
    ? ''
    : hits.length
      ? `${index + 1} / ${hits.length}`
      : t('findInChatNoResults')
  const currentPreview = hits[index]?.preview ?? ''

  return (
    <div
      className="ds-no-drag pointer-events-auto absolute right-3 top-2 z-30 flex items-center gap-1.5 rounded-xl border border-ds-border bg-ds-card px-2 py-1.5 shadow-[0_10px_32px_rgba(20,47,95,0.16)]"
      role="search"
      aria-label={t('findInChatTitle')}
    >
      <Search className="h-4 w-4 shrink-0 text-ds-faint" strokeWidth={1.9} aria-hidden="true" />
      <input
        ref={inputRef}
        value={query}
        onChange={(event) => setQuery(event.target.value)}
        onKeyDown={(event) => {
          if (event.key === 'Escape') {
            event.preventDefault()
            event.stopPropagation()
            closeChatFind()
          } else if (event.key === 'Enter') {
            event.preventDefault()
            move(event.shiftKey ? -1 : 1)
          }
        }}
        placeholder={t('findInChatPlaceholder')}
        aria-label={t('findInChatTitle')}
        className="w-44 min-w-0 flex-1 bg-transparent px-1 text-[13px] text-ds-ink outline-none placeholder:text-ds-faint sm:w-56"
      />
      <span
        className="min-w-12 max-w-40 truncate text-right text-[11.5px] tabular-nums text-ds-muted"
        title={currentPreview}
        aria-live="polite"
      >
        {countLabel}
      </span>
      <button
        type="button"
        onClick={() => move(-1)}
        disabled={!hits.length}
        aria-label={t('findInChatPrevious')}
        title={t('findInChatPrevious')}
        className="rounded-md p-1 text-ds-muted transition hover:bg-ds-hover hover:text-ds-ink disabled:opacity-35"
      >
        <ChevronUp className="h-4 w-4" strokeWidth={1.9} />
      </button>
      <button
        type="button"
        onClick={() => move(1)}
        disabled={!hits.length}
        aria-label={t('findInChatNext')}
        title={t('findInChatNext')}
        className="rounded-md p-1 text-ds-muted transition hover:bg-ds-hover hover:text-ds-ink disabled:opacity-35"
      >
        <ChevronDown className="h-4 w-4" strokeWidth={1.9} />
      </button>
      <button
        type="button"
        onClick={closeChatFind}
        aria-label={t('close')}
        title={t('close')}
        className="rounded-md p-1 text-ds-muted transition hover:bg-ds-hover hover:text-ds-ink"
      >
        <X className="h-4 w-4" strokeWidth={1.9} />
      </button>
    </div>
  )
}
