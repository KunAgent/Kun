import { useEffect, useRef, useState, type ReactElement } from 'react'
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
import type { RoomMessage, RoomTask } from '@shared/rooms-api'
import { WorkspaceModeTabs } from '../chat/WorkspaceModeTabs'
import { useChatStore } from '../../store/chat-store'
import { RoomSettings, roomButtonClass } from './RoomSettings'
import { RoomComposer } from './RoomComposer'
import { RoomHeader } from './RoomHeader'
import { RoomMemberDetails } from './RoomMemberDetails'
import { RoomPopover } from './RoomPopover'
import { RoomTaskPanel } from './RoomTaskPanel'
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
import { RoomDetailsDrawer, type RoomDetailsSection } from './RoomDetailsDrawer'
import { RoomRunInspector } from './RoomRunInspector'

export function RoomsWorkspaceView({
  onOpenThread
}: {
  onOpenThread: (id: string, turnId?: string) => void | Promise<void>
}): ReactElement {
  const { t } = useTranslation('common')
  const state = useRooms()
  const [settings, setSettings] = useState<'create' | 'edit' | null>(null)
  const [taskId, setTaskId] = useState<string | null>(null)
  const [historicalTask, setHistoricalTask] = useState<RoomTask | null>(null)
  const [sidebarOpen, setSidebarOpen] = useState(false)
  const [busy, setBusy] = useState(false)
  const [searchOpen, setSearchOpen] = useState(false)
  const [selectedMemberId, setSelectedMemberId] = useState<string | null>(null)
  const [memberTopicId, setMemberTopicId] = useState<string | null>(null)
  const [runId, setRunId] = useState<string | null>(null)
  const runSourceFocus = useRef<HTMLElement | null>(null)
  const [details, setDetails] = useState<RoomDetailsSection | null>(null)
  const [jumpMessageId, setJumpMessageId] = useState<string | null>(null)
  const { room, messages } = state
  const { selectedId, setError } = state
  const topicState = useRoomTopics(selectedId)
  const selectedTask =
    state.tasks.find((task) => task.id === taskId) ??
    (historicalTask?.id === taskId && historicalTask.roomId === state.selectedId
      ? historicalTask
      : null)

  useEffect(() => {
    setTaskId(null)
    setHistoricalTask(null)
    setDetails(null)
    setSearchOpen(false)
    setSelectedMemberId(null)
    setMemberTopicId(null)
    setRunId(null)
  }, [selectedId])

  useEffect(() => {
    if (!taskId || !selectedId || selectedTask) return
    const controller = new AbortController()
    void roomsClient
      .task(selectedId, taskId, controller.signal)
      .then((result) => {
        if (!controller.signal.aborted) setHistoricalTask(result.task)
      })
      .catch((cause) => {
        if (!controller.signal.aborted)
          setError(cause instanceof Error ? cause.message : String(cause))
      })
    return () => controller.abort()
  }, [taskId, selectedId, selectedTask, setError])

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
    setTaskId(null)
    setDetails(null)
    setSidebarOpen(false)
    setJumpMessageId(null)
    setRunId(null)
  }
  const openRun = (id: string): void => {
    runSourceFocus.current = document.activeElement as HTMLElement | null
    if (!details && !taskId) setDetails('discussion')
    setRunId(id)
  }
  const backFromRun = (): void => {
    setRunId(null)
    requestAnimationFrame(() => { if (runSourceFocus.current?.isConnected) runSourceFocus.current.focus() })
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
      className="rooms-workspace ds-no-drag relative flex h-full min-h-0 min-w-0 flex-1 overflow-hidden bg-ds-main"
    >
      <aside
        className={`${sidebarOpen ? 'absolute inset-y-0 left-0 z-40 flex shadow-xl' : 'hidden'} rooms-sidebar shrink-0 flex-col border-r border-ds-border bg-ds-sidebar md:static md:flex md:shadow-none`}
      >
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
              <button type="button" onClick={() => { close(); state.setArchived(!state.archived); setTaskId(null) }}><Archive size={15} />{t(state.archived ? 'roomsActive' : 'roomsArchived')}</button>
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
        <RoomList
          rooms={state.rooms}
          selectedId={state.selectedId}
          select={chooseRoom}
          cursor={state.roomCursor}
          moreBusy={state.moreBusy}
          loadMore={state.loadMoreRooms}
        />
      </aside>
      <section className="relative flex min-h-0 min-w-0 flex-1 flex-col">
        <RoomHeader room={room} busy={busy} searchOpen={searchOpen}
          onSidebar={() => setSidebarOpen(true)}
          onSearch={() => setSearchOpen((value) => !value)}
          onDetails={() => setDetails('discussion')}
          onMembers={() => { setSelectedMemberId(null); setDetails('members') }}
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
              onOpen={() => setDetails('discussion')}
              onTasks={() => setDetails('tasks')}
              taskCounts={state.rooms.find((entry) => entry.id === room.id)}
            />
            <RoomTimeline
              key={room.id + '-timeline'}
              searchOpen={searchOpen}
              onSearchClose={() => setSearchOpen(false)}
              onMember={(id, topicId) => { setSelectedMemberId(id); setMemberTopicId(topicId ?? null); setRunId(null); setDetails('members') }}
              onRun={openRun}
              room={room}
              messages={messages}
              tasks={state.tasks}
              cursor={state.messageCursor}
              moreBusy={state.moreBusy}
              loadEarlier={state.loadEarlier}
              onPin={pin}
              onTask={setTaskId}
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
              onSend={async (message) => {
                await roomsClient.send(room.id, message)
                await Promise.all([state.refresh(), topicState.refresh()])
              }}
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
      {room && (details || taskId || runId) ? (
        <RoomDetailsDrawer
          key={room.id + '-details'}
          section={details ?? 'tasks'}
          onSection={(value) => {
            setTaskId(null)
            setRunId(null)
            setDetails(value)
          }}
          onClose={() => {
            setTaskId(null)
            setRunId(null)
            setDetails(null)
          }}
          taskOpen={Boolean(taskId)}
          runOpen={Boolean(runId)}
          onBack={() => {
            if (runId) { backFromRun(); return }
            setTaskId(null)
            setDetails('tasks')
          }}
        >
          <div className={`rooms-run-drawer-parent${taskId ? ' is-task' : ''}`} aria-hidden={runId ? true : undefined} inert={runId ? true : undefined} style={runId ? { position: 'absolute', inset: 0, visibility: 'hidden', pointerEvents: 'none' } : undefined}>
          {taskId ? (
            selectedTask ? (
              <RoomTaskPanel
                key={selectedTask.id}
                embedded
                task={selectedTask}
                onClose={() => {
                  setTaskId(null)
                  setDetails('tasks')
                }}
                onOpenThread={onOpenThread}
                onRun={openRun}
                onUpdated={() => void state.refresh()}
              />
            ) : (
              <p className="p-4 text-sm text-ds-muted">{t('roomsLoading')}</p>
            )
          ) : details === 'discussion' ? (
            <RoomPeerActivity
              room={room}
              {...topicState}
              onUpdated={topicState.refresh}
              onMember={(id, topicId) => { setSelectedMemberId(id); setMemberTopicId(topicId); setDetails('members') }}
              onOpenRun={openRun}
              onContinue={(rootRequestId) => {
                continueRoomTopic(room.id, rootRequestId)
                setDetails(null)
              }}
            />
          ) : details === 'overview' ? (
            <RoomOverview
              room={room}
              rules={state.rules}
              onUpdated={state.refresh}
              onTask={setTaskId}
              onMessage={(id) => {
                setJumpMessageId(id)
                setDetails(null)
              }}
            />
          ) : details === 'members' ? (
            <RoomMemberDetails room={room} selectedMemberId={selectedMemberId} rootRequestId={memberTopicId}
              topics={topicState.topics.map((topic) => ({ rootRequestId: topic.rootRequestId, title: topic.title }))}
              onSelectMember={(id) => { setSelectedMemberId(id); setMemberTopicId(null) }} onRun={openRun} />
          ) : (
            <RoomTaskStrip
              key={room.id + '-tasks'}
              stacked
              room={room}
              tasks={state.tasks}
              selectedId={taskId}
              onTask={setTaskId}
              cursor={state.taskCursor}
              moreBusy={state.moreBusy}
              loadMore={state.loadMoreTasks}
            />
          )}
          </div>
          {runId ? <RoomRunInspector key={room.id + ':' + runId} roomId={room.id} runId={runId} onOpenThread={onOpenThread} /> : null}
        </RoomDetailsDrawer>
      ) : null}
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
