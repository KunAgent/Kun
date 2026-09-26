import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import type { Room, RoomAgreementContext } from '@shared/rooms-api'
import { roomPath, roomsRequest, type RoomRequestEntry } from './rooms-client'
import { useRoomMutation, useRoomResource } from './useRoomResource'
import { RoomComposer } from './RoomComposer'
import { roomButtonClass } from './RoomSettings'
import { RoomAgreementSources } from './RoomAgreementSources'
export function RoomRequestControls({ room, request, onUpdated }: {
  room: Room; request: RoomRequestEntry; onUpdated: () => Promise<void>
}) {
  const { t } = useTranslation('common')
  const [expanded, setExpanded] = useState(false)
  const [continuationRevision, setContinuationRevision] = useState<number | null>(null)
  const path = roomPath(room.id) + '/requests/' + encodeURIComponent(request.id)
  const detail = useRoomResource<{ request: RoomRequestEntry; context?: { agreements?: RoomAgreementContext };
    compression?: { status: string; completed: number; total: number; error?: string } }>(room.id, expanded || continuationRevision !== null ? path : null)
  const current = detail.data?.request && detail.data.request.revision >= request.revision ? detail.data.request : request
  const refresh = async () => { await detail.refresh(); await onUpdated() }
  const mutation = useRoomMutation(refresh)
  const action = (name: string) => mutation.run(current.id + ':' + current.revision + ':' + name,
    (clientRequestId) => roomsRequest(path + '/' + name, 'POST', { clientRequestId, expectedRevision: current.revision }))
  return <div className="space-y-2">
    {request.clarification ? <p className="whitespace-pre-wrap text-xs text-amber-600">{request.clarification}</p> : null}
    {request.contextState === 'compressing' ? <p role="status" className="text-xs text-ds-muted">{t('roomsCompressingAgreements')}</p> : null}
    <div className="flex flex-wrap gap-2">
      {['needs_input', 'failed', 'cancelled'].includes(current.status) ? <button className={roomButtonClass} onClick={() => setContinuationRevision(current.revision)}>{t('roomsContinueRequest')}</button> : null}
      {['needs_input', 'failed'].includes(current.status) ? <button className={roomButtonClass} disabled={mutation.busy} onClick={() => void action('retry')}>{t('roomsRetryCoordination')}</button> : null}
      {['pending', 'running', 'needs_input', 'failed'].includes(current.status) ? <button className={roomButtonClass} disabled={mutation.busy} onClick={() => void action('cancel')}>
        {t(['pending', 'running'].includes(current.status) ? 'roomsStopCoordination' : 'roomsCloseRequest')}</button> : null}
      {['recovery_required', 'stopping'].includes(current.status) ? <button className={roomButtonClass} disabled={mutation.busy} onClick={() => void action('reconcile')}>{t('roomsReconcileRequest')}</button> : null}
      <button className={roomButtonClass} aria-expanded={expanded} onClick={() => setExpanded(!expanded)}>{t('roomsRequestContext')}</button>
    </div>
    {continuationRevision !== null ? <section className="rounded border border-ds-border p-2" aria-label={t('roomsContinueRequest')}>
      <p className="text-xs text-ds-muted">{t('roomsContinuationHint')}</p>
      <RoomComposer key={request.id} room={room} tasks={[]} draftId={'request-' + request.id} onSend={async ({ clientRequestId, ...message }) => {
        await roomsRequest(path + '/continue', 'POST', { clientRequestId, expectedRevision: continuationRevision, message })
        setContinuationRevision(null)
        void refresh().catch(() => undefined)
      }} />
      <button className={roomButtonClass} onClick={() => setContinuationRevision(null)}>{t('roomsCancel')}</button>
    </section> : null}
    {expanded ? <div className="space-y-2">
      {detail.data?.compression ? <p className="text-xs text-ds-muted">{t('roomsCompressingAgreements')} · {t('roomsState_' + detail.data.compression.status)} · {detail.data.compression.completed}/{detail.data.compression.total}</p> : null}
      <RoomAgreementSources roomId={room.id} agreements={detail.data?.context?.agreements} />
    </div> : null}
    {mutation.error || detail.error ? <p role="alert" className="text-xs text-red-500">{mutation.error || detail.error}</p> : null}
  </div>
}
