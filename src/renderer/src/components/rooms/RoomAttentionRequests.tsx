import { useTranslation } from 'react-i18next'
import type { Room } from '@shared/rooms-api'
import { roomPath, type RoomRequestEntry } from './rooms-client'
import { RoomRequestControls } from './RoomRequestControls'
import { useRoomPage } from './useRoomPage'

export function RoomAttentionRequests({
  room,
  emptyTasks
}: {
  room: Room
  emptyTasks: boolean
}) {
  const { t } = useTranslation('common')
  const resource = useRoomPage<RoomRequestEntry>(
    room.id,
    roomPath(room.id) + '/requests?attention_only=true',
    'requests'
  )
  if (resource.error) {
    return (
      <p role="alert" className="px-3 text-xs text-red-500">
        {resource.error}
      </p>
    )
  }
  if (!resource.items.length) {
    if (!emptyTasks) return null
    return (
      <p className="text-xs text-ds-muted">
        {t(resource.busy ? 'roomsLoading' : 'roomsNoTasks')}
      </p>
    )
  }
  return (
    <div className="space-y-2 px-3 pb-2" aria-label={t('roomsAttentionRequests')}>
      <p className="text-xs text-ds-muted">{t('roomsAttentionRequests')}</p>
      {resource.items.map((request) => (
        <article
          key={request.id}
          className="space-y-2 rounded-lg border border-ds-border p-3"
        >
          <p className="line-clamp-2 text-sm font-medium text-ds-ink">
            {request.message.body}
          </p>
          <p className="text-xs text-ds-muted">
            {t(`roomsState_${request.status}`)}
          </p>
          <RoomRequestControls
            room={room}
            request={request}
            onUpdated={resource.refresh}
          />
        </article>
      ))}
    </div>
  )
}
