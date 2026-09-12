import { useEffect, useRef, useState, type ReactElement } from 'react'
import { useTranslation } from 'react-i18next'
import { ExternalLink, X } from 'lucide-react'
import type { RoomTask, RoomTaskAction } from '@shared/rooms-api'
import { roomRequestId, roomsClient, type RoomTaskDetail } from './rooms-client'
import { roomButtonClass } from './RoomSettings'

export function roomTaskActions(task: RoomTask): RoomTaskAction[] {
  const actions: RoomTaskAction[] = []
  if (
    [
      'queued',
      'waiting_dependency',
      'running',
      'needs_input',
      'needs_approval'
    ].includes(task.status)
  )
    actions.push('cancel')
  if (['failed', 'cancelled', 'recovery_required'].includes(task.status))
    actions.push('retry')
  if (task.latestDeliveryId && task.applicationStatus !== 'applied') {
    if (task.status === 'awaiting_acceptance') actions.push('review', 'accept')
    if (task.acceptedDeliveryId === task.latestDeliveryId) actions.push('apply')
  }
  return actions
}
const labels: Record<RoomTaskAction, string> = {
  cancel: 'roomsStop',
  retry: 'roomsRetry',
  review: 'roomsReview',
  accept: 'roomsAccept',
  apply: 'roomsApply'
}

