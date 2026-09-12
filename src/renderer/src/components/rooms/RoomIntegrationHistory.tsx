import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useRoomPage } from './useRoomPage'
import { roomButtonClass } from './RoomSettings'
import { RoomDiffViewer } from './RoomDiffViewer'
export function RoomIntegrationHistory({ roomId, path }: { roomId: string; path: string }) {
  const { t } = useTranslation('common')
  const [open, setOpen] = useState(false)
  const [selected, setSelected] = useState('')
  const page = useRoomPage<{ id: string; pinId: string; sha: string; createdAt?: string }>(roomId, open ? path + '/candidates' : null, 'candidates')
  return <details onToggle={(event) => setOpen(event.currentTarget.open)} className="text-xs text-ds-muted">
    <summary>{t('roomsHistory')}</summary>
    {open ? <div className="space-y-2">
      {page.items.map((candidate) => <button key={candidate.pinId} className={roomButtonClass} onClick={() => setSelected(candidate.pinId)}>{candidate.sha.slice(0, 12)} · {candidate.createdAt}</button>)}
      {page.nextCursor ? <button className={roomButtonClass} disabled={page.busy} onClick={() => void page.loadMore()}>{t('roomsLoadMore')}</button> : null}
      {selected ? <RoomDiffViewer roomId={roomId} path={path + '/diff?candidate=' + encodeURIComponent(selected)} /> : null}
      {page.error ? <p role="alert" className="text-red-500">{page.error}</p> : null}
    </div> : null}
  </details>
}
