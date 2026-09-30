import './rooms-polish.css'
import { useRoomSidebarMotion } from './useRoomSidebarMotion'
import { useEffect, useMemo, useRef, useState } from 'react'
import { useVirtualizer } from '@tanstack/react-virtual'
import { useTranslation } from 'react-i18next'
import { Search, Plus, MoreHorizontal, SlidersHorizontal, Settings, X } from 'lucide-react'
import type { RoomSearchHit, RoomSidebarEntry } from '@shared/rooms-api'
import { useRoomSidebar } from './useRoomSidebar'
import { RoomAvatar } from './RoomAvatar'
import { RoomSidebarRow } from './RoomSidebarRow'
import { AgentDirectory } from './AgentDirectory'
import { RoomPopover } from './RoomPopover'
import { RoomListFilters } from './RoomManagementControls'
import { RoomUnifiedSearch } from './RoomUnifiedSearch'
import { setRoomSidebarEntryDeleted, toggleRoomSidebarEntryArchived } from './room-sidebar-actions'
import { readBrowserStorageItem, writeBrowserStorageItem } from '../../lib/browser-storage'
import { RoomModal } from './RoomModal'

type Kind = 'all' | 'agents' | 'group' | 'agent_agent'
export function RoomSidebar({ selectedRoomId, onOpenAgent, onSelect, onCreateAgent, onDetails, onSearch,
  onProfile, onTeam, onManage, onActivity, onDeleted }: {
  selectedRoomId: string; onOpenAgent: (id: string) => void; onSelect: (id: string) => void
  onCreateAgent: () => void; onCreateGroup: () => void; onDetails: (id: string) => void
  onSearch: (hit: RoomSearchHit) => void; onProfile: () => void; onTeam: () => void; onManage: () => void
  onActivity?: (entry: RoomSidebarEntry | undefined) => void; onDeleted: (id: string) => void
}) {
  const { t } = useTranslation('common')
  const [surface, setSurface] = useState<'chats' | 'agents'>(() =>
    readBrowserStorageItem('kun.rooms.sidebar.surface') === 'agents' ? 'agents' : 'chats')
  const showSurface = (value: 'chats' | 'agents') => {
    setSurface(value)
    writeBrowserStorageItem('kun.rooms.sidebar.surface', value)
  }
  const [kind, setKind] = useState<Kind>(() => {
    const old = readBrowserStorageItem('kun.rooms.sidebar.kind'); return old === 'agents' || old === 'group' || old === 'agent_agent' ? old : 'all'
  })
  const [filter, setFilter] = useState<'all' | 'unread' | 'attention'>('all'), [archived, setArchived] = useState(false)
  const [deletedOnly, setDeletedOnly] = useState(false)
  const [deleteTarget, setDeleteTarget] = useState<RoomSidebarEntry | null>(null)
  const [deleting, setDeleting] = useState(false)
  const [hiddenRoomIds, setHiddenRoomIds] = useState<Set<string>>(() => new Set())
  const [repository, setRepository] = useState(''), [search, setSearch] = useState(''), [fullSearch, setFullSearch] = useState(false)
  const [actionError, setActionError] = useState('')
  const page = useRoomSidebar({ kind, search, archivedOnly: archived, deletedOnly,
    unreadOnly: !deletedOnly && filter === 'unread', attentionOnly: !deletedOnly && filter === 'attention',
    repositoryRoot: repository || undefined }, selectedRoomId)
  useEffect(() => {
    if (deletedOnly || hiddenRoomIds.size === 0) return
    const listed = new Set(page.entries.map((entry) => entry.roomId))
    if ([...hiddenRoomIds].every((id) => listed.has(id))) return
    setHiddenRoomIds(new Set([...hiddenRoomIds].filter((id) => listed.has(id))))
  }, [deletedOnly, hiddenRoomIds, page.entries])
  const entries = useMemo(() => deletedOnly ? page.entries : page.entries.filter((entry) =>
    !entry.roomId || !hiddenRoomIds.has(entry.roomId)), [deletedOnly, page.entries, hiddenRoomIds])
  useEffect(() => {
    const first = entries[0]
    if (surface === 'chats' && !deletedOnly && !selectedRoomId && first?.roomId) onSelect(first.roomId)
  }, [surface, deletedOnly, selectedRoomId, entries, onSelect])
  useEffect(() => { onActivity?.(entries.find((entry) => entry.roomId === selectedRoomId)) }, [entries, selectedRoomId, onActivity])
  const scroll = useRef<HTMLDivElement>(null)
  const rememberScroll = useRoomSidebarMotion(scroll, entries, JSON.stringify([kind, search, archived, deletedOnly, filter, repository]))
  const virtualizer = useVirtualizer({ count: entries.length, getScrollElement: () => scroll.current, estimateSize: () => 64,
    getItemKey: (index) => entries[index].id, overscan: 8 })
  const virtual = entries.length > 60
  const rows = virtual ? virtualizer.getVirtualItems() : entries.map((item, index) => ({ key: item.id, index, start: 0 }))
  const act = async (entry: RoomSidebarEntry, action: 'archive') => {
    setActionError('')
    try {
      if (action === 'archive') await toggleRoomSidebarEntryArchived(entry)
      page.refresh()
    } catch (cause) { setActionError(String(cause)) }
  }
  const moveConversation = async (entry: RoomSidebarEntry, deleted: boolean) => {
    setDeleting(true); setActionError('')
    try {
      await setRoomSidebarEntryDeleted(entry, deleted)
      if (entry.roomId) {
        setHiddenRoomIds((current) => {
          const next = new Set(current)
          if (deleted) next.add(entry.roomId!)
          else next.delete(entry.roomId!)
          return next
        })
        if (deleted && selectedRoomId === entry.roomId) onDeleted(entry.roomId)
      }
      setDeleteTarget(null)
      page.refresh()
    } catch (cause) {
      const message = cause instanceof Error ? cause.message : String(cause)
      setActionError(message.includes('stop or reconcile active work') ? t('roomsDeleteActiveWork') : message)
    }
    finally { setDeleting(false) }
  }
  return <div className="rooms-im-sidebar">
    <div className="rooms-im-sidebar-sections" role="group" aria-label={t('roomsConversations')}>
      <button type="button" aria-pressed={surface === 'chats'} onClick={() => showSurface('chats')}>{t('roomsConversations')}</button>
      <button type="button" aria-pressed={surface === 'agents'} onClick={() => showSurface('agents')}>{t('agentsDirectory')}</button>
    </div>
    {surface === 'agents' ? <AgentDirectory onOpen={(id) => { showSurface('chats'); setDeletedOnly(false); onOpenAgent(id) }}
      onDetails={onDetails} onCreate={() => { showSurface('chats'); setDeletedOnly(false); onCreateAgent() }} /> : <>
    <div className="rooms-im-sidebar-toolbar">
      <div className="rooms-list-search"><Search size={15} /><input value={search} onChange={(e) => { setSearch(e.target.value); setFullSearch(false) }}
        aria-label={t('roomsSidebarSearch')} placeholder={t('roomsSidebarSearch')} />{search ? <button aria-label={t('roomsClose')} onClick={() => setSearch('')}><X size={14} /></button> : null}</div>
      <button type="button" aria-label={t('roomsSidebarNew')} title={t('roomsSidebarNew')} className="rooms-icon-button rooms-im-sidebar-new" onClick={() => { setDeletedOnly(false); onCreateAgent() }}><Plus size={18} /></button>
      <RoomPopover label={t('roomsSidebarFilter')} trigger={<SlidersHorizontal size={16} />} className="rooms-icon-button" align="end" width={280}>
        {() => <div className="rooms-sidebar-filter-menu"><label>{t('roomsSidebarKind')}<select value={kind} onChange={(e) => {
          const value = e.target.value as Kind; setKind(value); writeBrowserStorageItem('kun.rooms.sidebar.kind', value)
        }}>{(['all', 'agents', 'group', 'agent_agent'] as const).map((value) => <option key={value} value={value}>{t('roomsSidebar_' + value)}</option>)}</select></label>
          <RoomListFilters filter={filter} archived={archived} repositoryRoot={repository} onRepository={setRepository}
            onFilter={(value) => { setDeletedOnly(false); setArchived(value === 'archived'); setFilter(value === 'archived' ? 'all' : value) }} />
        </div>}
      </RoomPopover>
    </div>
    <div className="rooms-im-sidebar-tabs" role="group" aria-label={t('roomsSidebarFilter')}>
      {(['all', 'unread', 'attention'] as const).map((value) => <button key={value} type="button"
        aria-pressed={!deletedOnly && !archived && filter === value}
        onClick={() => { setDeletedOnly(false); setArchived(false); setFilter(value) }}>{t('roomsFilter_' + value)}</button>)}

    </div>
    {kind !== 'all' || archived || repository || deletedOnly ? <button className="rooms-sidebar-active-filter" onClick={() => {
      setKind('all'); setArchived(false); setDeletedOnly(false); setFilter('all'); setRepository(''); writeBrowserStorageItem('kun.rooms.sidebar.kind', 'all')
    }}>{t(deletedOnly ? 'roomsRecentlyDeleted' : 'roomsSidebar_' + kind)}{archived ? ' · ' + t('roomsArchivedConversations') : ''}{repository ? ' · ' + repository.split('/').at(-1) : ''}<X size={12} /></button> : null}
    {search.trim().length >= 2 ? <button className="rooms-sidebar-search-all" onClick={() => setFullSearch(!fullSearch)}>{t(fullSearch ? 'roomsSidebarChatsOnly' : 'roomsSidebarSearchAll')}</button> : null}
    {fullSearch && search.trim().length >= 2 ? <RoomUnifiedSearch query={search} repositoryRoot={repository} includeArchived={archived} onSelect={(hit) => { onSearch(hit); setSearch(''); setFullSearch(false) }} /> :
      <div className="rooms-im-sidebar-list" ref={scroll} onScroll={rememberScroll} tabIndex={-1} aria-label={t('roomsConversations')}>
        <div style={{ ...(virtual ? { height: virtualizer.getTotalSize() } : {}), position: 'relative' }}>{rows.map((row) => {
          const entry = entries[row.index]
          const selected = Boolean(entry.roomId && entry.roomId === selectedRoomId)
          return <div key={row.key} data-sidebar-entry={entry.id} data-pinned={entry.pinned} data-index={row.index} ref={virtual ? virtualizer.measureElement : undefined}
            className={'rooms-im-sidebar-row' + (selected ? ' is-selected' : '')}
            style={virtual ? { position: 'absolute', top: row.start, width: '100%' } : undefined}>
            <RoomSidebarRow entry={entry} selected={selected} disabled={entry.deleted}
              onOpen={() => entry.roomId && onSelect(entry.roomId)}
              menu={<RoomPopover label={`${entry.name} · ${t('roomsMoreActions')}`} trigger={<MoreHorizontal size={15} />} className="rooms-sidebar-row-menu rooms-icon-button" align="end">
                {(close) => <div className="rooms-menu-list">{entry.deleted ? <button onClick={() => { close(); void moveConversation(entry, false) }}>{t('roomsRestoreConversation')}</button> : <><button onClick={() => { close(); page.togglePin(entry); requestAnimationFrame(() => {
                    if (document.activeElement === document.body) scroll.current?.focus({ preventScroll: true })
                  }) }}>{t(entry.pinned ? 'roomsUnpinConversation' : 'roomsPinConversation')}</button>
                  <button onClick={() => { close(); void act(entry, 'archive') }}>{t(entry.archived ? 'roomsRestoreArchivedConversation' : 'roomsArchiveConversation')}</button>
                  <button onClick={() => { close(); setActionError(''); setDeleteTarget(entry) }}>{t('roomsDeleteConversation')}</button></>}</div>}
              </RoomPopover>} />
          </div>
        })}</div>
        {page.nextCursor ? <button className="rooms-sidebar-search-all" disabled={page.busy} onClick={page.more}>{t('roomsLoadMore')}</button> : null}
        {!entries.length ? <div className="rooms-sidebar-empty" role="status">
          {page.busy ? <><span className="rooms-skeleton" /><span className="rooms-skeleton" /><span className="rooms-skeleton" /><span className="sr-only">{t('roomsLoading')}</span></>
            : <><p>{t(search ? 'roomsSearchNoResults' : deletedOnly ? 'roomsNoDeletedChats' : filter === 'unread' ? 'roomsNoUnreadChats' : filter === 'attention' ? 'roomsNoAttentionChats' : 'roomsNoConversations')}</p>
              {!search && !deletedOnly && filter === 'all' ? <button type="button" onClick={onCreateAgent}>{t('roomsSidebarNew')}</button> : null}</>}
        </div> : null}
      </div>}
    {page.error || actionError ? <div role="alert" className="rooms-run-error">{page.error || actionError}<button onClick={page.refresh}>{t('roomsRefresh')}</button></div> : null}
    </>}
    <footer className="rooms-im-sidebar-footer"><button className="rooms-sidebar-self" aria-label={t('roomsMyAvatar')} onClick={onProfile}><RoomAvatar id="user" label={t('roomsMyAvatar')} size={30} /><span>{t('roomsSidebarYou')}</span></button>
      <RoomPopover label={t('roomsSidebarManage')} trigger={<Settings size={17} />} className="rooms-icon-button" align="end">
        {(close) => <div className="rooms-menu-list"><button onClick={() => { close(); onProfile() }}>{t('roomsMyAvatar')}</button>
          <button onClick={() => { close(); onManage() }}>{t('agentsDirectory')}</button><button onClick={() => { close(); onTeam() }}>{t('directTemplates')}</button>
          <button onClick={() => { close(); showSurface('chats'); setDeletedOnly(false); setArchived(!archived) }}>{t(archived ? 'roomsActiveConversations' : 'roomsArchivedConversations')}</button>
          <button onClick={() => {
            close(); showSurface('chats'); setDeletedOnly(true); setArchived(false); setFilter('all')
            setKind('all'); setSearch(''); setRepository(''); setFullSearch(false)
            writeBrowserStorageItem('kun.rooms.sidebar.kind', 'all')
          }}>{t('roomsRecentlyDeleted')}</button></div>}
      </RoomPopover>
    </footer>
    {deleteTarget ? <RoomModal title={t('roomsDeleteConversation')} busy={deleting} onClose={() => setDeleteTarget(null)}>
      <p className="rooms-delete-confirm-copy">{t('roomsDeleteConversationHint', { name: deleteTarget.name })}</p>
      {actionError ? <p role="alert" className="rooms-run-error">{actionError}</p> : null}
      <div className="rooms-delete-confirm-actions">
        <button type="button" disabled={deleting} onClick={() => setDeleteTarget(null)}>{t('roomsCancel')}</button>
        <button type="button" disabled={deleting} onClick={() => void moveConversation(deleteTarget, true)}>{t('roomsDeleteConversation')}</button>
      </div>
    </RoomModal> : null}
  </div>
}