export function RoomTaskPanel({
  task,
  onClose,
  onOpenThread,
  onUpdated
}: {
  task: RoomTask
  onClose: () => void
  onOpenThread: (id: string) => void
  onUpdated: () => void
}): ReactElement {
  const { t } = useTranslation('common')
  const [detail, setDetail] = useState<RoomTaskDetail | null>(null)
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const mutationRef = useRef(new Map<string, string>())
  useEffect(() => {
    const controller = new AbortController()
    let timer: ReturnType<typeof setTimeout> | undefined
    const refresh = async (): Promise<void> => {
      try {
        const result = await roomsClient.task(
          task.roomId,
          task.id,
          controller.signal
        )
        if (!controller.signal.aborted) {
          setDetail(result)
          setError('')
        }
      } catch (cause) {
        if (!controller.signal.aborted)
          setError(cause instanceof Error ? cause.message : String(cause))
      } finally {
        if (!controller.signal.aborted)
          timer = setTimeout(() => void refresh(), 2500)
      }
    }
    void refresh()
    return () => {
      controller.abort()
      clearTimeout(timer)
    }
  }, [task.id, task.roomId])
  const current =
    detail?.task && detail.task.revision >= task.revision ? detail.task : task
  const act = async (action: RoomTaskAction): Promise<void> => {
    const identity = `${current.id}:${current.revision}:${action}`
    const requestId = mutationRef.current.get(identity) ?? roomRequestId()
    mutationRef.current.set(identity, requestId)
    setBusy(true)
    setError('')
    try {
      await roomsClient.act(current, action, requestId)
      setDetail(await roomsClient.task(current.roomId, current.id))
      mutationRef.current.delete(identity)
      onUpdated()
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause))
    } finally {
      setBusy(false)
    }
  }
  return (
    <aside
      aria-label={t('roomsDetails')}
      className="absolute inset-0 z-50 flex min-h-0 flex-col overflow-hidden border-l border-ds-border bg-ds-main shadow-xl xl:static xl:w-[380px] xl:shrink-0 xl:shadow-none"
    >
      <header className="rooms-detail-titlebar flex items-center justify-between border-b border-ds-border p-4">
        <h2 className="text-sm font-semibold text-ds-ink">
          {t('roomsDetails')}
        </h2>
        <button
          className={roomButtonClass}
          onClick={onClose}
          aria-label={t('roomsClose')}
        >
          <X size={16} />
        </button>
      </header>
      <div className="min-h-0 flex-1 space-y-4 overflow-auto p-4">
        <h3 className="break-words text-lg font-semibold text-ds-ink">
          {current.title}
        </h3>
        <p className="text-sm text-ds-muted">
          {current.memberSnapshot.displayName} ·{' '}
          {t(`roomsState_${current.status}`)} ·{' '}
          {t(`roomsState_${current.stage}`)}
        </p>
        <p className="whitespace-pre-wrap break-words text-sm text-ds-ink">
          {current.latestProgress}
        </p>
        <button
          className={`${roomButtonClass} flex items-center gap-2`}
          onClick={() =>
            onOpenThread(detail?.controlThreadId ?? current.executionThreadId)
          }
        >
          <ExternalLink size={15} />
          {t('roomsOpenCode')}
        </button>
        {['needs_approval', 'needs_input', 'recovery_required'].includes(
          current.status
        ) ? (
          <p className="text-sm text-amber-600">
            {t('roomsOpenCode')} · {t(`roomsState_${current.status}`)}
          </p>
        ) : null}
        <dl className="space-y-2 text-sm text-ds-muted">
          <div>
            <dt>{t('roomsVerification')}</dt>
            <dd className="text-ds-ink">
              {t(`roomsState_${current.verificationStatus}`)}
            </dd>
          </div>
          <div>
            <dt>{t('roomsApplication')}</dt>
            <dd className="text-ds-ink">
              {t(`roomsState_${current.applicationStatus}`)}
            </dd>
          </div>
        </dl>
        {detail?.workspace ? (
          <div className="text-xs text-ds-muted">
            {t('roomsWorktree')}
            <p className="mt-1 break-all font-mono">{detail.workspace.path}</p>
          </div>
        ) : null}
        {detail?.delivery ? (
          <section className="space-y-3">
            <h4 className="font-medium text-ds-ink">
              {t('roomsDelivery')} v{detail.delivery.version}{' '}
              {current.acceptedDeliveryId === detail.delivery.id
                ? `· ${t('roomsAccepted')}`
                : ''}
            </h4>
            <code className="block break-all text-xs text-ds-muted">
              {detail.delivery.versionHash}
            </code>
            <p className="whitespace-pre-wrap break-words text-sm text-ds-ink">
              {detail.delivery.summary}
            </p>
            {detail.delivery.incomplete.length ? (
              <div>
                <h5 className="text-sm text-ds-muted">
                  {t('roomsLimitations')}
                </h5>
                <ul className="list-disc pl-5 text-sm text-ds-ink">
                  {detail.delivery.incomplete.map((item, index) => (
                    <li key={index}>{item}</li>
                  ))}
                </ul>
              </div>
            ) : null}
            {detail.delivery.verification.map((evidence, index) => (
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
                {t('roomsDiff')} ({detail.delivery.changedFiles.length})
              </summary>
              <pre className="mt-2 max-h-96 overflow-auto whitespace-pre text-[11px] text-ds-ink">
                {detail.diff || t('roomsNoDiff')}
              </pre>
            </details>
          </section>
        ) : null}
        {detail?.reviews?.length ? (
          <section className="space-y-2">
            <h4 className="font-medium text-ds-ink">
              {t('roomsReviewResults')}
            </h4>
            {detail.reviews.map((review) => (
              <div
                key={review.id}
                className="rounded-lg border border-ds-border p-3 text-sm text-ds-muted"
              >
                <p>
                  {t(`roomsState_${review.verdict}`)} ·{' '}
                  <code>{review.versionHash.slice(0, 12)}</code>
                </p>
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
        {error ? (
          <p role="alert" className="text-sm text-red-500">
            {error}
          </p>
        ) : null}
        <div className="flex flex-wrap gap-2">
          {roomTaskActions(current).map((action) => (
            <button
              key={action}
              disabled={busy}
              className={roomButtonClass}
              onClick={() => void act(action)}
            >
              {t(labels[action])}
            </button>
          ))}
        </div>
      </div>
    </aside>
  )
}
