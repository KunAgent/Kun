import { useState } from 'react'
import { ChevronDown, IdCard, MoreHorizontal, PanelLeft, PanelRight, Pencil, Pin, Search, Settings, Archive, PlugZap, Trash2 } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import type { Room } from '@shared/rooms-api'
import { RoomAvatarGroup } from './RoomAvatar'
import { RoomPopover } from './RoomPopover'
import { RoomAppearanceMenu, RoomNotificationMenu } from './RoomManagementControls'
import './conversation-manage.css'

/** Collaboration mode stays visible in a group header; it applies to new topics. */
function RoomModeControl({ room, busy, onUpdate }: {
  room: Room; busy: boolean
  onUpdate: (patch: { collaborationMode?: Room['collaborationMode'] }) => void
}) {
  const { t } = useTranslation('common')
  return <div className="rooms-mode-control">
    <select aria-label={t('roomsMode')} value={room.collaborationMode} disabled={busy}
      title={t(room.collaborationMode === 'peer' ? 'roomsPeer' : room.collaborationMode === 'directed' ? 'roomsDirected' : 'roomsAutonomous')}
      onChange={(event) => onUpdate({ collaborationMode: event.target.value as Room['collaborationMode'] })}>
      <option value="peer">{t('roomsPeer')}</option>
      <option value="autonomous">{t('roomsAutonomous')}</option>
      <option value="directed">{t('roomsDirected')}</option>
    </select>
    <ChevronDown size={12} aria-hidden="true" />
  </div>
}

/** Header of a group or Agent pair conversation inside Code. */
export function RoomHeader({ room, busy, searchOpen, onSidebar, onSearch, onDetails, onMembers, onSettings, onApps, onHandoffs, onInfo, onRemove, onUpdate }: {
  room: Room | null; busy: boolean; searchOpen: boolean
  onSidebar: () => void; onSearch: () => void; onDetails: () => void; onMembers: () => void; onSettings: () => void; onApps?: () => void; onHandoffs?: () => void
  onInfo?: () => void; onRemove?: () => void
  onUpdate: (patch: { name?: string; collaborationMode?: Room['collaborationMode']; pinned?: boolean; archived?: boolean }) => void
}) {
  const { t } = useTranslation('common')
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState('')
  const enabled = room?.members.filter((member) => member.enabled && !member.removedAt) ?? []
  const group = Boolean(room && (!room.conversationKind || room.conversationKind === 'group'))
  const startEdit = () => {
    if (!room || busy) return
    setDraft(room.name)
    setEditing(true)
  }
  const cancelEdit = () => { setEditing(false); setDraft('') }
  const submitRename = () => {
    if (!room) { setEditing(false); setDraft(''); return }
    const name = draft.trim()
    setEditing(false)
    setDraft('')
    if (!name || name === room.name) return
    onUpdate({ name })
  }
  return <header className="rooms-main-titlebar rooms-header" data-room-header-kind={room?.conversationKind ?? 'group'}>
    <button type="button" className="rooms-icon-button" aria-label={t('sidebarToggle')} title={t('sidebarToggle')} onClick={onSidebar}>
      <PanelLeft size={18} />
    </button>
    <div className="rooms-header-title">
      {editing && room ? <input className="rooms-header-rename" aria-label={t('roomsRename')} value={draft} maxLength={120}
        disabled={busy} autoFocus onFocus={(event) => event.target.select()} onChange={(event) => setDraft(event.target.value)}
        onKeyDown={(event) => {
          if (event.key === 'Enter') { event.preventDefault(); submitRename() }
          else if (event.key === 'Escape') { event.preventDefault(); cancelEdit() }
        }} onBlur={submitRename}
      /> : <h1>
        {room?.pinned ? <Pin size={14} aria-hidden="true" /> : null}
        <span>{room?.name ?? t('sidebarConversations')}</span>
        {room ? <button type="button" className="rooms-icon-button rooms-header-rename-trigger" aria-label={t('roomsRename')}
          title={t('roomsRename')} disabled={busy} onClick={startEdit}><Pencil size={14} /></button> : null}
      </h1>}
      {room ? <p>{room.description || [t('conversationMemberCount', { count: enabled.length }),
        room.repositories[0]?.displayName].filter(Boolean).join(' · ')}</p> : null}
    </div>
    {room ? <>
      <div className="rooms-header-members" title={t('roomsMembers')}>
        <RoomAvatarGroup members={enabled} avatar={room.avatar} id={room.id} label={room.name} size={30} onClick={onMembers} />
      </div>
      {group ? <RoomModeControl room={room} busy={busy} onUpdate={onUpdate} />
        : <span className="rooms-run-note">{t('agentsConversation_' + room.conversationKind)}</span>}
      <button type="button" className="rooms-icon-button" aria-label={t('roomsSearchMessages')}
        title={t('roomsSearchMessages')} aria-pressed={searchOpen} onClick={onSearch}><Search size={18} /></button>
      <button type="button" className="rooms-icon-button" aria-label={t('roomsRoomDetails')}
        title={t('roomsRoomDetails')} onClick={onDetails}><PanelRight size={18} /></button>
      <RoomPopover label={t('roomsMoreActions')} trigger={<MoreHorizontal size={19} />} align="end" width={224} className="rooms-icon-button">
        {(close) => <div className="rooms-menu-list conversation-menu">
          {onInfo && group ? <button type="button" data-conversation-action="info" onClick={() => { close(); onInfo() }}>
            <IdCard size={16} aria-hidden="true" /><span>{t('conversationViewGroupInfo')}</span></button> : null}
          <RoomNotificationMenu roomId={room.id} inMenu />
          <RoomAppearanceMenu inMenu />
          {onApps ? <button type="button" onClick={() => { close(); onApps() }}><PlugZap size={16} />{t('roomsAppsTitle')}</button> : null}
          {onHandoffs ? <button type="button" onClick={() => { close(); onHandoffs() }}>{t('agentsHandoffs')}</button> : null}
          <button type="button" disabled={busy} onClick={() => { close(); startEdit() }}><Pencil size={16} />{t('roomsRename')}</button>
          <button type="button" onClick={() => { close(); onSettings() }}><Settings size={16} />{t('roomsSettings')}</button>
          <button type="button" disabled={busy} onClick={() => { close(); onUpdate({ pinned: !room.pinned }) }}><Pin size={16} />{t(room.pinned ? 'roomsUnpin' : 'roomsPin')}</button>
          <button type="button" disabled={busy} onClick={() => { close(); onUpdate({ archived: !room.archivedAt }) }}><Archive size={16} />{t(room.archivedAt ? 'roomsRestore' : 'roomsArchive')}</button>
          {onRemove && group ? <>
            <hr />
            <button type="button" className="is-danger" data-conversation-action="group" disabled={busy} onClick={() => { close(); onRemove() }}>
              <Trash2 size={16} aria-hidden="true" /><span>{t('conversationDeleteGroup')}</span></button>
          </> : null}
        </div>}
      </RoomPopover>
    </> : null}
  </header>
}
