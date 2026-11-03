import { useEffect, useRef, useState, type ReactElement } from 'react'
import { ChevronDown, ChevronUp, Search, X } from 'lucide-react'
import type { TerminalSearchResult } from './terminal-search'
import { searchTerminalPane, clearTerminalPaneSearch } from './terminal-pane-search'

type T = (key: string, options?: Record<string, unknown>) => string

/** Find-in-terminal popover: Enter / Shift+Enter step, Esc closes. */
export function TerminalFindBar({
  ptySessionId,
  initialQuery,
  onClose,
  t
}: {
  ptySessionId: string
  initialQuery?: string
  onClose: () => void
  t: T
}): ReactElement {
  const inputRef = useRef<HTMLInputElement>(null)
  const [query, setQuery] = useState(initialQuery ?? '')
  const [caseSensitive, setCaseSensitive] = useState(false)
  const [regex, setRegex] = useState(false)
  const [result, setResult] = useState<TerminalSearchResult>({ index: -1, count: 0, limited: false, invalid: false })

  useEffect(() => {
    inputRef.current?.focus()
    inputRef.current?.select()
  }, [])

  useEffect(() => {
    setResult(searchTerminalPane(ptySessionId, query, { caseSensitive, regex }, 'same'))
  }, [caseSensitive, ptySessionId, query, regex])

  useEffect(() => () => clearTerminalPaneSearch(ptySessionId), [ptySessionId])

  const step = (direction: 'next' | 'previous'): void => {
    setResult(searchTerminalPane(ptySessionId, query, { caseSensitive, regex }, direction))
  }
  const total = `${result.count}${result.limited ? '+' : ''}`
  const status = !query ? '' : result.invalid
    ? t('termDockFindInvalid')
    : result.count === 0 ? t('termDockFindNone') : t('termDockFindPosition', { current: result.index + 1, total })

  return (
    <div className="kun-terminal-popover kun-terminal-find" style={{ position: 'absolute' }} role="search" aria-label={t('termDockFind')}>
      <Search className="h-3.5 w-3.5 shrink-0 text-ds-muted" strokeWidth={1.8} aria-hidden="true" />
      <input
        ref={inputRef}
        value={query}
        aria-label={t('termDockFind')}
        placeholder={t('termDockFindPlaceholder')}
        onChange={(event) => setQuery(event.target.value)}
        onKeyDown={(event) => {
          if (event.key === 'Enter') {
            event.preventDefault()
            step(event.shiftKey ? 'previous' : 'next')
          } else if (event.key === 'Escape') {
            event.preventDefault()
            onClose()
          }
        }}
      />
      <span className="kun-terminal-find-count" data-invalid={result.invalid ? 'true' : undefined}>{status}</span>
      <button type="button" className="kun-terminal-icon-button kun-terminal-toggle" data-size="sm" aria-pressed={caseSensitive} title={t('termDockFindCase')} aria-label={t('termDockFindCase')} onClick={() => setCaseSensitive((value) => !value)}>Aa</button>
      <button type="button" className="kun-terminal-icon-button kun-terminal-toggle kun-terminal-mono" data-size="sm" aria-pressed={regex} title={t('termDockFindRegex')} aria-label={t('termDockFindRegex')} onClick={() => setRegex((value) => !value)}>.*</button>
      <span className="kun-terminal-sep" />
      <button type="button" className="kun-terminal-icon-button" data-size="sm" disabled={!result.count} title={t('termDockFindPrevious')} aria-label={t('termDockFindPrevious')} onClick={() => step('previous')}>
        <ChevronUp className="h-3.5 w-3.5" strokeWidth={1.8} />
      </button>
      <button type="button" className="kun-terminal-icon-button" data-size="sm" disabled={!result.count} title={t('termDockFindNext')} aria-label={t('termDockFindNext')} onClick={() => step('next')}>
        <ChevronDown className="h-3.5 w-3.5" strokeWidth={1.8} />
      </button>
      <button type="button" className="kun-terminal-icon-button" data-size="sm" title={t('termDockFindClose')} aria-label={t('termDockFindClose')} onClick={onClose}>
        <X className="h-3.5 w-3.5" strokeWidth={1.8} />
      </button>
    </div>
  )
}
