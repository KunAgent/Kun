import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import type { RoomRunSummary as Summary } from '@shared/rooms-api'
import { roomPath, roomsRequest } from './rooms-client'
import { subscribeRoomEvents } from './useRoomEvents'
import './rooms-experience.css'

export function RoomRunSummary({ roomId, topics = [] }: {
  roomId: string; topics?: Array<{ rootRequestId: string; title: string }>
}) {
  const { t } = useTranslation('common')
  const [rootId, setRootId] = useState(''), [days, setDays] = useState('7')
  const [summary, setSummary] = useState<Summary | null>(null)
  const [error, setError] = useState('')
  useEffect(() => { setRootId('') }, [roomId])
  useEffect(() => {
    const controller = new AbortController()
    setSummary(null); setError('')
    let timer: ReturnType<typeof setTimeout> | undefined
    const load = async () => {
      const query = new URLSearchParams({ since: new Date(Date.now() - Number(days) * 86400000).toISOString(),
        ...(rootId ? { root_request_id: rootId } : {}) })
      try {
        const result = await roomsRequest<Summary>(`${roomPath(roomId)}/run-summary?${query}`, 'GET', undefined, controller.signal)
        if (!controller.signal.aborted) { setSummary(result); setError('') }
      } catch (cause) { if (!controller.signal.aborted) setError(String(cause)) }
    }
    void load()
    const off = subscribeRoomEvents((event) => {
      if (event.roomId !== roomId || !/^(room_run|peer)\./.test(event.kind)) return
      clearTimeout(timer); timer = setTimeout(() => void load(), 500)
    })
    return () => { controller.abort(); off(); clearTimeout(timer) }
  }, [roomId, rootId, days])
  return <section className="rooms-run-summary" aria-label={t('roomsUsageSummary')}>
    <h3>{t('roomsUsageSummary')}</h3>
    <div className="rooms-list-filters">
      <select value={rootId} aria-label={t('roomsUsageTopic')} onChange={(event) => setRootId(event.target.value)}>
        <option value="">{t('roomsRunAllTopics')}</option>
        {topics.map((topic) => <option key={topic.rootRequestId} value={topic.rootRequestId}>{topic.title}</option>)}
      </select>
      <select value={days} aria-label={t('roomsUsagePeriod')} onChange={(event) => setDays(event.target.value)}>
        {[1, 7, 30].map((count) => <option value={count} key={count}>{t('roomsUsageDays', { count })}</option>)}
      </select>
    </div>
    {summary ? <>
      <dl className="rooms-run-summary-grid">
        <div><dt>{t('roomsUsageRuns')}</dt><dd>{summary.runs}</dd></div>
        <div><dt>{t('roomsUsageResponses')}</dt><dd>{summary.responses}</dd></div>
        <div><dt>{t('roomsUsageTriages')}</dt><dd>{summary.triages}</dd></div>
        <div><dt>{t('roomsUsageKnownTokens')}</dt><dd>{summary.knownTokens?.toLocaleString() ?? t('roomsRunUsageUnavailable')}</dd></div>
        <div><dt>{t('roomsRunElapsed')}</dt><dd>{summary.knownElapsedMs === null ? t('roomsRunUsageUnavailable') : t('roomsRunSeconds', { count: Math.round(summary.knownElapsedMs / 100) / 10 })}</dd></div>
        <div><dt>{t('roomsRunOutcome_failed')}</dt><dd>{summary.failed}</dd></div>
        <div><dt>{t('roomsRunOutcome_stale')}</dt><dd>{summary.stale}</dd></div>
        <div><dt>{t('roomsRunOutcome_duplicate')}</dt><dd>{summary.duplicate}</dd></div>
        <div><dt>{t('roomsRunOutcome_skipped')}</dt><dd>{summary.skipped}</dd></div>
        <div><dt>{t('roomsRunOutcome_cancelled')}</dt><dd>{summary.cancelled}</dd></div>
      </dl>
      <p className="rooms-run-note">{t('roomsUsageCoverage', { complete: summary.knownUsageRuns, partial: summary.partialUsageRuns, unknown: summary.unknownUsageRuns })}</p>
      {summary.budgetPauses.map((pause) => <p className="rooms-run-note" key={pause.rootRequestId}>{t('roomsPeerReason_' + pause.reason, { defaultValue: pause.reason })} · {pause.responsesRemaining}/32 · {pause.triagesRemaining}/128</p>)}
    </> : !error ? <p className="rooms-run-note">{t('roomsLoading')}</p> : null}
    {error ? <p role="alert" className="rooms-run-error">{error}</p> : null}
  </section>
}
