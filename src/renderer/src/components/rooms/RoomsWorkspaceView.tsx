import {
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type ReactElement
} from 'react'
import { useTranslation } from 'react-i18next'
import {
  Archive,
  Menu,
  MessagesSquare,
  Pin,
  Plus,
  RefreshCw,
  Settings,
  X
} from 'lucide-react'
import type { RoomMessage, RoomTask } from '@shared/rooms-api'
import { WorkspaceModeTabs } from '../chat/WorkspaceModeTabs'
import { useChatStore } from '../../store/chat-store'
import {
  readBrowserStorageItem,
  writeBrowserStorageItem
} from '../../lib/browser-storage'
import { RoomSettings, roomButtonClass } from './RoomSettings'
import { RoomComposer } from './RoomComposer'
import { RoomTaskPanel } from './RoomTaskPanel'
import { roomsClient } from './rooms-client'
import { useRooms } from './useRooms'
import './rooms.css'

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
  const scrollRef = useRef<HTMLDivElement>(null)
  const scrollRoomRef = useRef('')
  const stayAtBottomRef = useRef(true)
  const previousHeightRef = useRef<number | null>(null)
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

  useLayoutEffect(() => {
    const element = scrollRef.current
    if (!element || state.loading || !room) return
    if (scrollRoomRef.current !== room.id) {
      scrollRoomRef.current = room.id
      const stored = readBrowserStorageItem(`kun.rooms.scroll.${room.id}`)
      element.scrollTop =
        stored === null ? element.scrollHeight : Number(stored) || 0
      stayAtBottomRef.current =
        element.scrollHeight - element.scrollTop - element.clientHeight < 80
    } else if (previousHeightRef.current !== null) {
      element.scrollTop += element.scrollHeight - previousHeightRef.current
      previousHeightRef.current = null
    } else if (stayAtBottomRef.current) {
      element.scrollTop = element.scrollHeight
    }
    const seq = messages.at(-1)?.messageSeq
    if (seq && stayAtBottomRef.current)
      writeBrowserStorageItem(`kun.rooms.read.${room.id}`, String(seq))
  }, [messages, room, state.loading])

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
    scrollRoomRef.current = ''
    previousHeightRef.current = null
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
        <div aria-hidden className="ds-drag ds-sidebar-titlebar-spacer shrink-0 pb-2 pt-2">
          <div className="ds-sidebar-titlebar-row min-h-[34px]"><div className="ds-titlebar-safe-block" /></div>
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
        <nav
          aria-label={t('roomsLabel')}
          className="min-h-0 flex-1 space-y-1 overflow-y-auto px-2 pb-3"
        >
          {state.rooms.map((item) => (
            <button
              key={item.id}
              onClick={() => chooseRoom(item.id)}
              className={`flex w-full items-start gap-2 rounded-lg px-3 py-3 text-left ${state.selectedId === item.id ? 'bg-accent/10' : 'hover:bg-ds-hover'}`}
              aria-current={state.selectedId === item.id ? 'page' : undefined}
            >
              <MessagesSquare
                size={16}
                className="mt-0.5 shrink-0 text-ds-muted"
              />
              <span className="min-w-0 flex-1">
                <span className="block truncate text-sm font-medium text-ds-ink">
                  {item.name}
                </span>
                <span className="mt-1 block truncate text-xs text-ds-faint">
                  {item.description ||
                    item.members.map((member) => member.displayName).join(', ')}
                </span>
              </span>
              {item.pinned ? (
                <Pin size={12} className="mt-1 shrink-0 text-ds-muted" />
              ) : null}
              {(item.latestMessageSeq ?? 0) >
                Number(
                  readBrowserStorageItem(`kun.rooms.read.${item.id}`) ?? 0
                ) && item.id !== room?.id ? (
                <span
                  aria-label={t('roomsUnread')}
                  title={t('roomsUnread')}
                  className="mt-2 h-2 w-2 shrink-0 rounded-full bg-accent"
                />
              ) : null}
            </button>
          ))}
          {state.roomCursor ? (
            <button
              className={`${roomButtonClass} w-full`}
              disabled={state.moreBusy}
              onClick={() => void state.loadMoreRooms()}
            >
              {t('roomsMore')}
            </button>
          ) : null}
        </nav>
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
              <details className="ml-auto max-w-full text-xs text-ds-muted">
                <summary className="cursor-pointer">
                  {t('roomsRules')} ({state.rules.length})
                </summary>
                <div className="space-y-2 py-2">
                  {state.rules.map((rule) => (
                    <p
                      key={rule.id}
                      className="whitespace-pre-wrap break-words"
                    >
                      v{rule.version} · {rule.body}
                    </p>
                  ))}
                </div>
              </details>
            </div>
            <div
              ref={scrollRef}
              className="min-h-0 flex-1 space-y-5 overflow-y-auto p-4 md:px-7"
              onScroll={(event) => {
                const element = event.currentTarget
                stayAtBottomRef.current =
                  element.scrollHeight -
                    element.scrollTop -
                    element.clientHeight <
                  80
                writeBrowserStorageItem(
                  `kun.rooms.scroll.${room.id}`,
                  String(element.scrollTop)
                )
                if (stayAtBottomRef.current && messages.at(-1))
                  writeBrowserStorageItem(
                    `kun.rooms.read.${room.id}`,
                    String(messages.at(-1)!.messageSeq)
                  )
              }}
            >
              {state.messageCursor ? (
                <div className="text-center">
                  <button
                    className={roomButtonClass}
                    disabled={state.moreBusy}
                    onClick={() => {
                      previousHeightRef.current =
                        scrollRef.current?.scrollHeight ?? null
                      void state.loadEarlier()
                    }}
                  >
                    {t(state.moreBusy ? 'roomsLoading' : 'roomsOlder')}
                  </button>
                </div>
              ) : null}
              {!messages.length ? (
                <p className="mx-auto max-w-md py-12 text-center text-sm leading-6 text-ds-muted">
                  {t('roomsNoMessages')}
                </p>
              ) : null}
              {messages.map((message) => (
                <article
                  key={message.id}
                  className={`group mx-auto max-w-3xl rounded-xl p-4 ${message.authorKind === 'user' ? 'bg-accent/5' : 'border border-ds-border'}`}
                >
                  <div className="mb-2 flex items-center gap-2 text-xs text-ds-muted">
                    <strong className="min-w-0 truncate text-sm text-ds-ink">
                      {message.authorLabelSnapshot}
                    </strong>
                    <time
                      dateTime={message.createdAt}
                      className="ml-auto whitespace-nowrap"
                    >
                      {new Date(message.createdAt).toLocaleTimeString([], {
                        hour: '2-digit',
                        minute: '2-digit'
                      })}
                    </time>
                    <button
                      disabled={busy}
                      onClick={() => pin(message)}
                      className="shrink-0 rounded p-1 hover:bg-ds-hover"
                      title={t('roomsPinMessage')}
                      aria-label={t('roomsPinMessage')}
                    >
                      <Pin size={12} />
                    </button>
                  </div>
                  <p className="whitespace-pre-wrap break-words text-sm leading-7 text-ds-ink">
                    {message.body}
                  </p>
                  {message.attachmentIds.length ? (
                    <p className="mt-2 text-xs text-ds-muted">
                      {t('roomsAttach')} · {message.attachmentIds.length}
                    </p>
                  ) : null}
                  {message.taskId ? (
                    <button
                      className="mt-2 text-xs text-accent"
                      onClick={() => setTaskId(message.taskId!)}
                    >
                      {state.tasks.find((task) => task.id === message.taskId)
                        ?.title ?? t('roomsDetails')}
                    </button>
                  ) : null}
                </article>
              ))}
            </div>
            {state.tasks.length ? (
              <div
                className="flex max-h-28 shrink-0 gap-2 overflow-auto border-t border-ds-border p-3"
                aria-label={t('roomsTasks')}
              >
                {state.tasks.map((task) => (
                  <button
                    key={task.id}
                    onClick={() => setTaskId(task.id)}
                    className={`w-56 shrink-0 rounded-lg border p-3 text-left ${taskId === task.id ? 'border-accent bg-accent/5' : 'border-ds-border hover:bg-ds-hover'}`}
                  >
                    <span className="block truncate text-sm font-medium text-ds-ink">
                      {task.title}
                    </span>
                    <span className="mt-1 block truncate text-xs text-ds-muted">
                      {task.memberSnapshot.displayName} ·{' '}
                      {t(`roomsState_${task.status}`)}
                    </span>
                  </button>
                ))}
                {state.taskCursor ? (
                  <button
                    disabled={state.moreBusy}
                    className={`${roomButtonClass} shrink-0`}
                    onClick={() => void state.loadMoreTasks()}
                  >
                    {t('roomsMoreTasks')}
                  </button>
                ) : null}
              </div>
            ) : null}
            <RoomComposer
              key={room.id}
              room={room}
              tasks={state.tasks}
              onSend={async (message) => {
                await roomsClient.send(room.id, message)
                stayAtBottomRef.current = true
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
