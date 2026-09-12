import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import type { RoomDelivery, RoomReview, RoomTask } from '@shared/rooms-api'
import { roomTaskPath, type RoomTaskDetail } from './rooms-client'
import { roomFieldClass } from './RoomSettings'
import { useRoomResource } from './useRoomResource'

export function RoomDeliveryHistory({
  task,
  detail
}: {
  task: RoomTask
  detail: RoomTaskDetail | null
}) {
  const { t } = useTranslation('common')
  const [selectedId, setSelectedId] = useState('')
  const [compareId, setCompareId] = useState('')
  const path = roomTaskPath(task)
  const history = useRoomResource<{ deliveries: RoomDelivery[] }>(
    task.roomId,
    path + '/deliveries'
  )
  const historical = useRoomResource<{
    delivery: RoomDelivery
    reviews: RoomReview[]
    diff: string
  }>(
    task.roomId,
    selectedId ? `${path}/deliveries/${encodeURIComponent(selectedId)}` : null
  )
  const delivery = selectedId ? historical.data?.delivery : detail?.delivery
  const reviews = selectedId ? historical.data?.reviews : detail?.reviews
  const comparison = useRoomResource<{ diff: string }>(
    task.roomId,
    compareId && delivery
      ? `${path}/compare?from=${encodeURIComponent(compareId)}&to=${encodeURIComponent(delivery.id)}`
      : null
  )
  return (
    <section className="space-y-3">
      <h4 className="font-medium text-ds-ink">{t('roomsDelivery')}</h4>
      <select
        aria-label={t('roomsDeliveryHistory')}
        className={roomFieldClass}
        value={selectedId}
        onChange={(event) => {
          setSelectedId(event.target.value)
          setCompareId('')
        }}
      >
        <option value="">{t('roomsLatestDelivery')}</option>
        {history.data?.deliveries.map((item) => (
          <option key={item.id} value={item.id}>
            v{item.version} · {item.versionHash.slice(0, 12)}
          </option>
        ))}
      </select>
      {delivery ? (
        <>
          <p className="text-sm text-ds-ink">
            v{delivery.version} ·{' '}
            {task.acceptedDeliveryId === delivery.id ? t('roomsAccepted') : ''}
          </p>
          <code className="block break-all text-xs text-ds-muted">
            {delivery.versionHash}
          </code>
          <p className="whitespace-pre-wrap break-words text-sm text-ds-ink">
            {delivery.summary}
          </p>
          {delivery.incomplete.length ? (
            <div>
              <h5 className="text-sm text-ds-muted">{t('roomsLimitations')}</h5>
              <ul className="list-disc pl-5 text-sm text-ds-ink">
                {delivery.incomplete.map((item, index) => (
                  <li key={index}>{item}</li>
                ))}
              </ul>
            </div>
          ) : null}
          <p className="text-xs text-ds-muted">
            {t('roomsVerificationEvidenceHint')}
          </p>
          {delivery.verification.map((evidence, index) => (
            <div
              key={index}
              className="rounded-lg border border-ds-border p-2 text-xs text-ds-muted"
            >
              <code className="break-all">{evidence.command}</code>
              <p>
                {t(`roomsState_${evidence.status}`)} ·{' '}
                {evidence.exitCode ?? '—'}
              </p>
              {evidence.reason ? <p>{evidence.reason}</p> : null}
            </div>
          ))}
          <details>
            <summary className="cursor-pointer text-sm text-ds-ink">
              {t('roomsDiff')} ({delivery.changedFiles.length})
            </summary>
            <pre className="mt-2 max-h-96 overflow-auto whitespace-pre text-[11px] text-ds-ink">
              {(selectedId ? historical.data?.diff : detail?.diff) ||
                t('roomsNoDiff')}
            </pre>
          </details>
          <label className="block text-xs text-ds-muted">
            {t('roomsCompareVersions')}
            <select
              className={roomFieldClass}
              value={compareId}
              onChange={(event) => setCompareId(event.target.value)}
            >
              <option value="">{t('roomsNone')}</option>
              {history.data?.deliveries
                .filter((item) => item.id !== delivery.id)
                .map((item) => (
                  <option key={item.id} value={item.id}>
                    v{item.version} → v{delivery.version}
                  </option>
                ))}
            </select>
          </label>
          {comparison.data ? (
            <pre className="max-h-96 overflow-auto text-[11px] text-ds-ink">
              {comparison.data.diff || t('roomsNoDiff')}
            </pre>
          ) : null}
        </>
      ) : (
        <p className="text-xs text-ds-muted">{t('roomsNoDelivery')}</p>
      )}
      {reviews?.length ? (
        <section className="space-y-2">
          <h4 className="font-medium text-ds-ink">{t('roomsReviewResults')}</h4>
          {reviews.map((review) => (
            <div
              key={review.id}
              className="rounded-lg border border-ds-border p-3 text-sm text-ds-muted"
            >
              <p>
                {t(`roomsState_${review.verdict}`)} ·{' '}
                <code>{review.versionHash.slice(0, 12)}</code>
              </p>
              {review.deliveryId !== task.latestDeliveryId ? (
                <p className="mt-1 text-xs text-amber-600">
                  {t('roomsStaleReview')}
                </p>
              ) : null}
              {review.findings.map((finding, index) => (
                <p className="mt-2" key={index}>
                  {t(`roomsState_${finding.severity}`)} {finding.file}
                  {finding.line ? `:${finding.line}` : ''} —{' '}
                  {finding.description}
                </p>
              ))}
              {review.limitations.map((limitation, index) => (
                <p key={index}>{limitation}</p>
              ))}
            </div>
          ))}
        </section>
      ) : null}
      {history.error || historical.error || comparison.error ? (
        <p role="alert" className="text-xs text-red-500">
          {history.error || historical.error || comparison.error}
        </p>
      ) : null}
    </section>
  )
}
