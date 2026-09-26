import { useCallback, useEffect, useRef, useState, type ReactElement } from 'react'
import { ChevronDown, ChevronUp, X } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import type { Editor } from '@tiptap/core'
import {
  SearchQuery,
  findNext,
  findPrev,
  getMatchHighlights,
  getSearchState,
  replaceAll,
  replaceNext,
  setSearchState
} from 'prosemirror-search'

type Props = {
  editor: Editor | null
  open: boolean
  withReplace: boolean
  onClose: () => void
}

const MAX_REPORTED_MATCHES = 1000

/**
 * Find/replace bar (implementation §9.8) backed by prosemirror-search.
 * Atom-node text (code blocks, math) stays out of scope by design — matches
 * inside those nodes are intentionally not reported.
 */
export function WriteFindBar({ editor, open, withReplace, onClose }: Props): ReactElement | null {
  const { t } = useTranslation('common')
  const [query, setQuery] = useState('')
  const [replacement, setReplacement] = useState('')
  const [caseSensitive, setCaseSensitive] = useState(false)
  const [wholeWord, setWholeWord] = useState(false)
  const [matchIndex, setMatchIndex] = useState(0)
  const [matchCount, setMatchCount] = useState(0)
  const inputRef = useRef<HTMLInputElement | null>(null)

  const applyQuery = useCallback((nextQuery: string, ci: boolean, ww: boolean): void => {
    if (!editor || editor.isDestroyed) return
    const searchQuery = new SearchQuery({
      search: nextQuery,
      caseSensitive: ci,
      wholeWord: ww
    })
    const tr = setSearchState(editor.state.tr, searchQuery)
    editor.view.dispatch(tr)
  }, [editor])

  const refreshCounts = useCallback((): void => {
    if (!editor || editor.isDestroyed) return
    const highlights = getMatchHighlights(editor.state)
    const matches = highlights.find(undefined, undefined, () => true)
    setMatchCount(matches.length)
    const { from, to } = editor.state.selection
    const active = matches.findIndex((match) => match.from <= from && match.to >= to)
    setMatchIndex(active >= 0 ? active + 1 : matches.length > 0 ? 1 : 0)
  }, [editor])

  useEffect(() => {
    if (!open || !editor || editor.isDestroyed) return
    applyQuery(query, caseSensitive, wholeWord)
    refreshCounts()
    const handler = (): void => refreshCounts()
    editor.on('update', handler)
    editor.on('selectionUpdate', handler)
    return () => {
      editor.off('update', handler)
      editor.off('selectionUpdate', handler)
    }
  }, [open, editor, query, caseSensitive, wholeWord, applyQuery, refreshCounts])

  useEffect(() => {
    if (open) {
      inputRef.current?.focus()
      inputRef.current?.select()
    }
  }, [open])

  useEffect(() => {
    if (!open && editor && !editor.isDestroyed) {
      applyQuery('', caseSensitive, wholeWord)
    }
    // Closing clears the search decorations once.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open])

  if (!open) return null

  const go = (direction: 1 | -1): void => {
    if (!editor || editor.isDestroyed) return
    const command = direction === 1 ? findNext : findPrev
    if (command(editor.state, editor.view.dispatch)) {
      editor.commands.focus()
    }
    refreshCounts()
  }

  const replaceCurrent = (): void => {
    if (!editor || editor.isDestroyed) return
    const searchState = getSearchState(editor.state)
    if (!searchState) return
    const query = new SearchQuery({
      search: searchState.query.search,
      caseSensitive: searchState.query.caseSensitive,
      wholeWord: searchState.query.wholeWord,
      regexp: searchState.query.regexp,
      replace: replacement
    })
    editor.view.dispatch(setSearchState(editor.state.tr, query))
    if (replaceNext(editor.state, editor.view.dispatch)) refreshCounts()
  }

  const replaceEvery = (): void => {
    if (!editor || editor.isDestroyed) return
    const searchState = getSearchState(editor.state)
    if (!searchState) return
    const query = new SearchQuery({
      search: searchState.query.search,
      caseSensitive: searchState.query.caseSensitive,
      wholeWord: searchState.query.wholeWord,
      regexp: searchState.query.regexp,
      replace: replacement
    })
    editor.view.dispatch(setSearchState(editor.state.tr, query))
    if (replaceAll(editor.state, editor.view.dispatch)) refreshCounts()
  }

  const label = matchCount > MAX_REPORTED_MATCHES
    ? `${matchIndex} / ${MAX_REPORTED_MATCHES}+`
    : `${matchIndex} / ${matchCount}`

  return (
    <div className="write-find-bar" role="search">
      <div className="write-find-row">
        <input
          ref={inputRef}
          className="write-find-input"
          value={query}
          placeholder={t('writeFindPlaceholder')}
          onChange={(event) => {
            setQuery(event.target.value)
            applyQuery(event.target.value, caseSensitive, wholeWord)
          }}
          onKeyDown={(event) => {
            if (event.key === 'Enter') {
              event.preventDefault()
              go(event.shiftKey ? -1 : 1)
            } else if (event.key === 'Escape') {
              event.preventDefault()
              onClose()
            }
          }}
        />
        <span className="write-find-count">{label}</span>
        <button type="button" className="write-find-button" title={t('writeFindPrevious')} aria-label={t('writeFindPrevious')} onClick={() => go(-1)}>
          <ChevronUp className="h-3.5 w-3.5" />
        </button>
        <button type="button" className="write-find-button" title={t('writeFindNext')} aria-label={t('writeFindNext')} onClick={() => go(1)}>
          <ChevronDown className="h-3.5 w-3.5" />
        </button>
        <button
          type="button"
          className={`write-find-button${caseSensitive ? ' is-active' : ''}`}
          title={t('writeFindCaseSensitive')}
          aria-label={t('writeFindCaseSensitive')}
          aria-pressed={caseSensitive}
          onClick={() => {
            setCaseSensitive((current) => {
              applyQuery(query, !current, wholeWord)
              return !current
            })
          }}
        >
          Aa
        </button>
        <button
          type="button"
          className={`write-find-button${wholeWord ? ' is-active' : ''}`}
          title={t('writeFindWholeWord')}
          aria-label={t('writeFindWholeWord')}
          aria-pressed={wholeWord}
          onClick={() => {
            setWholeWord((current) => {
              applyQuery(query, caseSensitive, !current)
              return !current
            })
          }}
        >
          W
        </button>
        <button type="button" className="write-find-button" title={t('writeFindClose')} aria-label={t('writeFindClose')} onClick={onClose}>
          <X className="h-3.5 w-3.5" />
        </button>
      </div>
      {withReplace ? (
        <div className="write-find-row">
          <input
            className="write-find-input"
            value={replacement}
            placeholder={t('writeReplacePlaceholder')}
            onChange={(event) => setReplacement(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === 'Enter') {
                event.preventDefault()
                replaceCurrent()
              } else if (event.key === 'Escape') {
                event.preventDefault()
                onClose()
              }
            }}
          />
          <button type="button" className="write-find-button write-find-text-button" onClick={replaceCurrent}>
            {t('writeReplaceOne')}
          </button>
          <button type="button" className="write-find-button write-find-text-button" onClick={replaceEvery}>
            {t('writeReplaceAll')}
          </button>
        </div>
      ) : null}
    </div>
  )
}
