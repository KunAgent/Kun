import { useEffect, useRef, useState, type ComponentProps, type ReactElement } from 'react'
import { useTranslation } from 'react-i18next'
import { Check, ChevronDown, ChevronRight, LoaderCircle, MessageCirclePlus, MoreHorizontal, Plus, Search, X } from 'lucide-react'
import type { RoomSidebarEntry } from '@shared/rooms-api'
import { useChatStore } from '../../store/chat-store'
import { isConversationWorkspacePath } from '../../lib/workspace-path'
import { removeBrowserStorageItem } from '../../lib/browser-storage'
import { RoomModal } from '../rooms/RoomModal'
import { RoomPopover } from '../rooms/RoomPopover'
import { setRoomSidebarEntryDeleted, toggleRoomSidebarEntryArchived } from '../rooms/room-sidebar-actions'
import { useRoomSidebar } from '../rooms/useRoomSidebar'
import { roomRequestId, roomsRequest } from '../rooms/rooms-client'
import {
  openAgentConversation,
  openAgentConversationRoom,
  useAgentChatNavigationStore,
  AGENT_CHAT_SELECTED_KEY
} from '../rooms/agent-chat-navigation'
import { openAgentChatDialog } from '../rooms/agent-chat-picker'
import { publishRoomActivityCounts } from '../rooms/room-activity-counts'
import { SidebarIconButton, SidebarSearchField } from '../sidebar/SidebarPrimitives'
import { SidebarAgentChatRow } from './SidebarAgentChatRow'
import { SidebarConversationsSection } from './SidebarConversationsSection'
import {
  AGENT_CHATS_COLLAPSED_COUNT,
  CONVERSATION_FILTERS,
  conversationHasUnread,
  conversationSidebarQuery,
  isListedConversation,
  visibleAgentChatEntries,
  type ConversationFilter,
  type ConversationListState
} from './sidebar-agent-chats'
import './sidebar-agent-chats.css'

type Props = ComponentProps<typeof SidebarConversationsSection>

const FILTER_LABEL_KEYS: Record<ConversationFilter, string> = {
  all: 'conversationFilterAll',
  unread: 'conversationFilterUnread',
  attention: 'conversationFilterAttention',
  group: 'conversationFilterGroups'
}

/**
 * Code's conversation list: Agent private chats and group conversations in one
 * IM-style section above the projects. Opening an entry keeps the Code shell.
 */
