import { ChevronDown, Menu, MoreHorizontal, PanelRight, Pin, Search, Settings, Archive } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import type { Room } from '@shared/rooms-api'
import { RoomAvatarGroup } from './RoomAvatar'
import { RoomPopover } from './RoomPopover'
import { RoomAppearanceMenu, RoomNotificationMenu } from './RoomManagementControls'

export function RoomHeader({ room, busy, searchOpen, onSidebar, onSearch, onDetails, onMembers, onSettings, onUpdate }: {
  room: Room | null; busy: boolean; searchOpen: boolean
  onSidebar: () => void; onSearch: () => void; onDetails: () => void; onMembers: () => void; onSettings: () => void
  onUpdate: (patch: { collaborationMode?: Room['collaborationMode']; pinned?: boolean; archived?: boolean }) => void
}) {
  const { t } = useTranslation('common')
  const enabled = room?.members.filter((member) => member.enabled && !member.removedAt) ?? []
  return <header className="rooms-main-titlebar rooms-header">
    <button type="button" className="rooms-icon-button rooms-sidebar-toggle" aria-label={t('roomsLabel')} onClick={onSidebar}>
      <Menu size={19} />
    </button>
    <div className="rooms-header-title">
      <h1>{room?.pinned ? <Pin size={14} aria-hidden="true" /> : null}<span>{room?.name ?? t('roomsLabel')}</span></h1>
      {room ? <p>{room.description || enabled.map((member) => member.displayName).join(' · ')}</p> : null}
    </div>
    {room ? <>
      <div className="rooms-header-members" title={t('roomsMembers')}>
        <RoomAvatarGroup members={enabled} size={36} onClick={onMembers} />
      </div>
      {room.conversationKind && room.conversationKind !== 'group' ? <span className="rooms-run-note">{t('agentsConversation_' + room.conversationKind)}</span> : <div className="rooms-mode-control">
        <select aria-label={t('roomsMode')} value={room.collaborationMode} disabled={busy}
          title={t(room.collaborationMode === 'peer' ? 'roomsPeer' : room.collaborationMode === 'directed' ? 'roomsDirected' : 'roomsAutonomous')}
          onChange={(event) => onUpdate({ collaborationMode: event.target.value as Room['collaborationMode'] })}>
          <option value="peer">{t('roomsPeer')}</option>
          <option value="autonomous">{t('roomsAutonomous')}</option>
          <option value="directed">{t('roomsDirected')}</option>
        </select>
        <ChevronDown size={12} aria-hidden="true" />
      </div>}
      <button type="button" className="rooms-icon-button" aria-label={t('roomsSearchMessages')}
        title={t('roomsSearchMessages')} aria-pressed={searchOpen} onClick={onSearch}><Search size={18} /></button>
      <button type="button" className="rooms-icon-button" aria-label={t('roomsRoomDetails')}
        title={t('roomsRoomDetails')} onClick={onDetails}><PanelRight size={18} /></button>
      <RoomNotificationMenu roomId={room.id} />
      <RoomAppearanceMenu />
      <RoomPopover label={t('roomsMoreActions')} trigger={<MoreHorizontal size={19} />} align="end" width={224} className="rooms-icon-button">
        {(close) => <div className="rooms-menu-list">
          <button type="button" onClick={() => { close(); onSettings() }}><Settings size={16} />{t('roomsSettings')}</button>
          <button type="button" disabled={busy} onClick={() => { close(); onUpdate({ pinned: !room.pinned }) }}><Pin size={16} />{t(room.pinned ? 'roomsUnpin' : 'roomsPin')}</button>
          <button type="button" disabled={busy} onClick={() => { close(); onUpdate({ archived: !room.archivedAt }) }}><Archive size={16} />{t(room.archivedAt ? 'roomsRestore' : 'roomsArchive')}</button>
        </div>}
      </RoomPopover>
    </> : null}
  </header>
}
