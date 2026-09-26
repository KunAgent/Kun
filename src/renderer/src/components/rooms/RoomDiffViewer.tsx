import { useEffect, useMemo, useRef, useState } from 'react'
import { useVirtualizer } from '@tanstack/react-virtual'
import { useTranslation } from 'react-i18next'
import { roomsRequest } from './rooms-client'
import { useRoomResource } from './useRoomResource'
import { roomButtonClass, roomFieldClass } from './RoomSettings'
import { RoomTextEvidence } from './RoomTextEvidence'
type Files = { files: string[]; total: number; nextCursor?: number; reason?: string }
export function RoomDiffViewer({ roomId, path }: { roomId: string; path: string }) {
  const { t } = useTranslation('common')
  const [open, setOpen] = useState(false)
  const [files, setFiles] = useState<string[]>([])
  const [cursor, setCursor] = useState<number | undefined>()
  const [query, setQuery] = useState('')
  const [selected, setSelected] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const resource = useRoomResource<Files>(roomId, open ? path : null, false)
  const scroller = useRef<HTMLDivElement>(null)
  const shown = useMemo(() => files.filter((file) => file.toLocaleLowerCase().includes(query.toLocaleLowerCase())), [files, query])
  const virtualizer = useVirtualizer({ count: shown.length, getScrollElement: () => scroller.current, estimateSize: () => 30, overscan: 5 })
  useEffect(() => { setFiles([]); setSelected(''); setQuery(''); setCursor(undefined); setError('') }, [path])
  useEffect(() => {
    if (resource.data) { setFiles(resource.data.files); setCursor(resource.data.nextCursor) }
  }, [resource.data])
  const more = async () => {
    if (cursor === undefined || busy) return
    setBusy(true)
    try {
      const page = await roomsRequest<Files>(path + (path.includes('?') ? '&' : '?') + 'cursor=' + cursor)
      setFiles((old) => [...new Set([...old, ...page.files])]); setCursor(page.nextCursor)
    } catch (cause) { setError(String(cause)) }
    finally { setBusy(false) }
  }
  const row = (file: string) => <button className={'w-full truncate px-2 text-left text-xs ' + (selected === file ? 'text-ds-accent' : 'text-ds-ink')}
    title={file} onClick={() => setSelected(file)}>{file}</button>
  return <details onToggle={(event) => setOpen(event.currentTarget.open)}>
    <summary className="cursor-pointer text-sm text-ds-ink">{t('roomsDiff')}{resource.data ? ' (' + resource.data.total + ')' : ''}</summary>
    {open ? <div className="mt-2 space-y-2">
      <input className={roomFieldClass} placeholder={t('roomsSearchFiles')} aria-label={t('roomsSearchFiles')} value={query} onChange={(event) => setQuery(event.target.value)} />
      <div ref={scroller} className="max-h-44 overflow-auto rounded border border-ds-border">
        {shown.length > 40 ? <div style={{ height: virtualizer.getTotalSize(), position: 'relative' }}>
          {virtualizer.getVirtualItems().map((item) => <div key={shown[item.index]} style={{ position: 'absolute', top: item.start, height: item.size, width: '100%' }}>{row(shown[item.index])}</div>)}
        </div> : shown.map((file) => <div key={file} className="h-[30px]">{row(file)}</div>)}
      </div>
      {cursor !== undefined ? <button className={roomButtonClass} disabled={busy} onClick={() => void more()}>{t('roomsLoadMore')}</button> : null}
      {resource.data?.reason ? <p className="text-xs text-ds-muted">{resource.data.reason}</p> : null}
      {selected ? <RoomTextEvidence key={path + selected} roomId={roomId} path={path + (path.includes('?') ? '&' : '?') + 'file=' + encodeURIComponent(selected)} label={selected} fileName={selected.split('/').at(-1) + '.diff'} /> : null}
      {resource.error || error ? <p role="alert" className="text-xs text-red-500">{resource.error || error}</p> : null}
    </div> : null}
  </details>
}
