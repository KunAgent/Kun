import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import type { RoomSidebarEntry } from '@shared/rooms-api'
import { useRoomSidebar } from '../../components/rooms/useRoomSidebar'
import { RoomUserAvatarEditor } from '../../components/rooms/RoomUserAvatarEditor'
import { roomIdForSidebarEntry, toggleRoomSidebarEntryArchived } from '../../components/rooms/room-sidebar-actions'
import type { MobilePage } from '../navigation/mobile-page'
import { MobileSheet } from '../sheets/MobileSheet'
import { MobileRoomsHome, type MobileRoomsFilter } from './MobileRoomsHome'
import './mobile-avatar-editor.css'

export function MobileRoomsRoot({ navigate }: { navigate: (page: MobilePage) => void }) {
  const { t } = useTranslation('common')
  const [search, setSearch] = useState('')
  const [filter, setFilter] = useState<MobileRoomsFilter>('all')
  const [profileOpen, setProfileOpen] = useState(false)
  const [actionError, setActionError] = useState('')
  const rooms = useRoomSidebar({ kind: 'all', search,
    unreadOnly: filter === 'unread', attentionOnly: filter === 'attention' })
  const run = (action: () => Promise<void>): void => {
    setActionError('')
    void action().catch((cause: unknown) => setActionError(cause instanceof Error ? cause.message : String(cause)))
  }
  return <>
    <MobileRoomsHome rooms={rooms.entries} search={search} filter={filter}
      loading={rooms.busy} error={rooms.error || actionError} hasMore={Boolean(rooms.nextCursor)}
      onSearch={setSearch} onFilter={setFilter}
      onOpen={(entry: RoomSidebarEntry) => run(async () => {
        navigate({ mode: 'rooms', kind: 'room', roomId: await roomIdForSidebarEntry(entry) })
      })}
      onPin={rooms.togglePin}
      onSettings={(entry) => { if (entry.roomId) navigate({ mode: 'rooms', kind: 'room-settings', roomId: entry.roomId }) }}
      onArchive={(entry) => run(async () => {
        await toggleRoomSidebarEntryArchived(entry)
        rooms.refresh()
      })}
      onCreate={(kind) => navigate(kind === 'group' ? { mode: 'rooms', kind: 'new', group: true } : { mode: 'rooms', kind: 'new' })}
      onProfile={() => setProfileOpen(true)}
      onRetry={() => { setActionError(''); rooms.refresh() }} onLoadMore={rooms.more} />
    <MobileSheet open={profileOpen} title={t('roomsMyAvatar')} closeLabel={t('close')} onClose={() => setProfileOpen(false)}>
      {profileOpen ? <div className="kun-mobile-avatar-editor">
        <RoomUserAvatarEditor variant="panel" onClose={() => setProfileOpen(false)} />
      </div> : null}
    </MobileSheet>
  </>
}
