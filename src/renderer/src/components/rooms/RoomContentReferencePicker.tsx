import { useEffect, useState } from 'react'
import { FilePlus2, X } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import type { Room, RoomTask, RoomContentReference } from '@shared/rooms-api'
import { RoomPopover } from './RoomPopover'
import { roomsRequest } from './rooms-client'
import { roomContentKey } from './room-content-client'
import './rooms-content.css'

export function RoomContentReferenceChips({ references, onChange, disabled }: {
  references: RoomContentReference[]; onChange: (references: RoomContentReference[]) => void; disabled?: boolean
}) {
  const { t } = useTranslation('common')
  return <>{references.map((reference) => <button key={roomContentKey(reference)} type="button" className="rooms-composer-chip"
    disabled={disabled} onClick={() => onChange(references.filter((item) => roomContentKey(item) !== roomContentKey(reference)))}
    aria-label={t('roomsRemoveContext', { name: reference.titleSnapshot ?? t(`roomsContent_${reference.kind}`) })}>
    <FilePlus2 size={13} /><span>{reference.titleSnapshot ?? t(`roomsContent_${reference.kind}`)}</span><X size={12} />
  </button>)}</>
}

function ReferenceOptions({ room, tasks, references, onChoose }: {
  room: Room; tasks: RoomTask[]; references: RoomContentReference[]; onChoose: (reference: RoomContentReference) => void
}) {
  const { t } = useTranslation('common')
  const [kind, setKind] = useState<RoomContentReference['kind']>('task')
  const [repositoryId, setRepositoryId] = useState(room.repositories[0]?.id ?? '')
  const [query, setQuery] = useState(''), [error, setError] = useState(''), [loading, setLoading] = useState(false)
  const scope = JSON.stringify([room.id, room.revision, kind, repositoryId, query])
  const [page, setPage] = useState<{ scope: string; cursor?: string }>({ scope })
  const [loaded, setLoaded] = useState<{ scope: string; references: RoomContentReference[]; nextCursor?: string }>({ scope, references: [] })
  const [retry, setRetry] = useState(0)
  const cursor = page.scope === scope ? page.cursor : undefined
  const options = loaded.scope === scope ? loaded.references : []
  const nextCursor = loaded.scope === scope ? loaded.nextCursor : undefined
  useEffect(() => {
    const controller = new AbortController()
    setError(''); setLoading(true)
    if (!cursor) setLoaded({ scope, references: kind === 'task' ? tasks.filter((task) => task.title.toLocaleLowerCase().includes(query.toLocaleLowerCase()))
      .slice(0, 30).map((task) => ({ kind, taskId: task.id, titleSnapshot: task.title })) : [] })
    const timer = setTimeout(() => {
      const params = new URLSearchParams({ kind, query })
      if (repositoryId) params.set('repository_id', repositoryId)
      if (cursor) params.set('cursor', cursor)
      void roomsRequest<{ references: RoomContentReference[]; nextCursor?: string }>(`/v1/rooms/${encodeURIComponent(room.id)}/content-options?${params}`,
        'GET', undefined, controller.signal).then((value) => {
          if (controller.signal.aborted) return
          setLoaded((current) => ({ scope,
            references: [...new Map([...(cursor && current.scope === scope ? current.references : []), ...value.references].map((item) => [roomContentKey(item), item])).values()],
            nextCursor: value.nextCursor }))
        })
        .catch(() => { if (!controller.signal.aborted) setError(t('roomsContentUnavailable')) })
        .finally(() => { if (!controller.signal.aborted) setLoading(false) })
    }, 200)
    return () => { clearTimeout(timer); controller.abort() }
  }, [room.id, kind, query, repositoryId, tasks, t, scope, cursor, retry])
  const selected = new Set(references.map(roomContentKey))
  return <div className="rooms-reference-picker">
    <label>{t('roomsContentType')}<select value={kind} onChange={(event) => setKind(event.target.value as typeof kind)}>
      {(['task', 'repository_file', 'delivery', 'board_card'] as const).map((value) => <option key={value} value={value}>{t(`roomsContent_${value}`)}</option>)}
    </select></label>
    {kind === 'repository_file' || kind === 'board_card' ? <label>{t('roomsDefaultRepository')}
      <select value={repositoryId} onChange={(event) => setRepositoryId(event.target.value)}>
        <option value="">{t('roomsNoRepository')}</option>
        {room.repositories.map((repository) => <option key={repository.id} value={repository.id}>{repository.displayName}</option>)}
      </select></label> : null}
    <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder={t('roomsContentSearch')} aria-label={t('roomsContentSearch')} />
    <div className="rooms-reference-options">
      {options.map((reference) => <button type="button" key={roomContentKey(reference)} disabled={selected.has(roomContentKey(reference)) || references.length >= 20}
        onClick={() => onChoose(reference)}>{reference.titleSnapshot ?? t(`roomsContent_${reference.kind}`)}</button>)}
      {!options.length ? <p>{error || t(loading ? 'roomsLoading' : nextCursor ? 'roomsContentNoPageResults' : 'roomsNoResults')}</p> : null}
    </div>
    {error ? <button type="button" onClick={() => setRetry((value) => value + 1)}>{t('roomsContentRetry')}</button>
      : nextCursor ? <button type="button" disabled={loading} onClick={() => setPage({ scope, cursor: nextCursor })}>
        {t(loading ? 'roomsLoading' : 'roomsContentLoadMore')}</button> : null}
  </div>
}

export function RoomContentReferencePicker({ room, tasks, references, onChange, disabled, showLabel = false }: {
  room: Room; tasks: RoomTask[]; references: RoomContentReference[]
  onChange: (references: RoomContentReference[]) => void; disabled?: boolean; showLabel?: boolean
}) {
  const { t } = useTranslation('common')
  return <RoomPopover label={t('roomsContentAddReference')} trigger={<><FilePlus2 size={17} />{showLabel ? <span>{t('roomsContentAddReference')}</span> : null}</>} side="top"
    disabled={disabled || references.length >= 20} className={showLabel ? 'direct-reference-button' : 'rooms-composer-tool'}>
    {(close) => <ReferenceOptions room={room} tasks={tasks} references={references} onChoose={(reference) => {
      if (references.length < 20 && !references.some((item) => roomContentKey(item) === roomContentKey(reference))) onChange([...references, reference])
      close()
    }} />}
  </RoomPopover>
}
