import { useEffect, useRef, useState } from 'react'
import { ChevronRight, RefreshCw } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import type { RoomRunRecord } from '@shared/rooms-api'
import { roomPath, roomsRequest } from './rooms-client'
import { subscribeRoomEvents } from './useRoomEvents'
import './rooms-runs.css'

export function RoomRunList({
  roomId,
  memberId,
  rootRequestId,
  taskId,
  onOpenRun
}: {
  roomId: string
  memberId?: string
  rootRequestId?: string
  taskId?: string
  onOpenRun: (id: string) => void
}) {
  const { t } = useTranslation('common')
  const [runs, setRuns] = useState<RoomRunRecord[]>([])
  const [cursor, setCursor] = useState<string>()
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [revision, setRevision] = useState(0)
  const [phase, setPhase] = useState(''), [status, setStatus] = useState('')
  const [searchInput, setSearchInput] = useState(''), [search, setSearch] = useState('')
  useEffect(() => { const timer = setTimeout(() => setSearch(searchInput.trim()), 200); return () => clearTimeout(timer) }, [searchInput])
  const request = useRef<AbortController | null>(null)
  const loadedPath = useRef('')
  const filters = new URLSearchParams({ limit: '30' })
  if (memberId) filters.set('member_id', memberId)
  if (rootRequestId) filters.set('root_request_id', rootRequestId)
  if (taskId) filters.set('task_id', taskId)
  if (phase) filters.set('phase', phase)
  if (status) filters.set('status', status)
  if (search) filters.set('search', search)
  const path = `${roomPath(roomId)}/runs?${filters}`
  useEffect(() => {
    const controller = new AbortController()
    request.current?.abort()
    request.current = controller
    setBusy(true)
    setError('')
    const changed = loadedPath.current !== path
    if (changed) {
      setRuns([])
      setCursor(undefined)
    }
    void roomsRequest<{ runs: RoomRunRecord[]; nextCursor?: string }>(
      path,
      'GET',
      undefined,
      controller.signal
    )
      .then((result) => {
        if (!controller.signal.aborted) {
          setRuns((current) =>
            changed || Boolean(phase || status || search)
              ? result.runs
              : [
                  ...new Map(
                    [...current, ...result.runs].map((run) => [run.id, run])
                  ).values()
                ].sort((a, b) => b.createdAt.localeCompare(a.createdAt))
          )
          if (changed || phase || status || search) setCursor(result.nextCursor)
          loadedPath.current = path
        }
      })
      .catch((cause) => {
        if (!controller.signal.aborted) setError(String(cause))
      })
      .finally(() => {
        if (!controller.signal.aborted) setBusy(false)
      })
    return () => controller.abort()
  }, [path, revision, phase, status, search])
  useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | undefined
    const off = subscribeRoomEvents((event) => {
      if (event.roomId !== roomId || event.kind !== 'room_run.updated') return
      clearTimeout(timer)
      timer = setTimeout(() => setRevision((value) => value + 1), 350)
    })
    return () => {
      clearTimeout(timer)
      off()
    }
  }, [roomId])
  useEffect(() => () => request.current?.abort(), [])
  const more = async () => {
    if (!cursor || busy) return
    const controller = new AbortController()
    request.current?.abort()
    request.current = controller
    setBusy(true)
    setError('')
    try {
      const result = await roomsRequest<{
        runs: RoomRunRecord[]
        nextCursor?: string
      }>(
        `${path}&cursor=${encodeURIComponent(cursor)}`,
        'GET',
        undefined,
        controller.signal
      )
      if (controller.signal.aborted) return
      setRuns((current) => [
        ...new Map(
          [...current, ...result.runs].map((run) => [run.id, run])
        ).values()
      ])
      setCursor(result.nextCursor)
    } catch (cause) {
      if (!controller.signal.aborted) setError(String(cause))
    } finally {
      if (!controller.signal.aborted) setBusy(false)
    }
  }
  return (
    <section className="rooms-run-list" aria-label={t('roomsRunHistory')}>
      <div className="rooms-run-list-heading">
        <h4>{t('roomsRunHistory')}</h4>
        <button
          type="button"
          className="rooms-icon-button"
          disabled={busy}
          aria-label={t('roomsRefresh')}
          onClick={() => setRevision((value) => value + 1)}
        >
          <RefreshCw size={14} />
        </button>
      </div>
      <div className="rooms-run-process-filters">
        <select aria-label={t('roomsRunPhaseFilter')} value={phase} onChange={(event) => setPhase(event.target.value)}>
          <option value="">{t('roomsRunAllPhases')}</option>
          {['coordination', 'discussion', 'execution', 'review', 'integration', 'triage', 'memory'].map((value) => <option key={value} value={value}>{t('roomsRunPhase_' + value)}</option>)}
        </select>
        <select aria-label={t('roomsRunStatusFilter')} value={status} onChange={(event) => setStatus(event.target.value)}>
          <option value="">{t('roomsRunAllStatuses')}</option>
          {['queued', 'running', 'completed', 'failed', 'cancelled', 'recovery_required'].map((value) => <option key={value} value={value}>{t('roomsRunStatus_' + value)}</option>)}
        </select>
      </div>
      <div className="rooms-run-process-filters"><input aria-label={t('roomsRunHistorySearch')} placeholder={t('roomsRunHistorySearch')}
        value={searchInput} onChange={(event) => setSearchInput(event.target.value)} /></div>
      {!runs.length && !error ? (
        <p className="rooms-run-note">
          {t(busy ? 'roomsLoading' : 'roomsRunNoHistory')}
        </p>
      ) : null}
      <ol>
        {runs.map((run) => (
          <li key={run.id}>
            <button
              type="button"
              className="rooms-run-list-entry"
              onClick={() => onOpenRun(run.id)}
            >
              <span>
                <strong>
                  {run.memberLabel} · {t(`roomsRunPhase_${run.phase}`)}
                </strong>
                <span>
                  {t(`roomsRunStatus_${run.status}`)}
                  {run.outcome
                    ? ` · ${t(`roomsRunOutcome_${run.outcome}`)}`
                    : ''}{' '}
                  · {t('roomsRunAttempt', { count: run.attempt })}
                </span>
                <time dateTime={run.createdAt}>
                  {new Date(run.createdAt).toLocaleString()}
                </time>
                {run.error || run.reason ? (
                  <span className={run.error ? 'rooms-run-error' : ''}>
                    {run.error || run.reason}
                  </span>
                ) : null}
              </span>
              <ChevronRight size={14} />
            </button>
          </li>
        ))}
      </ol>
      {error ? (
        <p role="alert" className="rooms-run-error">
          {error}
        </p>
      ) : null}
      {cursor ? (
        <button
          type="button"
          className="rooms-run-secondary"
          disabled={busy}
          onClick={() => void more()}
        >
          {t(busy ? 'roomsLoading' : 'roomsLoadMore')}
        </button>
      ) : null}
    </section>
  )
}