export function SidebarAgentChatsSection(props: Props): ReactElement {
  const { t } = props
  const { t: tc } = useTranslation('common')
  const route = useChatStore((state) => state.route)
  const runtimeOffline = useChatStore((state) => state.runtimeConnection === 'offline')
  const roomId = useAgentChatNavigationStore((state) => state.roomId)
  const error = useAgentChatNavigationStore((state) => state.error)
  const pending = useAgentChatNavigationStore((state) => state.pending)
  const selectedRoomId = route === 'agent-chat' ? roomId : null
  const [collapsed, setCollapsed] = useState(false)
  const [expanded, setExpanded] = useState(false)
  const [searchOpen, setSearchOpen] = useState(false)
  const [search, setSearch] = useState('')
  const [filter, setFilter] = useState<ConversationFilter>('all')
  const [listState, setListState] = useState<ConversationListState>('active')
  const listScope = useRef('')
  listScope.current = JSON.stringify([listState, filter, search])
  const [busyEntries, setBusyEntries] = useState<Set<string>>(() => new Set())
  const [hiddenEntries, setHiddenEntries] = useState<Set<string>>(() => new Set())
  const [actionError, setActionError] = useState('')
  const [deleteTarget, setDeleteTarget] = useState<RoomSidebarEntry | null>(null)
  const [initializationError, setInitializationError] = useState('')
  const [initializationVersion, setInitializationVersion] = useState(0)
  const page = useRoomSidebar(conversationSidebarQuery(listState, filter, search), roomId ?? '', props.runtimeReady)
  const refresh = useRef(page.refresh)
  refresh.current = page.refresh
  useEffect(() => { publishRoomActivityCounts(page.entries) }, [page.entries])
  useEffect(() => {
    if (!props.runtimeReady) { setInitializationError(''); return }
    let active = true
    let retry: ReturnType<typeof setTimeout> | undefined
    const request = { action: 'initialize', clientRequestId: roomRequestId() }
    setInitializationError('')
    // Seed the default identity without selecting a chat or consuming onboarding.
    // A healthy HTTP listener can precede the initial configuration apply.
    // Retry the same idempotent operation once before presenting a failure.
    const initialize = (canRetry: boolean): void => {
      // Existing conversations can be read while the Rooms coordinator is
      // recovering its write lease. Do not turn a redundant bootstrap write
      // into an unavailable warning on every application launch.
      void roomsRequest<{ initialized: boolean }>('/v1/agents/chat-entry', 'GET')
        .then(async (entry) => {
          if (active && !entry.initialized) await roomsRequest('/v1/agents/chat-entry', 'POST', request)
        })
        .then(() => { if (active) refresh.current() }).catch((cause) => {
          if (!active) return
          if (canRetry) retry = setTimeout(() => initialize(false), 1000)
          else setInitializationError(cause instanceof Error ? cause.message : String(cause))
        })
    }
    initialize(true)
    return () => { active = false; clearTimeout(retry) }
  }, [props.runtimeReady, initializationVersion])
  useEffect(() => { setHiddenEntries(new Set()); setActionError('') }, [listState, filter, search])
  useEffect(() => {
    if (!hiddenEntries.size) return
    const listed = new Set(page.entries.map((entry) => entry.id))
    if ([...hiddenEntries].every((id) => listed.has(id))) return
    setHiddenEntries(new Set([...hiddenEntries].filter((id) => listed.has(id))))
  }, [hiddenEntries, page.entries])
  const browsingAll = expanded || listState !== 'active' || filter !== 'all'
  const listed = page.entries.filter((entry) => !hiddenEntries.has(entry.id) &&
    (listState === 'deleted' ? entry.deleted : !entry.deleted && entry.archived === (listState === 'archived')))
  const entries = visibleAgentChatEntries(listed, browsingAll, search, selectedRoomId, listState === 'deleted')
  const conversationCount = listed.filter(isListedConversation).length
  const unreadCount = listState === 'active' ? listed.filter((entry) => isListedConversation(entry) && conversationHasUnread(entry)).length : 0
  const hasHistory = props.threads.some((thread) =>
    isConversationWorkspacePath(thread.workspace, props.conversationRoot) && !thread.archived)
  const openEntry = (entry: RoomSidebarEntry): void => {
    if (entry.roomId) openAgentConversationRoom(entry.roomId)
    else if (entry.agentId) void openAgentConversation(entry.agentId).catch(() => undefined)
  }
  const openNewChat = (): void => {
    setListState('active')
    setCollapsed(false)
    openAgentChatDialog('picker')
  }
  const leaveHiddenConversation = (entry: RoomSidebarEntry): void => {
    if (!entry.roomId || useAgentChatNavigationStore.getState().roomId !== entry.roomId) return
    removeBrowserStorageItem(AGENT_CHAT_SELECTED_KEY)
    useAgentChatNavigationStore.setState({ roomId: null, error: '', pending: false })
    if (useChatStore.getState().route === 'agent-chat') useChatStore.getState().setRoute('chat')
  }
  const actOnEntry = async (entry: RoomSidebarEntry, action: 'archive' | 'delete' | 'restore'): Promise<void> => {
    if (!entry.roomId || busyEntries.has(entry.id)) return
    const scope = listScope.current
    setBusyEntries((current) => new Set([...current, entry.id]))
    setActionError('')
    try {
      if (action === 'archive') await toggleRoomSidebarEntryArchived(entry)
      else await setRoomSidebarEntryDeleted(entry, action === 'delete')
      if (scope === listScope.current) setHiddenEntries((current) => new Set([...current, entry.id]))
      if (action === 'delete' || (action === 'archive' && !entry.archived)) leaveHiddenConversation(entry)
      setDeleteTarget(null)
      page.refresh()
    } catch (cause) {
      const message = cause instanceof Error ? cause.message : String(cause)
      setActionError(message.includes('stop or reconcile active work') ? t('roomsDeleteActiveWork') : message)
    } finally {
      setBusyEntries((current) => { const next = new Set(current); next.delete(entry.id); return next })
    }
  }
  const scopeLabel = listState !== 'active'
    ? t(listState === 'archived' ? 'roomsArchivedConversations' : 'roomsRecentlyDeleted')
    : filter !== 'all' ? tc(FILTER_LABEL_KEYS[filter]) : ''

  return <>
    <section className="sidebar-agent-chats ds-no-drag" data-browsing-all={browsingAll || undefined}
      data-collapsed={collapsed || undefined} aria-label={t('sidebarConversations')}>
      <div className="sidebar-agent-chats-header">
        <button type="button" aria-expanded={!collapsed} title={t('agentChatsDescription')}
          className="sidebar-agent-chats-title" onClick={() => setCollapsed(!collapsed)}>
          <span>{t('sidebarConversations')}</span>
          {unreadCount ? <span className="sidebar-agent-chats-count" aria-label={tc('conversationUnreadCount', { count: unreadCount })}>
            {unreadCount}</span> : null}
          {collapsed ? <ChevronRight size={12} aria-hidden="true" /> : <ChevronDown size={12} aria-hidden="true" />}
          {pending ? <LoaderCircle size={12} className="animate-spin" /> : null}
        </button>
        <div className="sidebar-agent-chats-actions">
          <SidebarIconButton title={t('agentChatsSearch')} active={searchOpen} disabled={!props.runtimeReady} className="h-6 w-6"
            onClick={() => { setCollapsed(false); setSearchOpen(!searchOpen); if (searchOpen) setSearch('') }}>
            <Search size={14} />
          </SidebarIconButton>
          <SidebarIconButton title={t('agentChatsStart')} disabled={!props.runtimeReady || pending}
            className="h-6 w-6" onClick={openNewChat}><Plus size={14} /></SidebarIconButton>
          <RoomPopover label={`${t('sidebarConversations')} · ${t('roomsMoreActions')}`} trigger={<MoreHorizontal size={14} />}
            disabled={!props.runtimeReady}
            className="sidebar-agent-chats-list-menu rooms-icon-button" align="end" width={232}>
            {(close) => <div className="rooms-menu-list sidebar-agent-chats-menu">
              <p className="sidebar-agent-chats-menu-label">{tc('conversationFilterLabel')}</p>
              {CONVERSATION_FILTERS.map((value) => {
                const checked = listState === 'active' && filter === value
                return <button type="button" key={value} aria-pressed={checked}
                  onClick={() => { close(); setListState('active'); setFilter(value); setCollapsed(false) }}>
                  <span>{tc(FILTER_LABEL_KEYS[value])}</span>{checked ? <Check size={14} aria-hidden="true" /> : null}
                </button>
              })}
              <hr />
              <button type="button" onClick={() => { close(); openAgentChatDialog('directory') }}>{tc('agentDirectoryTitle')}</button>
              {(['archived', 'deleted'] as const).map((value) =>
                <button type="button" key={value} aria-pressed={listState === value}
                  onClick={() => { close(); setFilter('all'); setListState(value); setCollapsed(false) }}>
                  {t(value === 'archived' ? 'roomsArchivedConversations' : 'roomsRecentlyDeleted')}
                </button>)}
            </div>}
          </RoomPopover>
        </div>
      </div>
      {!collapsed ? <>
        {searchOpen ? <div className="sidebar-agent-chats-search"><SidebarSearchField value={search}
          onChange={setSearch} placeholder={t('agentChatsSearch')} clearLabel={t('clear')} /></div> : null}
        {scopeLabel ? <button type="button" className="sidebar-agent-chats-scope"
          onClick={() => { setListState('active'); setFilter('all') }}>
          <span>{scopeLabel}</span><X size={12} aria-hidden="true" />
        </button> : null}
        <div className="sidebar-agent-chats-list" data-kun-drag-scroll>
          {!props.runtimeReady ? <div role="status" aria-live="polite" data-agent-chats-waiting
            className="flex min-h-16 items-center justify-center gap-2 text-xs text-ds-faint">
            {!runtimeOffline ? <LoaderCircle size={14} className="animate-spin" /> : null}
            {t(runtimeOffline ? 'runtimeActionNeedsConnection' : 'waitingForKun')}
          </div> : <>
          {entries.map((entry) => <SidebarAgentChatRow key={entry.id} entry={entry}
            selected={Boolean(selectedRoomId && entry.roomId === selectedRoomId)}
            disabled={!props.runtimeReady || pending || entry.archived || entry.deleted || busyEntries.has(entry.id) || (!entry.roomId && !entry.agentId)}
            onOpen={() => openEntry(entry)} menu={<RoomPopover label={`${entry.name} · ${t('roomsMoreActions')}`}
              trigger={<MoreHorizontal size={14} />} className="sidebar-agent-chat-menu rooms-icon-button" align="end" width={220}
              disabled={!props.runtimeReady || pending || busyEntries.has(entry.id)}>
              {(close) => <div className="rooms-menu-list">{entry.deleted ?
                <button type="button" onClick={() => { close(); void actOnEntry(entry, 'restore') }}>{t('roomsRestoreConversation')}</button> : <>
                <button type="button" onClick={() => { close(); setActionError(''); page.togglePin(entry) }}>
                  {t(entry.pinned ? 'roomsUnpinConversation' : 'roomsPinConversation')}</button>
                <button type="button" disabled={!entry.roomId} onClick={() => { close(); void actOnEntry(entry, 'archive') }}>
                  {t(entry.archived ? 'roomsRestoreArchivedConversation' : 'roomsArchiveConversation')}</button>
                <button type="button" disabled={!entry.roomId} onClick={() => { close(); setActionError(''); setDeleteTarget(entry) }}>
                  {t('roomsDeleteConversation')}</button>
              </>}</div>}
            </RoomPopover>} />)}
          {!entries.length && !page.error ? <button type="button" className="sidebar-agent-chats-empty"
            onClick={listState === 'active' ? openNewChat : undefined} disabled={listState !== 'active' || !props.runtimeReady || page.busy || pending}>
            <MessageCirclePlus size={20} strokeWidth={1.5} />
            <span>{t(page.busy ? 'roomsLoading' : search.trim() || listState !== 'active' || filter !== 'all' ? 'roomsSearchNoResults' : 'agentChatsEmptyHint')}</span>
          </button> : null}
          {browsingAll && page.nextCursor ? <button type="button" className="sidebar-agent-chats-more"
            disabled={page.busy} onClick={page.more}>{t('roomsLoadMore')}</button> : null}
          {page.error || error || initializationError || actionError ? <div role="alert" className="sidebar-agent-chats-error">
            <span>{actionError || error || t('agentChatsUnavailable')}</span>
            {page.error || initializationError ? <button type="button" onClick={() => {
              page.refresh()
              if (initializationError) setInitializationVersion((version) => version + 1)
            }}>{t('roomsRefresh')}</button> : null}
          </div> : null}
          {hasHistory && listState === 'active' && filter === 'all' ? <SidebarConversationsSection {...props} activeThreadId={route === 'agent-chat' ? null : props.activeThreadId}
            titleKey="agentChatsLegacyHistory" /> : null}
          </>}
        </div>
        {props.runtimeReady && listState === 'active' && filter === 'all' && !search.trim() &&
          (conversationCount > AGENT_CHATS_COLLAPSED_COUNT || page.nextCursor) ? <button type="button"
          className="sidebar-agent-chats-more" aria-expanded={expanded} onClick={() => setExpanded(!expanded)}>
          {expanded ? t('agentChatsShowLess') : page.nextCursor ? t('agentChatsViewAll')
            : tc('conversationViewAll', { count: conversationCount })}
          {expanded ? null : <ChevronRight size={12} aria-hidden="true" />}
        </button> : null}
      </> : null}
    </section>
    {deleteTarget ? <RoomModal title={t('roomsDeleteConversation')} busy={busyEntries.has(deleteTarget.id)} onClose={() => setDeleteTarget(null)}>
      <p className="rooms-delete-confirm-copy">{t('roomsDeleteConversationHint', { name: deleteTarget.name })}</p>
      {actionError ? <p role="alert" className="rooms-run-error">{actionError}</p> : null}
      <div className="rooms-delete-confirm-actions">
        <button type="button" disabled={busyEntries.has(deleteTarget.id)} onClick={() => setDeleteTarget(null)}>{t('roomsCancel')}</button>
        <button type="button" disabled={busyEntries.has(deleteTarget.id)} onClick={() => void actOnEntry(deleteTarget, 'delete')}>{t('roomsDeleteConversation')}</button>
      </div>
    </RoomModal> : null}
  </>
}
