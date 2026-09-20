import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import type { RoomTask } from '@shared/rooms-api'
import { roomPath, type RoomRequestEntry } from './rooms-client'
import { useRoomPage } from './useRoomPage'
import { roomButtonClass } from './RoomSettings'
export function RoomRequestTaskLinks({ roomId, request, onTask }: { roomId: string; request: RoomRequestEntry; onTask: (id: string) => void }) {
  const { t } = useTranslation('common')
  const [open, setOpen] = useState(false)
  const page = useRoomPage<RoomTask>(roomId, open ? roomPath(roomId) + '/tasks?request_id=' + encodeURIComponent(request.id) : null, 'tasks')
  return <>
    {request.outcome?.tasksTruncated ? <button className={roomButtonClass} aria-expanded={open} onClick={() => setOpen(!open)}>{t('roomsAllRequestTasks')}</button> : null}
    {open ? <div className="max-h-44 w-full space-y-1 overflow-auto">
      {page.items.map((task) => <button key={task.id} className="block w-full truncate text-left text-xs text-ds-accent" onClick={() => onTask(task.id)}>{task.title} · {t('roomsState_' + task.status)}</button>)}
      {page.nextCursor ? <button className={roomButtonClass} disabled={page.busy} onClick={() => void page.loadMore()}>{t('roomsLoadMore')}</button> : null}
      {page.error ? <p role="alert" className="text-xs text-red-500">{page.error}</p> : null}
    </div> : null}
  </>
}
