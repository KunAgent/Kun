import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type RefObject } from 'react'
import { ArrowDown, Lock, PanelRightOpen, RefreshCw } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import type { RoomRunListPage, RoomRunRecord } from '@shared/rooms-api'
import { sessionRuns } from './room-agent-session-runs'
import { RoomMessageBody } from './RoomMessageBody'
import { presentRoomRunItems } from './room-run-presentation'
import { useRoomRun } from './useRoomRun'
import { roomPath, roomsRequest } from './rooms-client'
import { formatDuration } from '../chat/message-timeline-tools'
import { TimelineFilePreviewWorkspaceProvider } from '../chat/timeline-file-preview-workspace'
import { ConversationTurn } from '../chat/MessageTimeline'
import { groupTurns, stableTurnKey } from '../chat/message-timeline-turns'
import { chatBlockFromItem } from '../../agent/kun-mapper-events'
import type { ChatBlock } from '../../agent/types'
import './rooms-runs.css'

const PAGE_SIZE = 10
const LIVE_STATUSES = new Set(['queued', 'running', 'recovery_required'])

export function RoomAgentSession({ roomId, active = true, refreshKey, onOpenRun }: {
  roomId: string; active?: boolean; refreshKey?: string; onOpenRun?: (runId: string) => void
}) {
  const { t } = useTranslation('common')
  const [runs, setRuns] = useState<RoomRunRecord[]>([])
  const [cursor, setCursor] = useState<string>()
  const [loading, setLoading] = useState(true)
  const [moreBusy, setMoreBusy] = useState(false)
  const [error, setError] = useState('')
  const scroll = useRef<HTMLDivElement>(null)
  const content = useRef<HTMLDivElement>(null)
  const atBottom = useRef(true)
  const anchor = useRef<{ height: number; top: number } | null>(null)
  const [away, setAway] = useState(false)
  const base = `${roomPath(roomId)}/runs?phase=conversation&limit=${PAGE_SIZE}`

  const load = useCallback(async (signal?: AbortSignal) => {
    try {
      const page = await roomsRequest<RoomRunListPage>(base, 'GET', undefined, signal)
      if (signal?.aborted) return
      // Keep older pages already loaded; the newest page replaces their overlap.
      setRuns((current) => [...current.filter((run) => !page.runs.some((next) => next.id === run.id)), ...page.runs])
      setCursor((current) => current ?? page.nextCursor)
      setError('')
    } catch (cause) {
      if (!signal?.aborted) setError(String(cause))
    } finally {
      if (!signal?.aborted) setLoading(false)
    }
  }, [base])

  useEffect(() => {
    setRuns([]); setCursor(undefined); setLoading(true); setError('')
    atBottom.current = true
  }, [roomId])
  useEffect(() => {
    if (!active) return
    const controller = new AbortController()
    void load(controller.signal)
    return () => controller.abort()
  }, [active, load, refreshKey])

  const loadEarlier = async () => {
    if (!cursor || moreBusy) return
    setMoreBusy(true)
    if (scroll.current) anchor.current = { height: scroll.current.scrollHeight, top: scroll.current.scrollTop }
    try {
      const page = await roomsRequest<RoomRunListPage>(`${base}&cursor=${encodeURIComponent(cursor)}`)
      setRuns((current) => [...current, ...page.runs.filter((run) => !current.some((old) => old.id === run.id))])
      setCursor(page.nextCursor)
    } catch (cause) {
      anchor.current = null
      setError(String(cause))
    } finally {
      setMoreBusy(false)
    }
  }

  // Keep the reader pinned to the newest output, or keep their place when older turns load above.
  useLayoutEffect(() => {
    const viewport = scroll.current
    const body = content.current
    if (!viewport || !body || typeof ResizeObserver === 'undefined') return
    const observer = new ResizeObserver(() => {
      if (anchor.current) {
        viewport.scrollTop = anchor.current.top + viewport.scrollHeight - anchor.current.height
        anchor.current = null
      } else if (atBottom.current) viewport.scrollTop = viewport.scrollHeight
    })
    observer.observe(body)
    return () => observer.disconnect()
  }, [])

  const ordered = useMemo(() => sessionRuns(runs), [runs])
  return <section className="rooms-run-inspector rooms-agent-session" aria-label={t('roomsAgentSession')}>
    <div ref={scroll} className="rooms-run-scroll" onScroll={(event) => {
      const target = event.currentTarget
      atBottom.current = target.scrollHeight - target.scrollTop - target.clientHeight < 80
      setAway(!atBottom.current)
    }}>
      <div ref={content} className="rooms-agent-session-content">
        {cursor ? <button type="button" className="rooms-run-secondary rooms-agent-session-earlier" disabled={moreBusy}
          onClick={() => void loadEarlier()}>{t(moreBusy ? 'roomsLoading' : 'roomsAgentSessionEarlier')}</button> : null}
        {loading && !runs.length ? <p className="rooms-run-note">{t('roomsLoading')}</p> : null}
        {!loading && !error && !ordered.length ? <p className="rooms-run-note">{t('roomsAgentSessionEmpty')}</p> : null}
        {ordered.map((run, index) => <RoomAgentSessionRun key={run.id} roomId={roomId} run={run} active={active}
          newContext={index > 0 && Boolean(run.threadId && ordered[index - 1].threadId && run.threadId !== ordered[index - 1].threadId)}
          viewportRef={scroll} onOpenRun={onOpenRun} />)}
        {error ? <>
          <p role="alert" className="rooms-run-error">{error}</p>
          <button type="button" className="rooms-run-secondary" onClick={() => void load()}><RefreshCw size={13} />{t('roomsRefresh')}</button>
        </> : null}
      </div>
    </div>
    {away && ordered.length ? <button type="button" className="rooms-run-latest rooms-run-secondary" onClick={() => {
      if (scroll.current) scroll.current.scrollTop = scroll.current.scrollHeight
      atBottom.current = true
      setAway(false)
    }}><ArrowDown size={13} />{t('roomsRunScrollToBottom')}</button> : null}
    <footer className="rooms-run-readonly-footer"><Lock size={13} strokeWidth={1.9} /><span>{t('roomsRunReadOnlyFooter')}</span></footer>
  </section>
}

