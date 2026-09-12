import { useEffect, useState, type ReactElement } from 'react'
import { useTranslation } from 'react-i18next'
import {
  Archive,
  Menu,
  MessagesSquare,
  Plus,
  RefreshCw,
  Settings,
  X
} from 'lucide-react'
import type { RoomMessage, RoomTask } from '@shared/rooms-api'
import { WorkspaceModeTabs } from '../chat/WorkspaceModeTabs'
import { useChatStore } from '../../store/chat-store'
import { RoomSettings, roomButtonClass } from './RoomSettings'
import { RoomComposer } from './RoomComposer'
import { RoomTaskPanel } from './RoomTaskPanel'
import { roomsClient } from './rooms-client'
import { useRooms } from './useRooms'
import './rooms.css'
import { RoomTimeline } from './RoomTimeline'
import { RoomTaskStrip } from './RoomTaskStrip'
import { RoomList } from './RoomList'
import { RoomOverview } from './RoomOverview'

export function RoomsWorkspaceView({
  onOpenThread
}: {
  onOpenThread: (id: string) => void
}): ReactElement {
  const { t } = useTranslation('common')
  const state = useRooms()
  const [settings, setSettings] = useState<'create' | 'edit' | null>(null)
  const [taskId, setTaskId] = useState<string | null>(null)
  const [historicalTask, setHistoricalTask] = useState<RoomTask | null>(null)
  const [sidebarOpen, setSidebarOpen] = useState(false)
  const [busy, setBusy] = useState(false)
  const [jumpMessageId, setJumpMessageId] = useState<string | null>(null)
  const { room, messages } = state
  const { selectedId, setError } = state
  const selectedTask =
    state.tasks.find((task) => task.id === taskId) ??
    (historicalTask?.id === taskId && historicalTask.roomId === state.selectedId
      ? historicalTask
      : null)

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
    setSidebarOpen(false)
    setJumpMessageId(null)
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
      className="ds-no-drag relative flex h-full min-h-0 min-w-0 flex-1 overflow-hidden bg-ds-main"
    >
      <aside
        className={`${sidebarOpen ? 'absolute inset-y-0 left-0 z-40 flex shadow-xl' : 'hidden'} w-[248px] shrink-0 flex-col border-r border-ds-border bg-ds-sidebar md:static md:flex md:shadow-none`}
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
        <div className="flex items-center gap-2 p-3">
          <button
            className={`${roomButtonClass} flex flex-1 items-center justify-center gap-2`}
            onClick={() => setSettings('create')}
          >
            <Plus size={15} />
            {t('roomsNew')}
          </button>
          <button
            className={roomButtonClass}
            onClick={() => void state.refreshList()}
            aria-label={t('roomsRefresh')}
          >
            <RefreshCw size={14} />
          </button>
        </div>
        <input
          aria-label={t('roomsSearchRooms')}
          placeholder={t('roomsSearchRooms')}
          className="mx-3 mb-2 rounded border border-ds-border bg-transparent p-2 text-sm"
          value={state.search}
          onChange={(event) => state.setSearch(event.target.value)}
        />
        <button
          className="mx-3 mb-2 rounded-lg px-2 py-1 text-left text-xs text-ds-muted hover:bg-ds-hover"
          onClick={() => {
            state.setArchived(!state.archived)
            setTaskId(null)
          }}
        >
          <Archive size={13} className="mr-2 inline" />
          {t(state.archived ? 'roomsActive' : 'roomsArchived')}
        </button>
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
        <header className="rooms-main-titlebar flex min-h-16 shrink-0 items-center gap-3 border-b border-ds-border px-4 py-3">
          <button
            className={`${roomButtonClass} md:hidden`}
            onClick={() => setSidebarOpen(true)}
            aria-label={t('roomsLabel')}
          >
            <Menu size={18} />
          </button>
          <div className="min-w-0 flex-1">
            <h1 className="truncate font-semibold text-ds-ink">
              {room?.name ?? t('roomsLabel')}
            </h1>
            {room ? (
              <p className="truncate text-xs text-ds-muted">
                {room.members
                  .filter((member) => member.enabled && !member.removedAt)
                  .map((member) => member.displayName)
                  .join(' · ')}
              </p>
            ) : null}
          </div>
          {room ? (
            <>
              <button
                className={roomButtonClass}
                disabled={busy}
                onClick={() =>
                  void perform(async () => {
                    const result = await roomsClient.update(room, {
                      collaborationMode:
                        room.collaborationMode === 'autonomous'
                          ? 'directed'
                          : 'autonomous'
                    })
                    state.saved(result.room)
                  })
                }
                title={t('roomsMode')}
              >
                {t(
                  room.collaborationMode === 'autonomous'
                    ? 'roomsAutonomous'
                    : 'roomsDirected'
                )}
              </button>
              <button
                className={roomButtonClass}
                onClick={() => setSettings('edit')}
                aria-label={t('roomsSettings')}
              >
                <Settings size={16} />
              </button>
            </>
          ) : null}
        </header>
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
            <div className="flex shrink-0 flex-wrap gap-2 border-b border-ds-border px-4 py-2">
              <button
                disabled={busy}
                className="text-xs text-ds-muted hover:text-ds-ink"
                onClick={() =>
                  void perform(async () => {
                    const result = await roomsClient.update(room, {
                      pinned: !room.pinned
                    })
                    state.saved(result.room)
                  })
                }
              >
                {t(room.pinned ? 'roomsUnpin' : 'roomsPin')}
              </button>
              <button
                disabled={busy}
                className="text-xs text-ds-muted hover:text-ds-ink"
                onClick={() =>
                  void perform(async () => {
                    const result = await roomsClient.update(room, {
                      archived: !room.archivedAt
                    })
                    state.saved(result.room)
                  })
                }
              >
                {t(room.archivedAt ? 'roomsRestore' : 'roomsArchive')}
              </button>
            </div>
            <RoomOverview
              room={room}
              rules={state.rules}
              onUpdated={state.refresh}
              onTask={setTaskId}
              onMessage={setJumpMessageId}
            />
            <RoomTimeline
              key={room.id + '-timeline'}
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
            <RoomTaskStrip
              key={room.id + '-tasks'}
              room={room}
              tasks={state.tasks}
              selectedId={taskId}
              onTask={setTaskId}
              cursor={state.taskCursor}
              moreBusy={state.moreBusy}
              loadMore={state.loadMoreTasks}
            />
            <RoomComposer
              key={room.id + '-composer'}
              room={room}
              tasks={state.tasks}
              onSend={async (message) => {
                await roomsClient.send(room.id, message)
                await state.refresh()
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
      {selectedTask ? (
        <RoomTaskPanel
          key={selectedTask.id}
          task={selectedTask}
          onClose={() => setTaskId(null)}
          onOpenThread={onOpenThread}
          onUpdated={() => void state.refresh()}
        />
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
