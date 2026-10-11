import { useEffect, useState, type ReactNode } from 'react'
import { Archive, ArchiveRestore, MessageSquarePlus, Pin, PinOff, Plus, Search, Settings, Trash2, UserRound, Users } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import type { AgentIdentity, RoomSidebarEntry } from '@shared/rooms-api'
import { RoomAvatar } from '../../components/rooms/RoomAvatar'
import { MobileSheet } from '../sheets/MobileSheet'
import { useLongPress } from '../lib/use-long-press'
import { MobileRoomRow } from './MobileRoomRow'
import './mobile-rooms-home.css'
import { MobileLoadingDots, MobileLoadingState } from '../lib/MobileLoading'

export type MobileRoomsFilter = 'all' | 'unread' | 'attention'
export type MobileRoomsHomeProps = {
  /** Tasks / conversations switch shown under the header. */
  segments?: ReactNode
  rooms: readonly RoomSidebarEntry[]
  agents: readonly AgentIdentity[]
  view: 'chats' | 'agents'
  deletedOnly: boolean
  search: string
  filter: MobileRoomsFilter
  loading: boolean
  error: string
  hasMore: boolean
  onSearch: (value: string) => void
  onFilter: (filter: MobileRoomsFilter) => void
  onOpen: (entry: RoomSidebarEntry) => void
  onOpenAgent: (id: string) => void
  onView: (view: 'chats' | 'agents') => void
  onDeletedOnly: (value: boolean) => void
  onPin: (entry: RoomSidebarEntry) => void
  onSettings: (entry: RoomSidebarEntry) => void
  onArchive: (entry: RoomSidebarEntry) => void
  onDelete: (entry: RoomSidebarEntry) => void
  onRestore: (entry: RoomSidebarEntry) => void
  onCreate: (kind: 'chat' | 'group') => void
  onProfile: () => void
  onRetry: () => void
  onLoadMore: () => void
}

const FILTER_LABELS = { all: 'roomsFilter_all', unread: 'roomsFilter_unread', attention: 'roomsFilter_attention' } as const

