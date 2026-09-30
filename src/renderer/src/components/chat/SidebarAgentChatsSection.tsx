import { useEffect, useRef, useState, type ComponentProps, type ReactElement, type ReactNode } from 'react'
import { useTranslation } from 'react-i18next'
import { ChevronDown, ChevronRight, LoaderCircle, MessageCirclePlus, MoreHorizontal, Pin, Plus, Search, X } from 'lucide-react'
import type { RoomSidebarEntry } from '@shared/rooms-api'
import { useChatStore } from '../../store/chat-store'
import { isConversationWorkspacePath } from '../../lib/workspace-path'
import { imListTime } from '../../lib/im-time'
import { removeBrowserStorageItem } from '../../lib/browser-storage'
import { RoomAvatar } from '../rooms/RoomAvatar'
import { RoomNewChat } from '../rooms/RoomNewChat'
import { RoomModal } from '../rooms/RoomModal'
import { RoomPopover } from '../rooms/RoomPopover'
import { AgentProfileForm } from '../rooms/AgentProfileForm'
import { setRoomSidebarEntryDeleted, toggleRoomSidebarEntryArchived } from '../rooms/room-sidebar-actions'
import { useRoomSidebar } from '../rooms/useRoomSidebar'
import { roomRequestId, roomsRequest } from '../rooms/rooms-client'
import {
  openAgentConversation,
  openAgentConversationRoom,
  useAgentChatNavigationStore,
  AGENT_CHAT_SELECTED_KEY
} from '../rooms/agent-chat-navigation'
import { SidebarIconButton, SidebarSearchField } from '../sidebar/SidebarPrimitives'
import { SidebarConversationsSection } from './SidebarConversationsSection'
import {
  AGENT_CHATS_MAX_HEIGHT,
  AGENT_CHATS_MIN_HEIGHT,
  clampAgentChatsHeight,
  readAgentChatsHeight,
  saveAgentChatsHeight,
  visibleAgentChatEntries
} from './sidebar-agent-chats'
import './sidebar-agent-chats.css'

type Props = ComponentProps<typeof SidebarConversationsSection>

function AgentChatRow({ entry, selected, disabled, onOpen, menu }: {
  entry: RoomSidebarEntry
  selected: boolean
  disabled: boolean
  onOpen: () => void
  menu: ReactNode
}): ReactElement {
  const { t, i18n } = useTranslation('common')
  const latest = entry.latestMessage
  const preview = latest
    ? (latest.authorKind === 'user' ? t('roomsSidebarYou') + ': ' : '') +
      (latest.preview || (latest.attachmentCount ? t('roomsAttachmentSummary', { count: latest.attachmentCount }) : ''))
    : entry.title
  const unread = !entry.deleted && entry.latestMessageSeq > entry.readSeq
  return <div className="sidebar-agent-chat-item" data-sidebar-entry={entry.id} data-pinned={entry.pinned}>
    <button
    type="button"
    className={'sidebar-agent-chat-row' + (selected ? ' is-selected' : '')}
    aria-label={entry.name}
    aria-current={selected ? 'page' : undefined}
    disabled={disabled}
    onClick={onOpen}
  >
    <span className="sidebar-agent-chat-avatar">
      <RoomAvatar avatar={entry.avatar} id={entry.agentId} label={entry.name} size={32} />
      {entry.runningCount > 0 ? <i aria-label={t('agentsWorking')} role="img" /> : null}
    </span>
    <span className="sidebar-agent-chat-copy">
      <span className="sidebar-agent-chat-name"><strong>{entry.name}</strong>
        {latest ? <time dateTime={latest.createdAt}>{imListTime(latest.createdAt, i18n.language)}</time> : null}
      </span>
      <span className="sidebar-agent-chat-preview">
        {entry.attentionCount > 0 ? <b>{t('roomsAttention')}</b> : null}
        <small>{preview}</small>
        {entry.pinned ? <Pin size={10} aria-label={t('roomsPinConversation')} /> : null}
        {unread ? <span className="sidebar-agent-chat-unread" role="img" aria-label={t('roomsUnread')} /> : null}
      </span>
    </span>
  </button>
  {menu}
  </div>
}

