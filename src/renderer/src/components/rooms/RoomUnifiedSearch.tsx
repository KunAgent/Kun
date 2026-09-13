import { useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import type { RoomSearchHit, RoomSearchPage } from '@shared/rooms-api'
import { roomsRequest } from './rooms-client'
import './rooms-experience.css'

const kinds = ['rooms', 'members', 'messages', 'tasks'] as const
export function RoomUnifiedSearch({ query, repositoryRoot, includeArchived, onSelect }: {
  query: string; repositoryRoot: string; includeArchived: boolean; onSelect: (hit: RoomSearchHit) => void
}) {
  const { t } = useTranslation('common')
  const [pages, setPages] = useState<Partial<Record<typeof kinds[number], RoomSearchPage>>>({})
  const [error, setError] = useState(''), [busy, setBusy] = useState(false)
  const active = useRef<AbortController | null>(null)
  const path = (kind: typeof kinds[number], cursor?: string) => '/v1/rooms/search?' + new URLSearchParams({
    q: query.trim(), kind, limit: '10', include_archived: String(includeArchived),
    ...(repositoryRoot ? { repository_root: repositoryRoot } : {}), ...(cursor ? { cursor } : {}) })
  const paths = kinds.map((kind) => path(kind)).join('|')
  useEffect(() => {
    const controller = new AbortController(); active.current = controller
    setPages({}); setError(''); setBusy(true)
    const timer = setTimeout(() => {
      void Promise.allSettled(paths.split('|').map((url) => roomsRequest<RoomSearchPage>(url, 'GET', undefined, controller.signal)))
        .then((results) => {
          if (controller.signal.aborted) return
          setPages(Object.fromEntries(results.flatMap((result, index) => result.status === 'fulfilled' ? [[kinds[index], result.value]] : [])))
          const failure = results.find((result) => result.status === 'rejected')
          if (failure?.status === 'rejected') setError(String(failure.reason))
          setBusy(false)
        })
    }, 200)
    return () => { clearTimeout(timer); controller.abort() }
  }, [paths])
  const more = async (kind: typeof kinds[number]) => {
    const cursor = pages[kind]?.nextCursor, signal = active.current?.signal
    if (!cursor || !signal || busy) return
    setBusy(true)
    try {
      const page = await roomsRequest<RoomSearchPage>(path(kind, cursor), 'GET', undefined, signal)
      if (!signal.aborted) setPages((current) => ({ ...current, [kind]: { ...page, results: [...(current[kind]?.results ?? []), ...page.results] } }))
    } catch (cause) { if (!signal.aborted) setError(String(cause)) }
    finally { if (!signal.aborted) setBusy(false) }
  }
  return <section className="rooms-unified-search" aria-label={t('roomsUnifiedSearch')}>
    {busy ? <p className="rooms-run-note">{t('roomsLoading')}</p> : null}
    {kinds.map((kind) => <section key={kind}><h3>{t('roomsSearchKind_' + kind)}</h3>
      {(pages[kind]?.results ?? []).map((hit) => <button type="button" key={hit.id} onClick={() => onSelect(hit)}>
        <strong>{hit.title}</strong><small>{hit.roomName}</small><span>{hit.preview}</span>
      </button>)}
      {pages[kind]?.nextCursor ? <button type="button" disabled={busy} onClick={() => void more(kind)}>{t('roomsLoadMore')}</button> : null}
    </section>)}
    {!busy && !kinds.some((kind) => pages[kind]?.results.length) ? <p className="rooms-run-note">{t('roomsSearchNoResults')}</p> : null}
    {error ? <p role="alert" className="rooms-run-error">{error}</p> : null}
  </section>
}