function RoomAgentSessionRun({ roomId, run: listed, active, newContext, viewportRef, onOpenRun }: {
  roomId: string; run: RoomRunRecord; active: boolean; newContext: boolean
  viewportRef: RefObject<HTMLDivElement | null>; onOpenRun?: (runId: string) => void
}) {
  const { t } = useTranslation('common')
  // Only an unfinished run keeps a live stream; settled runs load once.
  const state = useRoomRun(roomId, listed.id, active && LIVE_STATUSES.has(listed.status))
  const run = state.detail?.run ?? listed
  const processing = LIVE_STATUSES.has(run.status)
  const blocks = useMemo(() => presentRoomRunItems(state.items).flatMap((item): ChatBlock[] => {
    const block = chatBlockFromItem(item)
    return block ? [block] : []
  }), [state.items])
  const turns = useMemo(() => groupTurns(blocks), [blocks])
  const hasUserBubble = turns.some((turn) => turn.user)
  const time = new Date(run.createdAt)
  return <TimelineFilePreviewWorkspaceProvider workspaceRoot={state.detail?.workspaceRoot ?? ''} threadId={run.threadId}>
    <article className="rooms-agent-session-run" data-run-id={run.id}>
      {newContext ? <p className="rooms-agent-session-context">{t('roomsAgentSessionNewContext')}</p> : null}
      <header className="rooms-agent-session-meta">
        {processing ? <span className="rooms-run-status-dot is-running" /> : null}
        <time dateTime={run.createdAt}>{Number.isNaN(time.getTime()) ? '' : time.toLocaleString([], { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' })}</time>
        <span className={processing ? 'is-running' : ''}>{t(`roomsRunStatus_${run.status}`, { defaultValue: run.status })}</span>
        {run.model ? <span className="rooms-run-model">{run.model}</span> : null}
        {run.elapsedMs !== undefined ? <span>{formatDuration(run.elapsedMs)}</span> : null}
        {onOpenRun ? <button type="button" className="rooms-agent-session-open" title={t('roomsAgentSessionOpenRun')}
          aria-label={t('roomsAgentSessionOpenRun')} onClick={() => onOpenRun(run.id)}><PanelRightOpen size={12} aria-hidden="true" /></button> : null}
      </header>
      {run.input && !hasUserBubble ? <div className="rooms-run-user-bubble">
        <RoomMessageBody body={run.input} attachmentIds={run.attachmentIds} />
      </div> : null}
      {state.hasEarlier ? <button type="button" className="rooms-run-secondary" disabled={state.moreBusy}
        onClick={() => void state.loadEarlier()}>{t(state.moreBusy ? 'roomsLoading' : state.hasGap ? 'roomsRunLoadGap' : 'roomsRunEarlier')}</button> : null}
      <div className="rooms-run-turns">
        {turns.map((turn, index) => <ConversationTurn key={stableTurnKey(turn, index)} turn={turn}
          isProcessing={processing && index === turns.length - 1} liveReasoning="" live=""
          durationMs={index === turns.length - 1 ? run.elapsedMs : undefined} threadId={run.threadId}
          filePreviewWorkspaceRoot={state.detail?.workspaceRoot ?? ''} viewportRef={viewportRef}
          compactCards allowMainThreadActions={false} allowRecoveryContinue={false} />)}
      </div>
      {run.error ? <p role="alert" className="rooms-run-error">{run.error}</p> : null}
      {state.error || state.streamError ? <p role="alert" className="rooms-run-error">{state.error || state.streamError}</p> : null}
    </article>
  </TimelineFilePreviewWorkspaceProvider>
}
