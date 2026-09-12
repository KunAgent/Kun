import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import type { RoomDelivery, RoomReview, RoomTask } from '@shared/rooms-api'
import { roomTaskPath, type RoomTaskDetail } from './rooms-client'
import { roomButtonClass, roomFieldClass } from './RoomSettings'
import { useRoomResource } from './useRoomResource'
import { useRoomPage } from './useRoomPage'
import { RoomDiffViewer } from './RoomDiffViewer'
import { RoomTextEvidence } from './RoomTextEvidence'

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
  const history = useRoomPage<RoomDelivery>(
    task.roomId,
    path + '/deliveries?summary_only=true', 'deliveries'
  )
  const historical = useRoomResource<{
    delivery: RoomDelivery
    reviews: RoomReview[]
    diff: string
  }>(
    task.roomId,
    selectedId ? `${path}/deliveries/${encodeURIComponent(selectedId)}?include_diff=false` : null
  )
  const delivery = selectedId ? historical.data?.delivery : detail?.delivery
  const reviewPage = useRoomPage<RoomReview>(task.roomId, delivery ? path + '/reviews?delivery_id=' + encodeURIComponent(delivery.id) : null, 'reviews')
  const reviews = reviewPage.items.length ? reviewPage.items : selectedId ? historical.data?.reviews : detail?.reviews
  const diffPath = delivery ? path + '/diff?delivery_id=' + encodeURIComponent(delivery.id) + (compareId ? '&from=' + encodeURIComponent(compareId) : '') : ''
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
        {history.items.map((item) => (
          <option key={item.id} value={item.id}>
            v{item.version} · {item.versionHash.slice(0, 12)}
          </option>
        ))}
      </select>
      {history.nextCursor ? <button className={roomButtonClass} disabled={history.busy} onClick={() => void history.loadMore()}>{t('roomsLoadMore')}</button> : null}
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
              {evidence.logArtifactId ? <RoomTextEvidence roomId={task.roomId} path={path + '/logs/' + encodeURIComponent(evidence.logArtifactId)} label={t('roomsViewLog')} /> : null}
            </div>
          ))}
          <RoomDiffViewer roomId={task.roomId} path={diffPath} />
          <label className="block text-xs text-ds-muted">
            {t('roomsCompareVersions')}
            <select
              className={roomFieldClass}
              value={compareId}
              onChange={(event) => setCompareId(event.target.value)}
            >
              <option value="">{t('roomsNone')}</option>
              {history.items
                .filter((item) => item.id !== delivery.id)
                .map((item) => (
                  <option key={item.id} value={item.id}>
                    v{item.version} → v{delivery.version}
                  </option>
                ))}
            </select>
          </label>

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
          {reviewPage.nextCursor ? <button className={roomButtonClass} disabled={reviewPage.busy} onClick={() => void reviewPage.loadMore()}>{t('roomsLoadMore')}</button> : null}
        </section>
      ) : null}
      {history.error || historical.error || reviewPage.error ? (
        <p role="alert" className="text-xs text-red-500">
          {history.error || historical.error || reviewPage.error}
        </p>
      ) : null}
    </section>
  )
}
