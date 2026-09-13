import { useEffect, useState, type ReactElement, type CSSProperties } from 'react'
import { useTranslation } from 'react-i18next'
import {
  Archive,
  MessagesSquare,
  MoreHorizontal,
  Search,
  Plus,
  RefreshCw,
  X
} from 'lucide-react'
import type { RoomContentOpenTarget, RoomContentReference, RoomMessage, SendRoomMessage, RoomSearchHit } from '@shared/rooms-api'
import { WorkspaceModeTabs } from '../chat/WorkspaceModeTabs'
import { useChatStore } from '../../store/chat-store'
import { RoomSettings, roomButtonClass } from './RoomSettings'
import { RoomComposer } from './RoomComposer'
import { RoomHeader } from './RoomHeader'
import { RoomMemberDetails } from './RoomMemberDetails'
import { RoomPopover } from './RoomPopover'
import { roomsClient } from './rooms-client'
import { useRooms } from './useRooms'
import './rooms.css'
import { RoomTimeline } from './RoomTimeline'
import { RoomTaskStrip } from './RoomTaskStrip'
import { RoomList } from './RoomList'
import { RoomOverview } from './RoomOverview'
import { useRoomTopics } from './useRoomTopics'
import {
  continueRoomTopic,
  RoomPeerActivity,
  RoomPeerSummary
} from './RoomPeerActivity'
import { RoomRunInspector } from './RoomRunInspector'
import { RoomDrawerNavigation, useRoomDrawerNavigation } from './RoomDrawerNavigation'
import { RoomDrawerTask } from './RoomDrawerTask'
import { RoomReplyThread } from './RoomReplyThread'
import { RoomContentPreview } from './RoomContentPreview'
import { RoomListFilters } from './RoomManagementControls'
import { RoomUnifiedSearch } from './RoomUnifiedSearch'
import { RoomPanelResizeHandle } from './RoomPanelResizeHandle'
import { RoomRunSummary } from './RoomRunSummary'
import { useRoomPresentationPreferences } from './room-presentation-preferences'
import { openRoomContentTarget } from './room-content-navigation'

