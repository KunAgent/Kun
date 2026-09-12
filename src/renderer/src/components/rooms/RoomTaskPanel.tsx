import { useTranslation } from 'react-i18next'
import { ExternalLink, X } from 'lucide-react'
import type { RoomTask, RoomTaskAction } from '@shared/rooms-api'
import { roomsClient, roomTaskPath, type RoomTaskDetail } from './rooms-client'
import { roomButtonClass } from './RoomSettings'
import { useRoomMutation, useRoomResource } from './useRoomResource'
import { RoomTaskGates } from './RoomTaskGates'
import { RoomDeliveryHistory } from './RoomDeliveryHistory'
import { RoomIntegrationPanel } from './RoomIntegrationPanel'

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
  if (['failed', 'cancelled'].includes(task.status))
    actions.push(
      task.stage === 'review' && task.latestDeliveryId
        ? 'retry-review'
        : 'retry'
    )
  if (task.latestDeliveryId && task.applicationStatus !== 'applied') {
    if (task.status === 'awaiting_acceptance') actions.push('review', 'accept')
    if (
      task.acceptedDeliveryId === task.latestDeliveryId &&
      ['completed', 'awaiting_acceptance'].includes(task.status)
    )
      actions.push('apply')
  }
  return actions
}
const labels: Record<RoomTaskAction, string> = {
  cancel: 'roomsStop',
  retry: 'roomsRetry',
  review: 'roomsReview',
  accept: 'roomsAccept',
  apply: 'roomsApply',
  'retry-review': 'roomsRetryReview'
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
}) {
  const { t } = useTranslation('common')
  const resource = useRoomResource<RoomTaskDetail>(
    task.roomId,
    roomTaskPath(task)
  )
  const detail = resource.data
  const current =
    detail?.task && detail.task.revision >= task.revision ? detail.task : task
  const refresh = async () => {
    await resource.refresh()
    onUpdated()
  }
  const mutation = useRoomMutation(refresh)
  const act = (action: RoomTaskAction) =>
    mutation.run(`${current.id}:${current.revision}:${action}`, (requestId) =>
      roomsClient.act(current, action, requestId)
    )
  return (
    <aside
      aria-label={t('roomsDetails')}
      onKeyDown={(event) => {
        if (event.key === 'Escape') onClose()
      }}
      className="absolute inset-0 z-50 flex min-h-0 flex-col overflow-hidden border-l border-ds-border bg-ds-main shadow-xl xl:static xl:w-[400px] xl:shrink-0 xl:shadow-none"
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
        <RoomTaskGates task={current} detail={detail} onUpdated={refresh} />
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
        <details className="text-xs text-ds-muted">
          <summary>{t('roomsFrozenConfig')}</summary>
          <pre className="mt-2 max-h-60 overflow-auto whitespace-pre-wrap">
            {JSON.stringify(current.memberSnapshot, null, 2)}
          </pre>
        </details>
        <div className="flex flex-wrap gap-2">
          {roomTaskActions(current).map((action) => (
            <button
              key={action}
              disabled={mutation.busy}
              className={roomButtonClass}
              onClick={() => void act(action)}
            >
              {t(labels[action])}
            </button>
          ))}
          {current.latestDeliveryId &&
          ['awaiting_acceptance', 'completed', 'failed'].includes(
            current.status
          ) ? (
            <button
              className={roomButtonClass}
              disabled={mutation.busy}
              onClick={() => {
                window.dispatchEvent(
                  new CustomEvent('kun-room-task-reply', {
                    detail: {
                      roomId: current.roomId,
                      taskId: current.id,
                      body: t('roomsFixReviewPrompt')
                    }
                  })
                )
                onClose()
              }}
            >
              {t('roomsContinueFix')}
            </button>
          ) : null}
        </div>
        {resource.error || mutation.error ? (
          <p role="alert" className="text-sm text-red-500">
            {resource.error || mutation.error}
          </p>
        ) : null}
        <RoomDeliveryHistory key={current.id} task={current} detail={detail} />
        <RoomIntegrationPanel
          key={current.id + '-integration'}
          task={current}
          onUpdated={refresh}
          onOpenThread={onOpenThread}
        />
      </div>
    </aside>
  )
}
