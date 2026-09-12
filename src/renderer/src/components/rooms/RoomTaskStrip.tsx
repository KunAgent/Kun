import { useEffect, useRef, useState } from 'react'
import { useVirtualizer } from '@tanstack/react-virtual'
import { useTranslation } from 'react-i18next'
import type { Room, RoomTask } from '@shared/rooms-api'
import { roomButtonClass } from './RoomSettings'
import { roomsClient } from './rooms-client'
import { subscribeRoomEvents } from './useRoomEvents'

export function RoomTaskStrip({
  room,
  tasks,
  selectedId,
  onTask,
  cursor,
  loadMore,
  moreBusy,
  stacked = false
}: {
  room: Room
  tasks: RoomTask[]
  selectedId: string | null
  onTask: (id: string) => void
  cursor: string | null
  loadMore: () => Promise<void>
  moreBusy: boolean
  stacked?: boolean
}) {
  const { t } = useTranslation('common')
  const [status, setStatus] = useState('')
  const [memberId, setMemberId] = useState('')
  const [repositoryId, setRepositoryId] = useState('')
  const [filtered, setFiltered] = useState<RoomTask[]>([])
  const [next, setNext] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const signature = JSON.stringify([room.id, status, memberId, repositoryId])
  const signatureRef = useRef(signature)
  signatureRef.current = signature
  const filterActive = Boolean(status || memberId || repositoryId)
  const scrollRef = useRef<HTMLDivElement>(null)
  const rows = filterActive ? filtered : tasks
  const virtualizer = useVirtualizer({
    count: rows.length,
    getScrollElement: () => scrollRef.current,
    horizontal: !stacked,
    estimateSize: () => (stacked ? 90 : 232),
    overscan: 3
  })
  const virtual = rows.length > 30
  const visible = virtual
    ? virtualizer.getVirtualItems()
    : rows.map((task, index) => ({ key: task.id, index, start: 0 }))
  useEffect(() => {
    if (!filterActive) return
    const controller = new AbortController()
    let refreshVersion = 0
    const refresh = async () => {
      const version = ++refreshVersion
      setBusy(true)
      try {
        const result = await roomsClient.tasks(
          room.id,
          controller.signal,
          undefined,
          { status, memberId, repositoryId }
        )
        if (!controller.signal.aborted && version === refreshVersion) {
          setFiltered(result.tasks)
          setNext(result.nextCursor ?? null)
          setError('')
        }
      } catch (cause) {
        if (!controller.signal.aborted) setError(String(cause))
      } finally {
        if (!controller.signal.aborted && version === refreshVersion)
          setBusy(false)
      }
    }
    void refresh()
    let timer: ReturnType<typeof setTimeout> | undefined
    const off = subscribeRoomEvents((event) => {
      if (event.roomId === room.id) {
        clearTimeout(timer)
        timer = setTimeout(() => void refresh(), 250)
      }
    })
    return () => {
      controller.abort()
      clearTimeout(timer)
      off()
    }
  }, [filterActive, status, memberId, repositoryId, room.id])
  const selectClass =
    'max-w-40 rounded border border-ds-border bg-ds-main p-1 text-xs text-ds-muted'
  return (
    <section
      className="shrink-0 border-t border-ds-border"
      aria-label={t('roomsTasks')}
    >
      <div className="flex flex-wrap items-center gap-2 px-3 pt-2">
        <span className="text-xs text-ds-muted">{t('roomsTasks')}</span>
        <select
          aria-label={t('roomsFilterStatus')}
          className={selectClass}
          value={status}
          onChange={(event) => setStatus(event.target.value)}
        >
          <option value="">{t('roomsAllStatuses')}</option>
          {[
            'queued',
            'waiting_dependency',
            'running',
            'needs_input',
            'needs_approval',
            'recovery_required',
            'stopping',
            'awaiting_acceptance',
            'completed',
            'failed',
            'cancelled'
          ].map((value) => (
            <option key={value} value={value}>
              {t(`roomsState_${value}`)}
            </option>
          ))}
        </select>
        <select
          aria-label={t('roomsFilterMember')}
          className={selectClass}
          value={memberId}
          onChange={(event) => setMemberId(event.target.value)}
        >
          <option value="">{t('roomsAllMembers')}</option>
          {room.members.map((member) => (
            <option key={member.id} value={member.id}>
              {member.displayName}
            </option>
          ))}
        </select>
        <select
          aria-label={t('roomsFilterRepository')}
          className={selectClass}
          value={repositoryId}
          onChange={(event) => setRepositoryId(event.target.value)}
        >
          <option value="">{t('roomsAllRepositories')}</option>
          {room.repositories.map((repository) => (
            <option key={repository.id} value={repository.id}>
              {repository.displayName}
            </option>
          ))}
        </select>
      </div>
      {error ? (
        <p role="alert" className="px-3 text-xs text-red-500">
          {error}
        </p>
      ) : null}
      <div
        ref={scrollRef}
        className={
          stacked
            ? 'max-h-[60vh] overflow-auto p-3'
            : 'flex max-h-28 gap-2 overflow-auto p-3'
        }
      >
        <div
          className={`relative flex gap-2 ${stacked ? 'flex-col' : ''}`}
          style={
            virtual
              ? stacked
                ? { height: virtualizer.getTotalSize() }
                : {
                    width: virtualizer.getTotalSize(),
                    height: 72,
                    flexShrink: 0
                  }
              : undefined
          }
        >
          {visible.map((row) => {
            const task = rows[row.index]
            return (
              <button
                key={task.id}
                onClick={() => onTask(task.id)}
                style={
                  virtual
                    ? {
                        position: 'absolute',
                        left: stacked ? 0 : row.start,
                        top: stacked ? row.start : 0,
                        width: stacked ? '100%' : 224
                      }
                    : undefined
                }
                className={`${stacked ? 'w-full' : 'w-56'} shrink-0 rounded-lg border p-3 text-left ${selectedId === task.id ? 'border-accent bg-accent/5' : 'border-ds-border hover:bg-ds-hover'}`}
              >
                <span className="block truncate text-sm font-medium text-ds-ink">
                  {task.title}
                </span>
                <span className="mt-1 block truncate text-xs text-ds-muted">
                  {task.memberSnapshot.displayName} ·{' '}
                  {t(`roomsState_${task.status}`)}
                </span>
              </button>
            )
          })}
        </div>
        {!rows.length ? (
          <p className="text-xs text-ds-muted">
            {t(busy ? 'roomsLoading' : 'roomsNoTasks')}
          </p>
        ) : null}
        {(filterActive ? next : cursor) ? (
          <button
            className={`${roomButtonClass} shrink-0`}
            disabled={busy || moreBusy}
            onClick={() => {
              if (!filterActive) {
                void loadMore()
                return
              }
              setBusy(true)
              void roomsClient
                .tasks(room.id, undefined, next ?? undefined, {
                  status,
                  memberId,
                  repositoryId
                })
                .then((page) => {
                  if (signatureRef.current !== signature) return
                  setFiltered((current) => [
                    ...new Map(
                      [...current, ...page.tasks].map((task) => [task.id, task])
                    ).values()
                  ])
                  setNext(page.nextCursor ?? null)
                })
                .catch((cause) => {
                  if (signatureRef.current === signature)
                    setError(String(cause))
                })
                .finally(() => {
                  if (signatureRef.current === signature) setBusy(false)
                })
            }}
          >
            {t('roomsMoreTasks')}
          </button>
        ) : null}
      </div>
    </section>
  )
}