export function MobileRoomsHome(props: MobileRoomsHomeProps) {
  const { rooms, agents, view, deletedOnly, search, filter, loading, error, hasMore, onSearch, onFilter, onOpen, onCreate, onProfile,
    onRetry, onLoadMore } = props
  const { t } = useTranslation('common')
  const [menuOpen, setMenuOpen] = useState(false)
  const [actionEntry, setActionEntry] = useState<RoomSidebarEntry | null>(null)
  const [confirmEntry, setConfirmEntry] = useState<RoomSidebarEntry | null>(null)
  const longPress = useLongPress<RoomSidebarEntry>(setActionEntry)
  useEffect(() => {
    if (!menuOpen) return
    const onKey = (event: KeyboardEvent): void => { if (event.key === 'Escape') setMenuOpen(false) }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [menuOpen])
  const pick = (action: () => void) => () => { setMenuOpen(false); action() }
  const act = (action: (entry: RoomSidebarEntry) => void) => () => {
    const entry = actionEntry
    setActionEntry(null)
    if (entry) action(entry)
  }
  const actionName = actionEntry ? actionEntry.name || actionEntry.title : ''
  return <section className="kun-mobile-rooms-home" aria-label={t('roomsLabel')}>
    <header>
      <button type="button" className="kun-mobile-rooms-me" onClick={onProfile} aria-label={t('roomsMyAvatar')}>
        <RoomAvatar id="user" label={t('roomsMyAvatar')} size={32} />
      </button>
      <h1>{t(view === 'agents' ? 'agentsDirectory' : 'roomsConversations')}</h1>
      <button type="button" onClick={() => setMenuOpen(!menuOpen)} aria-label={t('roomsSidebarNew')}
        aria-haspopup="menu" aria-expanded={menuOpen}><Plus aria-hidden /></button>
      {menuOpen ? <>
        <button type="button" className="kun-mobile-rooms-scrim" aria-label={t('close')} onClick={() => setMenuOpen(false)} />
        <div className="kun-mobile-rooms-plus-menu" role="menu">
          <button type="button" role="menuitem" onClick={pick(() => onCreate('chat'))}>
            <MessageSquarePlus size={20} aria-hidden />{t('directNewChat')}</button>
          <button type="button" role="menuitem" onClick={pick(() => onCreate('group'))}>
            <Users size={20} aria-hidden />{t('directCreateGroup')}</button>
          <button type="button" role="menuitem" onClick={pick(onProfile)}>
            <UserRound size={20} aria-hidden />{t('roomsMyAvatar')}</button>
          <button type="button" role="menuitem" onClick={pick(() => props.onDeletedOnly(!deletedOnly))}>
            <Trash2 size={20} aria-hidden />{t(deletedOnly ? 'roomsConversations' : 'roomsRecentlyDeleted')}</button>
        </div>
      </> : null}
    </header>
    {props.segments}
    <label className="kun-mobile-rooms-search"><Search size={16} aria-hidden />
      <input type="search" value={search} onChange={(event) => onSearch(event.target.value)}
        placeholder={t('roomsUnifiedSearch')} aria-label={t('roomsUnifiedSearch')} />
    </label>
    {/* One row of tabs: conversation filters, then the Agent directory. */}
    <div className="kun-mobile-room-filters" role="group" aria-label={t('roomsLabel')}>
      {(['all', 'unread', 'attention'] as const).map((value) => <button key={value} type="button"
        aria-pressed={view === 'chats' && !deletedOnly && filter === value}
        onClick={() => { props.onDeletedOnly(false); onFilter(value) }}>{t(FILTER_LABELS[value])}</button>)}
      <button type="button" aria-pressed={view === 'chats' && deletedOnly} onClick={() => props.onDeletedOnly(true)}>{t('roomsRecentlyDeleted')}</button>
      <button type="button" aria-pressed={view === 'agents'} data-room-filter="agents" onClick={() => props.onView('agents')}>{t('agentsDirectory')}</button>
    </div>
    <div className="kun-mobile-room-list" aria-busy={loading}>
      {error ? <div role="alert"><p>{error}</p>
        <button type="button" disabled={loading} onClick={onRetry}>{t('roomsRefresh')}</button></div> : null}
      {view === 'agents' ? <>{!error && agents.length === 0 ? loading ? <MobileLoadingState label={t('roomsLoading')} />
        : <p role="status" className="kun-mobile-rooms-empty">{search ? t('roomsSearchNoResults') : t('agentsEmpty')}</p> : null}
      <ul className="kun-mobile-agent-contacts">{agents.map((agent) => <li key={agent.id}>
        <button type="button" onClick={() => props.onOpenAgent(agent.id)}>
          <RoomAvatar avatar={agent.avatar} id={agent.id} label={agent.name} size={40} />
          <span><strong>{agent.name}</strong><small>{agent.title}</small></span>
        </button></li>)}</ul></> : <>
      {!error && rooms.length === 0 ? loading ? <MobileLoadingState label={t('roomsLoading')} />
        : <p role="status" className="kun-mobile-rooms-empty">{search ? t('roomsSearchNoResults') : t('roomsEmpty')}</p> : null}
      <ul>{rooms.map((entry) => <MobileRoomRow key={entry.id} entry={entry}
        pressHandlers={longPress(entry)} onOpen={() => { if (!entry.deleted) onOpen(entry) }} />)}</ul>
      </>}
      {hasMore ? <button type="button" className="kun-mobile-rooms-more" disabled={loading} onClick={onLoadMore}>
        {loading ? <MobileLoadingDots /> : t('roomsLoadMore')}</button> : null}
    </div>
    <MobileSheet open={Boolean(actionEntry)} title={actionName} closeLabel={t('close')} onClose={() => setActionEntry(null)}>
      {actionEntry ? <ul className="kun-mobile-action-list">
        {actionEntry.deleted ? <li><button type="button" onClick={act(props.onRestore)}>
          <ArchiveRestore size={18} aria-hidden />{t('roomsRestoreConversation')}</button></li> : <>
        <li><button type="button" onClick={act(props.onPin)}>
          {actionEntry.pinned ? <PinOff size={18} aria-hidden /> : <Pin size={18} aria-hidden />}
          {t(actionEntry.pinned ? 'roomsUnpinConversation' : 'roomsPinConversation')}</button></li>
        {actionEntry.roomId ? <li><button type="button" onClick={act(props.onSettings)}>
          <Settings size={18} aria-hidden />{t('roomsSettings')}</button></li> : null}
        <li><button type="button" data-variant={actionEntry.archived ? undefined : 'danger'} onClick={act(props.onArchive)}>
          {actionEntry.archived ? <ArchiveRestore size={18} aria-hidden /> : <Archive size={18} aria-hidden />}
          {t(actionEntry.archived ? 'roomsRestoreArchivedConversation' : 'roomsArchiveConversation')}</button></li>
        <li><button type="button" data-variant="danger" onClick={() => { setConfirmEntry(actionEntry); setActionEntry(null) }}>
          <Trash2 size={18} aria-hidden />{t('roomsDeleteConversation')}</button></li></>}
      </ul> : null}
    </MobileSheet>
    <MobileSheet open={Boolean(confirmEntry)} title={t('roomsDeleteConversation')} closeLabel={t('close')} onClose={() => setConfirmEntry(null)}>
      {confirmEntry ? <div className="kun-mobile-delete-confirm">
        <p>{t('roomsDeleteConversationHint', { name: confirmEntry.name })}</p>
        <button type="button" onClick={() => setConfirmEntry(null)}>{t('roomsCancel')}</button>
        <button type="button" data-variant="danger" onClick={() => { props.onDelete(confirmEntry); setConfirmEntry(null) }}>{t('roomsDeleteConversation')}</button>
      </div> : null}
    </MobileSheet>
  </section>
}