export function RoomsWorkspaceView({
  onOpenThread,
  onOpenContentTarget
}: {
  onOpenThread: (id: string, turnId?: string) => void | Promise<void>
  onOpenContentTarget?: (target: RoomContentOpenTarget) => void | Promise<void>
}): ReactElement {
  const { t } = useTranslation('common')
  const state = useRooms()
  const [settings, setSettings] = useState<'create' | 'edit' | null>(null)
  const [sidebarOpen, setSidebarOpen] = useState(false)
  const [busy, setBusy] = useState(false)
  const [searchOpen, setSearchOpen] = useState(false)
  const [jumpMessageId, setJumpMessageId] = useState<string | null>(null)
  const { room, messages } = state
  const { selectedId } = state
  const topicState = useRoomTopics(selectedId)
  const drawer = useRoomDrawerNavigation(selectedId)
  const presentation = useRoomPresentationPreferences()
  const [searchTarget, setSearchTarget] = useState<RoomSearchHit | null>(null)
  useEffect(() => {
    if (!searchTarget || room?.id !== searchTarget.roomId) return
    if (searchTarget.messageId) { setJumpMessageId(searchTarget.messageId); drawer.close() }
    else if (searchTarget.memberId) drawer.open({ kind: 'section', section: 'members', memberId: searchTarget.memberId })
    else if (searchTarget.taskId) drawer.open({ kind: 'task', taskId: searchTarget.taskId })
    setSearchTarget(null)
  }, [searchTarget, room?.id, drawer])

  useEffect(() => {
    setSearchOpen(false)
  }, [selectedId])

  const perform = async (action: () => Promise<unknown>): Promise<void> => {
    setBusy(true)
    state.setError('')
    try {
      await action()
      await state.refresh()
    } catch (cause) {
      state.setError(cause instanceof Error ? cause.message : String(cause))
    } finally {
      setBusy(false)
    }
  }
  const pin = (message: RoomMessage): void => {
    void perform(() =>
      roomsClient.pinMessage(message.roomId, message.id, `pin-${message.id}`)
    )
  }
  const chooseRoom = (id: string): void => {
    state.select(id)
    drawer.close()
    setSidebarOpen(false)
    setJumpMessageId(null)
  }
  const openRun = (runId: string): void => drawer.open({ kind: 'run', runId })
  const openTask = (taskId: string): void => drawer.open({ kind: 'task', taskId })
  const openMember = (memberId: string, rootRequestId?: string): void => drawer.open({ kind: 'section', section: 'members', memberId, rootRequestId })
  const openContent = (reference: RoomContentReference, messageId?: string): void => drawer.open({ kind: 'content', reference, messageId })
  const send = async (message: SendRoomMessage): Promise<void> => {
    if (!room) return
    await roomsClient.send(room.id, message)
    await Promise.all([state.refresh(), topicState.refresh()])
  }
  const openCode = (): void => {
    useChatStore.getState().setRoute('chat')
  }
  const openWork = (): void => {
    void useChatStore.getState().openWrite()
  }

  return (
    <div
      data-rooms-workspace
      data-chat-layout={presentation.layout}
      style={{ '--rooms-list-width': `${presentation.listWidth}px`, '--rooms-detail-width': `${presentation.detailWidth}px` } as CSSProperties}
      className="rooms-workspace ds-no-drag relative flex h-full min-h-0 min-w-0 flex-1 overflow-hidden bg-ds-main"
    >
      <aside
        className={`${sidebarOpen ? 'absolute inset-y-0 left-0 z-40 flex shadow-xl' : 'hidden'} rooms-sidebar shrink-0 flex-col border-r border-ds-border bg-ds-sidebar md:static md:flex md:shadow-none`}
      >
        <RoomPanelResizeHandle side="list" />
        <div
          aria-hidden
          className="ds-drag ds-sidebar-titlebar-spacer shrink-0 pb-2 pt-2"
        >
          <div className="ds-sidebar-titlebar-row min-h-[34px]">
            <div className="ds-titlebar-safe-block" />
          </div>
        </div>
        <div className="flex items-center justify-between px-3">
          <WorkspaceModeTabs
            activeView="rooms"
            onCodeOpen={openCode}
            onWriteOpen={openWork}
          />
          <button
            className="text-ds-muted md:hidden"
            onClick={() => setSidebarOpen(false)}
            aria-label={t('roomsClose')}
          >
            <X size={18} />
          </button>
        </div>
        <div className="rooms-sidebar-heading">
          <h2>{t('roomsConversations')}</h2>
          <button type="button" className="rooms-icon-button" onClick={() => setSettings('create')}
            aria-label={t('roomsNew')} title={t('roomsNew')}><Plus size={19} /></button>
          <RoomPopover label={t('roomsListOptions')} trigger={<MoreHorizontal size={18} />} className="rooms-icon-button" width={224} align="end">
            {(close) => <div className="rooms-menu-list">
              <button type="button" onClick={() => { close(); void state.refreshList() }}><RefreshCw size={15} />{t('roomsRefresh')}</button>
              <button type="button" onClick={() => { close(); state.setArchived(!state.archived); drawer.close() }}><Archive size={15} />{t(state.archived ? 'roomsActive' : 'roomsArchived')}</button>
            </div>}
          </RoomPopover>
        </div>
        <div className="rooms-list-search"><Search size={15} aria-hidden="true" />
          <input aria-label={t('roomsSearchRooms')} placeholder={t('roomsSearchRooms')}
            value={state.search} onChange={(event) => state.setSearch(event.target.value)} />
        </div>
        {state.archived ? <button className="rooms-archived-filter" onClick={() => state.setArchived(false)}>
          <Archive size={13} />{t('roomsArchived')}<X size={12} />
        </button> : null}
        <RoomListFilters filter={state.filter} archived={state.archived} repositoryRoot={state.repositoryRoot}
          onFilter={(value) => { state.setArchived(value === 'archived'); state.setFilter(value === 'archived' ? 'all' : value) }}
          onRepository={state.setRepositoryRoot} />
        {state.search.trim().length >= 2 ? <RoomUnifiedSearch query={state.search} repositoryRoot={state.repositoryRoot} includeArchived={state.archived}
          onSelect={(hit) => { chooseRoom(hit.roomId); state.setSearch(''); setSearchTarget(hit) }} /> : <RoomList
          rooms={state.rooms}
          selectedId={state.selectedId}
          select={chooseRoom}
          cursor={state.roomCursor}
          moreBusy={state.moreBusy}
          loadMore={state.loadMoreRooms}
        />}
      </aside>
      <section className="relative flex min-h-0 min-w-0 flex-1 flex-col">
        <RoomHeader room={room} busy={busy} searchOpen={searchOpen}
          onSidebar={() => setSidebarOpen(true)}
          onSearch={() => setSearchOpen((value) => !value)}
          onDetails={() => drawer.section('discussion')}
          onMembers={() => drawer.section('members')}
          onSettings={() => setSettings('edit')}
          onUpdate={(patch) => { if (room) void perform(async () => {
            const result = await roomsClient.update(room, patch)
            state.saved(result.room)
          }) }}
        />
        {state.error ? (
          <div
            role="alert"
            className="flex items-center gap-2 border-b border-ds-border p-3 text-sm text-red-500"
          >
            <span className="min-w-0 flex-1 break-words">{state.error}</span>
            <button
              className={roomButtonClass}
              onClick={() => {
                void state.refreshList()
                void state.refresh()
              }}
            >
              {t('roomsRefresh')}
            </button>
          </div>
        ) : null}
        {state.loading ? (
          <div className="grid flex-1 place-content-center text-sm text-ds-muted">
            {t('roomsLoading')}
          </div>
        ) : room ? (
          <>
            <RoomPeerSummary
              topics={topicState.topics}
              loading={topicState.loading}
              onOpen={() => drawer.section('discussion')}
              onTasks={() => drawer.section('tasks')}
              taskCounts={state.rooms.find((entry) => entry.id === room.id)}
            />
            <RoomTimeline
              key={room.id + '-timeline'}
              searchOpen={searchOpen}
              onSearchClose={() => setSearchOpen(false)}
              onMember={openMember}
              onRun={openRun}
              onReplyThread={(message) => drawer.open({ kind: 'reply', messageId: message.displayThreadRootId ?? message.id })}
              onOpenContent={openContent}
              room={room}
              messages={messages}
              tasks={state.tasks}
              cursor={state.messageCursor}
              moreBusy={state.moreBusy}
              loadEarlier={state.loadEarlier}
              onPin={pin}
              onTask={openTask}
              jumpMessageId={jumpMessageId}
              onJumped={() => setJumpMessageId(null)}
            />
            <RoomComposer
              key={room.id + '-composer'}
              room={room}
              tasks={state.tasks}
              topicChoices={topicState.topics.map((topic) => ({
                rootRequestId: topic.rootRequestId,
                title: topic.title
              }))}
              onSend={send}
            />
          </>
        ) : (
          <div className="flex flex-1 flex-col items-center justify-center gap-4 p-8 text-center text-ds-muted">
            <MessagesSquare size={36} />
            <p>{t('roomsEmpty')}</p>
            <button
              className={roomButtonClass}
              onClick={() => setSettings('create')}
            >
              {t('roomsNew')}
            </button>
          </div>
        )}
      </section>
      {room && drawer.frames.length ? <RoomDrawerNavigation key={room.id + '-details'} frames={drawer.frames}
        onBack={drawer.back} onClose={drawer.close} onSection={drawer.section}
        render={(target, key, active) => {
          if (target.kind === 'run') return <RoomRunInspector key={key} roomId={room.id} runId={target.runId} active={active} onOpenThread={onOpenThread} />
          if (target.kind === 'task') return <RoomDrawerTask key={key} roomId={room.id} taskId={target.taskId} tasks={state.tasks}
            onClose={drawer.back} onRun={openRun} onOpenThread={onOpenThread} onUpdated={() => void state.refresh()} />
          if (target.kind === 'reply') return <RoomReplyThread key={key} room={room} messageId={target.messageId} tasks={state.tasks} active={active}
            onSend={send} onPin={pin} onTask={openTask} onRun={openRun} onMember={openMember} onOpenContent={openContent} />
          if (target.kind === 'content') return <RoomContentPreview key={key} room={room} reference={target.reference} messageId={target.messageId}
            onOpenCode={onOpenThread} onOpenTarget={onOpenContentTarget ?? ((value) => openRoomContentTarget(value, onOpenThread))} />
          if (target.section === 'discussion') return <RoomPeerActivity room={room} {...topicState} onUpdated={topicState.refresh}
            onMember={openMember} onOpenRun={openRun} onContinue={(rootRequestId) => { continueRoomTopic(room.id, rootRequestId); drawer.close() }} />
          if (target.section === 'overview') return <><RoomRunSummary roomId={room.id} topics={topicState.topics} />
            <RoomOverview room={room} rules={state.rules} onUpdated={state.refresh}
              onTask={openTask} onMessage={(id) => { setJumpMessageId(id); drawer.close() }} /></>
          if (target.section === 'members') return <RoomMemberDetails room={room} selectedMemberId={target.memberId ?? null}
            rootRequestId={target.rootRequestId} topics={topicState.topics.map((topic) => ({ rootRequestId: topic.rootRequestId, title: topic.title }))}
            onSelectMember={(memberId) => drawer.open({ kind: 'section', section: 'members', memberId })} onRun={openRun} />
          return <RoomTaskStrip key={key} stacked room={room} tasks={state.tasks} selectedId={null} onTask={openTask}
            cursor={state.taskCursor} moreBusy={state.moreBusy} loadMore={state.loadMoreTasks} />
        }} /> : null}
      {settings ? (
        <RoomSettings
          key={`${settings}:${room?.id ?? 'new'}`}
          room={settings === 'edit' ? room : null}
          onClose={() => setSettings(null)}
          onSaved={(value) => {
            state.saved(value)
            setSettings(null)
          }}
        />
      ) : null}
    </div>
  )
}
