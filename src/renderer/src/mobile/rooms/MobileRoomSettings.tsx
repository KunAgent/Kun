import { useEffect, useState } from 'react'
import { ArrowLeft } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { RoomSettings } from '../../components/rooms/RoomSettings'
import { roomsClient } from '../../components/rooms/rooms-client'
import { useRooms } from '../../components/rooms/useRooms'
import './mobile-room-settings.css'

export function MobileRoomSettings({ roomId, onBack }: { roomId: string; onBack: () => void }) {
  const { t } = useTranslation('common')
  const state = useRooms('group', false)
  const [editing, setEditing] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const { select, selectedId } = state
  useEffect(() => { if (selectedId !== roomId) select(roomId) }, [roomId, select, selectedId])
  const room = state.room
  const update = async (patch: { pinned?: boolean; archived?: boolean }): Promise<void> => {
    if (!room || busy) return
    setBusy(true); setError('')
    try {
      await roomsClient.update(room, patch)
      await state.refresh()
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause))
    } finally { setBusy(false) }
  }
  return <section className="kun-mobile-room-settings">
    <header><button type="button" aria-label={t('back')} onClick={onBack}><ArrowLeft aria-hidden /></button>
      <h1>{room?.name ?? t('roomsLoading')}</h1></header>
    {state.loading || !room ? <p role="status">{t('roomsLoading')}</p> : <div className="kun-mobile-room-settings-actions">
      <button type="button" disabled={busy} onClick={() => setEditing(true)}>{t('roomsSettings')}</button>
      <button type="button" disabled={busy} onClick={() => void update({ pinned: !room.pinned })}>
        {room.pinned ? t('roomsUnpin') : t('roomsPin')}</button>
      <button type="button" disabled={busy} onClick={() => void update({ archived: !room.archivedAt })}>
        {room.archivedAt ? t('roomsRestore') : t('roomsArchive')}</button>
      <dl><div><dt>{t('roomsMembers')}</dt><dd>{room.members.length}</dd></div>
        <div><dt>{t('roomsRepositories')}</dt><dd>{room.repositories.length}</dd></div>
        <div><dt>{t('roomsMode')}</dt><dd>{room.collaborationMode}</dd></div></dl>
    </div>}
    {error || state.error ? <p role="alert" className="kun-mobile-notice">{error || state.error}</p> : null}
    {editing && room ? <RoomSettings room={room} onClose={() => setEditing(false)}
      onSaved={() => { setEditing(false); void state.refresh() }} /> : null}
  </section>
}
