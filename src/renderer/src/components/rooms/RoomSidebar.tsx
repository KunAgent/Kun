import { useRoomSidebarMotion } from './useRoomSidebarMotion'
import { useEffect, useRef, useState } from 'react'
import { useVirtualizer } from '@tanstack/react-virtual'
import { useTranslation } from 'react-i18next'
import { Search, Plus, MoreHorizontal, SlidersHorizontal, Settings, X } from 'lucide-react'
import type { RoomSearchHit, RoomSidebarEntry } from '@shared/rooms-api'
import { useRoomSidebar } from './useRoomSidebar'
import { RoomAvatar } from './RoomAvatar'
import { RoomSidebarRow } from './RoomSidebarRow'
import { RoomPopover } from './RoomPopover'
import { RoomListFilters } from './RoomManagementControls'
import { RoomUnifiedSearch } from './RoomUnifiedSearch'
import { toggleRoomSidebarEntryArchived } from './room-sidebar-actions'
import { readBrowserStorageItem, writeBrowserStorageItem } from '../../lib/browser-storage'

type Kind = 'all' | 'agents' | 'group' | 'agent_agent'
export function RoomSidebar({ selectedRoomId, onOpenAgent, onSelect, onCreateAgent, onDetails, onSearch,
  onProfile, onTeam, onManage, onActivity }: {
  selectedRoomId: string; onOpenAgent: (id: string) => void; onSelect: (id: string) => void
  onCreateAgent: () => void; onCreateGroup: () => void; onDetails: (id: string) => void
  onSearch: (hit: RoomSearchHit) => void; onProfile: () => void; onTeam: () => void; onManage: () => void; onActivity?: (entry: RoomSidebarEntry | undefined) => void
}) {
  const { t } = useTranslation('common')
  const [kind, setKind] = useState<Kind>(() => {
    const old = readBrowserStorageItem('kun.rooms.sidebar.kind'); return old === 'agents' || old === 'group' || old === 'agent_agent' ? old : 'all'
  })
  const [filter, setFilter] = useState<'all' | 'unread' | 'attention'>('all'), [archived, setArchived] = useState(false)
  const [repository, setRepository] = useState(''), [search, setSearch] = useState(''), [fullSearch, setFullSearch] = useState(false)
  const [actionError, setActionError] = useState('')
  const page = useRoomSidebar({ kind, search, archivedOnly: archived, unreadOnly: filter === 'unread', attentionOnly: filter === 'attention', repositoryRoot: repository || undefined }, selectedRoomId)
  useEffect(() => {
    const first = page.entries[0]
    if (!selectedRoomId && first) { if (first.agentId) onOpenAgent(first.agentId); else if (first.roomId) onSelect(first.roomId) }
  }, [selectedRoomId, page.entries, onOpenAgent, onSelect])
  useEffect(() => { onActivity?.(page.entries.find((entry) => entry.roomId === selectedRoomId)) }, [page.entries, selectedRoomId, onActivity])
  const scroll = useRef<HTMLDivElement>(null)
  const rememberScroll = useRoomSidebarMotion(scroll, page.entries, JSON.stringify([kind, search, archived, filter, repository]))
  const virtualizer = useVirtualizer({ count: page.entries.length, getScrollElement: () => scroll.current, estimateSize: () => 64,
    getItemKey: (index) => page.entries[index].id, overscan: 8 })
  const virtual = page.entries.length > 60
  const rows = virtual ? virtualizer.getVirtualItems() : page.entries.map((item, index) => ({ key: item.id, index, start: 0 }))
  const act = async (entry: RoomSidebarEntry, action: 'archive') => {
    setActionError('')
    try {
      if (action === 'archive') await toggleRoomSidebarEntryArchived(entry)
      page.refresh()
    } catch (cause) { setActionError(String(cause)) }
  }
  return <div className="rooms-im-sidebar">
    <div className="rooms-im-sidebar-toolbar">
      <div className="rooms-list-search"><Search size={15} /><input value={search} onChange={(e) => { setSearch(e.target.value); setFullSearch(false) }}
        aria-label={t('roomsSidebarSearch')} placeholder={t('roomsSidebarSearch')} />{search ? <button aria-label={t('roomsClose')} onClick={() => setSearch('')}><X size={14} /></button> : null}</div>
      <button type="button" aria-label={t('roomsSidebarNew')} title={t('roomsSidebarNew')} className="rooms-icon-button rooms-im-sidebar-new" onClick={onCreateAgent}><Plus size={18} /></button>
      <RoomPopover label={t('roomsSidebarFilter')} trigger={<SlidersHorizontal size={16} />} className="rooms-icon-button" align="end" width={280}>
        {() => <div className="rooms-sidebar-filter-menu"><label>{t('roomsSidebarKind')}<select value={kind} onChange={(e) => {
          const value = e.target.value as Kind; setKind(value); writeBrowserStorageItem('kun.rooms.sidebar.kind', value)
        }}>{(['all', 'agents', 'group', 'agent_agent'] as const).map((value) => <option key={value} value={value}>{t('roomsSidebar_' + value)}</option>)}</select></label>
          <RoomListFilters filter={filter} archived={archived} repositoryRoot={repository} onRepository={setRepository}
            onFilter={(value) => { setArchived(value === 'archived'); setFilter(value === 'archived' ? 'all' : value) }} />
        </div>}
      </RoomPopover>
    </div>
    <div className="rooms-im-sidebar-tabs" role="group" aria-label={t('roomsSidebarFilter')}>
      {(['all', 'unread', 'attention'] as const).map((value) => <button key={value} type="button" aria-pressed={!archived && filter === value}
        onClick={() => { setArchived(false); setFilter(value) }}>{t('roomsFilter_' + value)}</button>)}
    </div>
    {kind !== 'all' || archived || repository ? <button className="rooms-sidebar-active-filter" onClick={() => {
      setKind('all'); setArchived(false); setFilter('all'); setRepository(''); writeBrowserStorageItem('kun.rooms.sidebar.kind', 'all')
    }}>{t('roomsSidebar_' + kind)}{archived ? ' · ' + t('roomsArchived') : ''}{repository ? ' · ' + repository.split('/').at(-1) : ''}<X size={12} /></button> : null}
    {search.trim().length >= 2 ? <button className="rooms-sidebar-search-all" onClick={() => setFullSearch(!fullSearch)}>{t(fullSearch ? 'roomsSidebarChatsOnly' : 'roomsSidebarSearchAll')}</button> : null}
    {fullSearch && search.trim().length >= 2 ? <RoomUnifiedSearch query={search} repositoryRoot={repository} includeArchived={archived} onSelect={(hit) => { onSearch(hit); setSearch(''); setFullSearch(false) }} /> :
      <div className="rooms-im-sidebar-list" ref={scroll} onScroll={rememberScroll} tabIndex={-1} aria-label={t('roomsConversations')}>
        <div style={{ ...(virtual ? { height: virtualizer.getTotalSize() } : {}), position: 'relative' }}>{rows.map((row) => {
          const entry = page.entries[row.index]
          const selected = Boolean(entry.roomId && entry.roomId === selectedRoomId)
          return <div key={row.key} data-sidebar-entry={entry.id} data-pinned={entry.pinned} data-index={row.index} ref={virtual ? virtualizer.measureElement : undefined}
            className={'rooms-im-sidebar-row' + (selected ? ' is-selected' : '')}
            style={virtual ? { position: 'absolute', top: row.start, width: '100%' } : undefined}>
            <RoomSidebarRow entry={entry} selected={selected}
              onOpen={() => entry.agentId ? onOpenAgent(entry.agentId) : entry.roomId && onSelect(entry.roomId)}
              menu={<RoomPopover label={t('agentsActions', { name: entry.name })} trigger={<MoreHorizontal size={15} />} className="rooms-sidebar-row-menu rooms-icon-button" align="end">
                {(close) => <div className="rooms-menu-list">{entry.agentId ? <button onClick={() => { close(); onDetails(entry.agentId!) }}>{t('agentsProfileAndMemory')}</button> : null}
                  <button onClick={() => { close(); page.togglePin(entry); requestAnimationFrame(() => {
                    if (document.activeElement === document.body) scroll.current?.focus({ preventScroll: true })
                  }) }}>{t(entry.pinned ? 'roomsSidebarUnpin' : 'roomsPin')}</button>
                  <button onClick={() => { close(); void act(entry, 'archive') }}>{t(entry.archived ? 'agentsRestore' : 'agentsArchive')}</button></div>}
              </RoomPopover>} />
          </div>
        })}</div>
        {page.nextCursor ? <button className="rooms-sidebar-search-all" disabled={page.busy} onClick={page.more}>{t('roomsLoadMore')}</button> : null}
        {!page.entries.length ? <p className="rooms-run-note">{t(page.busy ? 'roomsLoading' : 'roomsSearchNoResults')}</p> : null}
      </div>}
    {page.error || actionError ? <div role="alert" className="rooms-run-error">{page.error || actionError}<button onClick={page.refresh}>{t('roomsRefresh')}</button></div> : null}
    <footer className="rooms-im-sidebar-footer"><button className="rooms-sidebar-self" aria-label={t('roomsMyAvatar')} onClick={onProfile}><RoomAvatar id="user" label={t('roomsMyAvatar')} size={30} /><span>{t('roomsSidebarYou')}</span></button>
      <RoomPopover label={t('roomsSidebarManage')} trigger={<Settings size={17} />} className="rooms-icon-button" align="end">
        {(close) => <div className="rooms-menu-list"><button onClick={() => { close(); onProfile() }}>{t('roomsMyAvatar')}</button>
          <button onClick={() => { close(); onManage() }}>{t('agentsDirectory')}</button><button onClick={() => { close(); onTeam() }}>{t('directTemplates')}</button>
          <button onClick={() => { close(); setArchived(!archived) }}>{t(archived ? 'roomsActive' : 'roomsArchived')}</button></div>}
      </RoomPopover>
    </footer>
  </div>
}
