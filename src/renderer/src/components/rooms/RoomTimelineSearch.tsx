import { useEffect, useRef, useState } from 'react'
import { Search, X } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import type { RoomMessage } from '@shared/rooms-api'
import { roomPath, roomsRequest } from './rooms-client'
import { roomButtonClass, roomFieldClass } from './RoomSettings'

/** Independent result scroller stays mounted and preserves its position on selection. */
export function RoomTimelineSearch({ roomId, selectedId, onSelect, onClose }: {
  roomId: string; selectedId?: string; onSelect: (message: RoomMessage) => void; onClose: () => void
}) {
  const { t } = useTranslation('common')
  const [query, setQuery] = useState(''), [results, setResults] = useState<RoomMessage[]>([])
  const [cursor, setCursor] = useState<string>(), [busy, setBusy] = useState(false), [error, setError] = useState('')
  const generation = useRef(0), controller = useRef<AbortController | null>(null)
  const input = useRef<HTMLInputElement>(null), selected = useRef<HTMLButtonElement>(null)
  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null
    input.current?.focus()
    return () => { controller.current?.abort(); if (previous?.isConnected) previous.focus() }
  }, [])
  useEffect(() => {
    const serial = ++generation.current
    controller.current?.abort()
    const abort = new AbortController(); controller.current = abort
    setCursor(undefined); setResults([]); setError(''); setBusy(false)
    if (query.trim().length < 2) return
    const timer = setTimeout(() => {
      setBusy(true)
      void roomsRequest<{ messages: RoomMessage[]; nextCursor?: string }>(
        `${roomPath(roomId)}/search?q=${encodeURIComponent(query.trim())}`, 'GET', undefined, abort.signal)
        .then((page) => { if (generation.current === serial && !abort.signal.aborted) { setResults(page.messages); setCursor(page.nextCursor) } })
        .catch((cause) => { if (!abort.signal.aborted) setError(String(cause)) })
        .finally(() => { if (generation.current === serial && !abort.signal.aborted) setBusy(false) })
    }, 250)
    return () => { clearTimeout(timer); abort.abort() }
  }, [query, roomId])
  const more = async () => {
    const serial = generation.current
    setBusy(true)
    try {
      const page = await roomsRequest<{ messages: RoomMessage[]; nextCursor?: string }>(
        `${roomPath(roomId)}/search?q=${encodeURIComponent(query.trim())}&cursor=${encodeURIComponent(cursor!)}`,
        'GET', undefined, controller.current?.signal)
      if (serial !== generation.current || controller.current?.signal.aborted) return
      setResults((current) => [...new Map([...current, ...page.messages].map((message) => [message.id, message])).values()])
      setCursor(page.nextCursor)
    } catch (cause) { if (serial === generation.current && !controller.current?.signal.aborted) setError(String(cause)) }
    finally { if (serial === generation.current) setBusy(false) }
  }
  return <aside className="rooms-timeline-results" aria-label={t('roomsSearchMessages')}>
    <div className="rooms-timeline-search">
      <Search size={16} aria-hidden="true" />
      <input ref={input} className={roomFieldClass} aria-label={t('roomsSearchMessages')} placeholder={t('roomsSearchMessages')}
        value={query} onChange={(event) => setQuery(event.target.value)}
        onKeyDown={(event) => { if (event.key === 'Escape') { event.stopPropagation(); onClose() } }} />
      <button type="button" className={roomButtonClass} aria-label={t('roomsClose')} onClick={onClose}><X size={16} /></button>
    </div>
    {selectedId ? <button type="button" className="rooms-search-return" onClick={() => selected.current?.focus()}>
      {t('roomsReturnToSearch', { defaultValue: 'Return to selected result' })}</button> : null}
    <div className="rooms-search-result-scroll">
      {results.map((message) => <button type="button" key={message.id} ref={message.id === selectedId ? selected : undefined}
        className="rooms-search-result" aria-pressed={message.id === selectedId} onClick={() => onSelect(message)}>
        <strong>{message.authorLabelSnapshot}</strong><time dateTime={message.createdAt}>{new Date(message.createdAt).toLocaleString()}</time>
        <span>{message.body.slice(0, 400)}</span>
      </button>)}
      {busy ? <p role="status">{t('roomsLoading')}</p> : query.trim().length >= 2 && !results.length ? <p>{t('roomsNoResults')}</p> : null}
      {error ? <p role="alert">{error}</p> : null}
      {cursor ? <button type="button" className={roomButtonClass} disabled={busy} onClick={() => void more()}>{t('roomsMoreResults')}</button> : null}
    </div>
  </aside>
}