export function SidebarAgentChatsSection(props: Props): ReactElement {
  const { t } = props
  const route = useChatStore((state) => state.route)
  const roomId = useAgentChatNavigationStore((state) => state.roomId)
  const error = useAgentChatNavigationStore((state) => state.error)
  const pending = useAgentChatNavigationStore((state) => state.pending)
  const selectedRoomId = route === 'agent-chat' ? roomId : null
  const [height, setHeight] = useState(readAgentChatsHeight)
  const [collapsed, setCollapsed] = useState(false)
  const [expanded, setExpanded] = useState(false)
  const [searchOpen, setSearchOpen] = useState(false)
  const [search, setSearch] = useState('')
  const [listState, setListState] = useState<'active' | 'archived' | 'deleted'>('active')
  const listScope = useRef('')
  listScope.current = JSON.stringify([listState, search])
  const [busyEntries, setBusyEntries] = useState<Set<string>>(() => new Set())
  const [hiddenEntries, setHiddenEntries] = useState<Set<string>>(() => new Set())
  const [actionError, setActionError] = useState('')
  const [deleteTarget, setDeleteTarget] = useState<RoomSidebarEntry | null>(null)
  const [newChatOpen, setNewChatOpen] = useState(false)
  const [newAgentProfileOpen, setNewAgentProfileOpen] = useState(false)
  const dialog = useRef<{
    picker: boolean; profile: boolean
    origin?: { route: string; threadId: string | null; roomId: string | null }
  }>({ picker: false, profile: false })
  const [initializationError, setInitializationError] = useState('')
  const [initializationVersion, setInitializationVersion] = useState(0)
  const drag = useRef<{ pointerId: number; y: number; height: number } | null>(null)
  const page = useRoomSidebar({ kind: 'agents', search,
    ...(listState === 'archived' ? { archivedOnly: true } : listState === 'deleted' ? { deletedOnly: true } : {}) }, roomId ?? '')
  const refresh = useRef(page.refresh)
  refresh.current = page.refresh
  useEffect(() => {
    const offChat = useChatStore.subscribe((state, previous) => {
      if (state.route !== previous.route || state.activeThreadId !== previous.activeThreadId) dialog.current.origin = undefined
    })
    const offAgent = useAgentChatNavigationStore.subscribe((state, previous) => {
      if (state.roomId !== previous.roomId) dialog.current.origin = undefined
    })
    return () => { offChat(); offAgent(); dialog.current.picker = false; dialog.current.profile = false }
  }, [])
  useEffect(() => {
    if (!props.runtimeReady) return
    let active = true
    setInitializationError('')
    // Seed the default identity without selecting a chat or consuming onboarding.
    void roomsRequest('/v1/agents/chat-entry', 'POST', {
      action: 'initialize', clientRequestId: roomRequestId()
    }).then(() => { if (active) refresh.current() }).catch((cause) => {
      if (active) setInitializationError(cause instanceof Error ? cause.message : String(cause))
    })
    return () => { active = false }
  }, [props.runtimeReady, initializationVersion])
  useEffect(() => { setHiddenEntries(new Set()); setActionError('') }, [listState, search])
  useEffect(() => {
    if (!hiddenEntries.size) return
    const listed = new Set(page.entries.map((entry) => entry.id))
    if ([...hiddenEntries].every((id) => listed.has(id))) return
    setHiddenEntries(new Set([...hiddenEntries].filter((id) => listed.has(id))))
  }, [hiddenEntries, page.entries])
  const browsingAll = expanded || listState !== 'active'
  const entries = visibleAgentChatEntries(page.entries.filter((entry) => !hiddenEntries.has(entry.id) &&
    (listState === 'deleted' ? entry.deleted : !entry.deleted && entry.archived === (listState === 'archived'))),
  browsingAll, search, selectedRoomId, listState === 'deleted')
  const hasHistory = props.threads.some((thread) =>
    isConversationWorkspacePath(thread.workspace, props.conversationRoot) && !thread.archived)
  const changeHeight = (value: number): void => setHeight(saveAgentChatsHeight(value))
  const openEntry = (entry: RoomSidebarEntry): void => {
    if (entry.roomId) openAgentConversationRoom(entry.roomId)
    else if (entry.agentId) void openAgentConversation(entry.agentId).catch(() => undefined)
  }
  const openNewChat = (): void => {
    const current = useChatStore.getState()
    dialog.current = { picker: true, profile: false, origin: {
      route: current.route, threadId: current.activeThreadId, roomId: useAgentChatNavigationStore.getState().roomId
    } }
    setListState('active')
    setCollapsed(false)
    setNewChatOpen(true)
  }
  const originIsCurrent = (): boolean => {
    const origin = dialog.current.origin
    const current = useChatStore.getState()
    return Boolean(origin && origin.route === current.route && origin.threadId === current.activeThreadId &&
      origin.roomId === useAgentChatNavigationStore.getState().roomId)
  }
  const closePicker = (): void => { dialog.current.picker = false; setNewChatOpen(false) }
  const closeProfile = (): void => { dialog.current.profile = false; setNewAgentProfileOpen(false) }
  const dialogSession = dialog.current
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

  return <>
    <div
      className="sidebar-agent-chats-resize ds-no-drag"
      role="separator"
      tabIndex={collapsed ? -1 : 0}
      aria-label={t('agentChatsResize')}
      aria-orientation="horizontal"
      aria-valuemin={AGENT_CHATS_MIN_HEIGHT}
      aria-valuemax={AGENT_CHATS_MAX_HEIGHT}
      aria-valuenow={height}
      aria-disabled={collapsed}
      onPointerDown={(event) => {
        if (collapsed || event.button !== 0) return
        event.preventDefault()
        event.currentTarget.setPointerCapture(event.pointerId)
        drag.current = { pointerId: event.pointerId, y: event.clientY, height }
      }}
      onPointerMove={(event) => {
        const current = drag.current
        if (current?.pointerId === event.pointerId) {
          setHeight(clampAgentChatsHeight(current.height + current.y - event.clientY))
        }
      }}
      onPointerUp={(event) => {
        if (drag.current?.pointerId !== event.pointerId) return
        drag.current = null
        if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId)
        changeHeight(height)
      }}
      onPointerCancel={() => { drag.current = null; changeHeight(height) }}
      onKeyDown={(event) => {
        const next = event.key === 'ArrowUp' ? height + 20 : event.key === 'ArrowDown' ? height - 20 :
          event.key === 'Home' ? AGENT_CHATS_MIN_HEIGHT : event.key === 'End' ? AGENT_CHATS_MAX_HEIGHT : null
        if (next === null || collapsed) return
        event.preventDefault()
        changeHeight(next)
      }}
    ><span /></div>
    <section className="sidebar-agent-chats ds-no-drag" style={{ height: collapsed ? 38 : height }}
      aria-label={t('sidebarConversations')}>
      <div className="sidebar-agent-chats-header">
        <button type="button" aria-expanded={!collapsed} title={t('agentChatsDescription')}
          className="sidebar-agent-chats-title" onClick={() => setCollapsed(!collapsed)}>
          {collapsed ? <ChevronRight size={12} /> : <ChevronDown size={12} />}
          <span>{t('sidebarConversations')}</span>
          {pending ? <LoaderCircle size={12} className="animate-spin" /> : null}
        </button>
        <div className="flex items-center gap-0.5">
          <SidebarIconButton title={t('agentChatsSearch')} active={searchOpen} className="h-7 w-7"
            onClick={() => { setCollapsed(false); setSearchOpen(!searchOpen); if (searchOpen) setSearch('') }}>
            <Search size={14} />
          </SidebarIconButton>
          <SidebarIconButton title={t('agentChatsStart')} disabled={!props.runtimeReady || pending}
            className="h-7 w-7" onClick={openNewChat}><Plus size={14} /></SidebarIconButton>
          <RoomPopover label={`${t('sidebarConversations')} · ${t('roomsMoreActions')}`} trigger={<MoreHorizontal size={14} />}
            className="sidebar-agent-chats-list-menu rooms-icon-button" align="end" width={220}>
            {(close) => <div className="rooms-menu-list">{(['active', 'archived', 'deleted'] as const).map((value) =>
              <button type="button" key={value} aria-pressed={listState === value} onClick={() => { close(); setListState(value) }}>
                {t(value === 'active' ? 'roomsActiveConversations' : value === 'archived' ? 'roomsArchivedConversations' : 'roomsRecentlyDeleted')}
              </button>)}</div>}
          </RoomPopover>
        </div>
      </div>
      {!collapsed ? <>
        {searchOpen ? <div className="sidebar-agent-chats-search"><SidebarSearchField value={search}
          onChange={setSearch} placeholder={t('agentChatsSearch')} clearLabel={t('clear')} /></div> : null}
        {listState !== 'active' ? <button type="button" className="sidebar-agent-chats-more flex items-center gap-1"
          onClick={() => setListState('active')}>
          {t(listState === 'archived' ? 'roomsArchivedConversations' : 'roomsRecentlyDeleted')}<X size={12} />
        </button> : null}
        <div className="sidebar-agent-chats-list" data-kun-drag-scroll>
          {entries.map((entry) => <AgentChatRow key={entry.id} entry={entry}
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
            <MessageCirclePlus size={22} strokeWidth={1.5} />
            <span>{t(page.busy ? 'roomsLoading' : search.trim() || listState !== 'active' ? 'roomsSearchNoResults' : 'agentChatsEmptyHint')}</span>
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
          {hasHistory && listState === 'active' ? <SidebarConversationsSection {...props} activeThreadId={route === 'agent-chat' ? null : props.activeThreadId}
            titleKey="agentChatsLegacyHistory" /> : null}
        </div>
        {listState === 'active' && !search.trim() && (page.entries.length > 3 || page.nextCursor) ? <button type="button"
          className="sidebar-agent-chats-more" aria-expanded={expanded} onClick={() => setExpanded(!expanded)}>
          {t(expanded ? 'agentChatsShowLess' : 'agentChatsViewAll', { count: page.entries.length })}
        </button> : null}
      </> : null}
    </section>
    {newChatOpen ? <RoomNewChat selectionMode="private" onClose={closePicker}
      onOpen={(id) => {
        if (dialog.current === dialogSession && dialog.current.picker && originIsCurrent()) openAgentConversationRoom(id)
      }}
      onAgent={openAgentConversation} onFill={() => { dialog.current.profile = true; setNewAgentProfileOpen(true) }} /> : null}
    {newAgentProfileOpen ? <RoomModal title={t('agentsCreate')} onClose={closeProfile}>
      <AgentProfileForm agent={null} onSaved={(agent) => {
        if (dialog.current !== dialogSession || !dialog.current.profile) return
        const shouldOpen = originIsCurrent()
        closeProfile()
        page.refresh()
        if (shouldOpen) void openAgentConversation(agent.id).catch(() => undefined)
      }} />
    </RoomModal> : null}
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
