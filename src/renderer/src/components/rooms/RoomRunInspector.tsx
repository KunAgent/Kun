import { useLayoutEffect, useRef, useState } from 'react'
import { ArrowDown, ExternalLink, RefreshCw } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { RoomMessageBody } from './RoomMessageBody'
import { RoomRunItems } from './RoomRunItems'
import { useRoomRun } from './useRoomRun'
import './rooms-runs.css'

export function RoomRunInspector({
  roomId,
  runId,
  onOpenThread,
  active = true
}: {
  roomId: string
  runId: string
  onOpenThread: (threadId: string, turnId?: string) => void | Promise<void>
  active?: boolean
}) {
  const { t } = useTranslation('common')
  const state = useRoomRun(roomId, runId, active)
  const [navigationError, setNavigationError] = useState('')
  const [processFilter, setProcessFilter] = useState('all'), [processSearch, setProcessSearch] = useState('')
  const scroll = useRef<HTMLDivElement>(null)
  const anchor = useRef<{
    height: number
    top: number
    firstId?: string
  } | null>(null)
  const atBottom = useRef(false)
  const [away, setAway] = useState(false)
  useLayoutEffect(() => {
    if (!scroll.current) return
    if (anchor.current && anchor.current.firstId !== state.items[0]?.id) {
      scroll.current.scrollTop =
        anchor.current.top + scroll.current.scrollHeight - anchor.current.height
      anchor.current = null
    } else if (atBottom.current)
      scroll.current.scrollTop = scroll.current.scrollHeight
  }, [state.items])
  const detail = state.detail
  const run = detail?.run
  const openCode = async () => {
    if (!run?.threadId || !run.turnId) return
    setNavigationError('')
    try {
      await onOpenThread(run.threadId, run.turnId)
    } catch (cause) {
      setNavigationError(String(cause))
    }
  }
  return (
    <section
      className="rooms-run-inspector"
      aria-label={t('roomsRunDetails')}
      data-run-id={runId}
    >
      <div
        ref={scroll}
        className="rooms-run-scroll"
        onScroll={(event) => {
          atBottom.current =
            event.currentTarget.scrollHeight -
              event.currentTarget.scrollTop -
              event.currentTarget.clientHeight <
            80
          setAway(!atBottom.current)
        }}
      >
        {state.loading ? (
          <p className="rooms-run-note">{t('roomsLoading')}</p>
        ) : null}
        {run && detail ? (
          <>
            <header className="rooms-run-header">
              <h3>
                {run.memberLabel} · {t(`roomsRunPhase_${run.phase}`)}
              </h3>
              <p>
                {t(`roomsRunStatus_${run.status}`)}
                {run.outcome
                  ? ` · ${t(`roomsRunOutcome_${run.outcome}`)}`
                  : ''}{' '}
                · {t('roomsRunAttempt', { count: run.attempt })}
              </p>
              <time dateTime={run.createdAt}>
                {new Date(run.createdAt).toLocaleString()}
              </time>
              {run.threadId &&
              run.turnId &&
              detail.availability.status === 'available' ? (
                <button
                  type="button"
                  className="rooms-run-secondary"
                  data-thread-target-turn-id={run.turnId}
                  onClick={() => void openCode()}
                >
                  <ExternalLink size={14} />
                  {t('roomsRunOpenCode')}
                </button>
              ) : null}
            </header>
            {run.error || run.reason ? (
              <p
                className={run.error ? 'rooms-run-error' : 'rooms-run-note'}
                role={run.error ? 'alert' : undefined}
              >
                {run.error || run.reason}
              </p>
            ) : null}
            {detail.availability.status !== 'available' ? (
              <p className="rooms-run-unavailable">
                {t(`roomsRunAvailability_${detail.availability.status}`)}
                {detail.availability.reason
                  ? ` · ${detail.availability.reason}`
                  : ''}
              </p>
            ) : null}
            {detail.trigger ? (
              <details className="rooms-run-trigger">
                <summary>
                  {t('roomsRunTrigger')} · {detail.trigger.authorLabelSnapshot}
                </summary>
                <RoomMessageBody
                  body={detail.trigger.body}
                  attachmentIds={detail.trigger.attachmentIds}
                />
              </details>
            ) : null}
            <section className="rooms-run-input">
              <h4>{t('roomsRunInput')}</h4>
              <RoomMessageBody
                body={run.input || t('roomsRunInputUnavailable')}
                attachmentIds={run.attachmentIds}
              />
            </section>
            {detail.context?.prompt ? (
              <details className="rooms-run-trigger">
                <summary>{t('roomsRunContext')}</summary>
                <RoomMessageBody
                  body={detail.context.prompt}
                  attachmentIds={detail.context.attachmentIds ?? []}
                />
              </details>
            ) : null}
            <h4 className="rooms-run-process-title">{t('roomsRunProcess')}</h4>
            {state.itemsAvailability &&
            state.itemsAvailability.status !== 'available' &&
            state.itemsAvailability.status !== detail.availability.status ? (
              <p className="rooms-run-unavailable">
                {t(`roomsRunAvailability_${state.itemsAvailability.status}`)}
                {state.itemsAvailability.reason
                  ? ` · ${state.itemsAvailability.reason}`
                  : ''}
              </p>
            ) : null}
            {state.hasEarlier ? (
              <button
                type="button"
                className="rooms-run-secondary"
                disabled={state.moreBusy}
                onClick={() => {
                  if (scroll.current)
                    anchor.current = {
                      height: scroll.current.scrollHeight,
                      top: scroll.current.scrollTop,
                      firstId: state.items[0]?.id
                    }
                  void state.loadEarlier()
                }}
              >
                {t(
                  state.moreBusy
                    ? 'roomsLoading'
                    : state.hasGap
                      ? 'roomsRunLoadGap'
                      : 'roomsRunEarlier'
                )}
              </button>
            ) : null}
            <div className="rooms-run-process-filters">
              <select aria-label={t('roomsRunFilter')} value={processFilter} onChange={(event) => setProcessFilter(event.target.value)}>
                <option value="all">{t('roomsRunProcessAll')}</option><option value="tools">{t('roomsRunProcessTools')}</option><option value="errors">{t('roomsRunProcessErrors')}</option>
              </select>
              <input aria-label={t('roomsRunProcessSearch')} placeholder={t('roomsRunProcessSearch')} value={processSearch} onChange={(event) => setProcessSearch(event.target.value)} />
            </div>
            {processFilter !== 'all' || processSearch ? <p className="rooms-run-note">{t('roomsRunSearchLoadedOnly')}</p> : null}
            <RoomRunItems roomId={roomId} runId={runId} items={state.items} filter={processFilter} query={processSearch} runStatus={run.status} />
            {!state.items.length &&
            !state.error &&
            state.itemsAvailability?.status === 'available' ? (
              <p className="rooms-run-note">{t('roomsRunNoItems')}</p>
            ) : null}
            <dl className="rooms-run-metrics">
              {run.model ? (
                <div>
                  <dt>{t('roomsMemberModel')}</dt>
                  <dd>{run.model}</dd>
                </div>
              ) : null}
              {run.elapsedMs !== undefined ? (
                <div>
                  <dt>{t('roomsRunElapsed')}</dt>
                  <dd>
                    {t('roomsRunSeconds', {
                      count: Math.round(run.elapsedMs / 100) / 10
                    })}
                  </dd>
                </div>
              ) : null}
              <div>
                <dt>{t('roomsRunUsage')}</dt>
                <dd>
                  {run.usage
                    ? t('roomsRunTokens', { count: run.usage.totalTokens })
                    : t('roomsRunUsageUnavailable')}
                  {run.usageStatus === 'partial'
                    ? ` · ${t('roomsRunUsagePartial')}`
                    : ''}
                </dd>
              </div>
            </dl>
          </>
        ) : null}
        {state.error || state.streamError || navigationError ? (
          <p role="alert" className="rooms-run-error">
            {state.error || state.streamError || navigationError}
          </p>
        ) : null}
        {state.error || state.streamError ? (
          <button
            type="button"
            className="rooms-run-secondary"
            onClick={state.refresh}
          >
            <RefreshCw size={13} />
            {t('roomsRefresh')}
          </button>
        ) : null}
      </div>
      {away && state.items.length ? (
        <button
          type="button"
          className="rooms-run-latest rooms-run-secondary"
          onClick={() => {
            if (scroll.current)
              scroll.current.scrollTop = scroll.current.scrollHeight
            atBottom.current = true
            setAway(false)
          }}
        >
          <ArrowDown size={13} />
          {t('roomsRunLatestItems')}
        </button>
      ) : null}
    </section>
  )
}
