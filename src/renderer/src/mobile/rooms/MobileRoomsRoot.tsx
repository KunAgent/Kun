import { useState, type ReactNode } from 'react'
import { useTranslation } from 'react-i18next'
import type { Room, RoomSidebarEntry } from '@shared/rooms-api'
import { useRoomSidebar } from '../../components/rooms/useRoomSidebar'
import { RoomUserAvatarEditor } from '../../components/rooms/RoomUserAvatarEditor'
import { roomIdForSidebarEntry, setRoomSidebarEntryDeleted, toggleRoomSidebarEntryArchived } from '../../components/rooms/room-sidebar-actions'
import { agentPath, useAgentCatalog } from '../../components/rooms/agent-client'
import { roomsRequest } from '../../components/rooms/rooms-client'
import type { MobilePage } from '../navigation/mobile-page'
import { MobileSheet } from '../sheets/MobileSheet'
import { MobileRoomsHome, type MobileRoomsFilter } from './MobileRoomsHome'
import './mobile-avatar-editor.css'

export function MobileRoomsRoot({ navigate, segments }: { navigate: (page: MobilePage) => void; segments?: ReactNode }) {
  const { t } = useTranslation('common')
  const [search, setSearch] = useState('')
  const [filter, setFilter] = useState<MobileRoomsFilter>('all')
  const [view, setView] = useState<'chats' | 'agents'>('chats')
  const [deletedOnly, setDeletedOnly] = useState(false)
  const [profileOpen, setProfileOpen] = useState(false)
  const [actionError, setActionError] = useState('')
  const rooms = useRoomSidebar({ kind: 'all', search, deletedOnly,
    unreadOnly: !deletedOnly && filter === 'unread', attentionOnly: !deletedOnly && filter === 'attention' })
  const agents = useAgentCatalog(search, false, view === 'agents')
  const run = (action: () => Promise<void>): void => {
    setActionError('')
    void action().catch((cause: unknown) => setActionError(cause instanceof Error ? cause.message : String(cause)))
  }
  return <>
    <MobileRoomsHome segments={segments} rooms={rooms.entries} agents={agents.agents} view={view} deletedOnly={deletedOnly}
      onView={(next) => { setView(next); setDeletedOnly(false); setSearch('') }}
      onDeletedOnly={(next) => { setView('chats'); setDeletedOnly(next); setFilter('all'); setSearch('') }}
      onOpenAgent={(id) => run(async () => {
        const result = await roomsRequest<{ room: Room }>(agentPath(id) + '/conversation', 'POST', {})
        navigate({ mode: 'rooms', kind: 'room', roomId: result.room.id })
      })}
      search={search} filter={filter}
      loading={view === 'agents' ? agents.busy || (!agents.data && !agents.error) : rooms.busy}
      error={(view === 'agents' ? agents.error : rooms.error) || actionError}
      hasMore={Boolean(view === 'agents' ? agents.cursor : rooms.nextCursor)}
      onSearch={setSearch} onFilter={setFilter}
      onOpen={(entry: RoomSidebarEntry) => { if (entry.deleted) return; run(async () => {
        navigate({ mode: 'rooms', kind: 'room', roomId: await roomIdForSidebarEntry(entry) })
      }) }}
      onPin={rooms.togglePin}
      onSettings={(entry) => { if (entry.roomId) navigate({ mode: 'rooms', kind: 'room-settings', roomId: entry.roomId }) }}
      onArchive={(entry) => run(async () => {
        await toggleRoomSidebarEntryArchived(entry)
        rooms.refresh()
      })}
      onDelete={(entry) => run(async () => {
        try { await setRoomSidebarEntryDeleted(entry, true); rooms.refresh() }
        catch (cause) {
          const message = cause instanceof Error ? cause.message : String(cause)
          throw new Error(message.includes('stop or reconcile active work') ? t('roomsDeleteActiveWork') : message)
        }
      })}
      onRestore={(entry) => run(async () => { await setRoomSidebarEntryDeleted(entry, false); rooms.refresh() })}
      onCreate={(kind) => navigate(kind === 'group' ? { mode: 'rooms', kind: 'new', group: true } : { mode: 'rooms', kind: 'new' })}
      onProfile={() => setProfileOpen(true)}
      onRetry={() => { setActionError(''); if (view === 'agents') agents.refresh(); else rooms.refresh() }}
      onLoadMore={() => { if (view === 'agents') void agents.more().catch(() => undefined); else rooms.more() }} />
    <MobileSheet open={profileOpen} title={t('roomsMyAvatar')} closeLabel={t('close')} onClose={() => setProfileOpen(false)}>
      {profileOpen ? <div className="kun-mobile-avatar-editor">
        <RoomUserAvatarEditor variant="panel" onClose={() => setProfileOpen(false)} />
      </div> : null}
    </MobileSheet>
  </>
}
