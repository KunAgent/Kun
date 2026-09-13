import { useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import type { RoomRunItemsPage } from '@shared/rooms-api'
import type { CoreTurnItemJson } from '../../agent/kun-contract'
import { roomPath, roomsRequest } from './rooms-client'
import { RoomRunItemContent } from './RoomRunItemContent'
import { roomToolArgumentSummary } from './room-run-groups'

const printable = (value: unknown) => typeof value === 'string' ? value : JSON.stringify(value, null, 2) ?? ''
export function RoomRunToolCard({ roomId, runId, callId, call, result, runStatus }: {
  roomId: string; runId: string; callId: string; call?: CoreTurnItemJson; result?: CoreTurnItemJson; runStatus?: string
}) {
  const { t } = useTranslation('common')
  const [loaded, setLoaded] = useState<CoreTurnItemJson[]>([]), [queried, setQueried] = useState(false)
  const [busy, setBusy] = useState(false), [error, setError] = useState('')
  const request = useRef<AbortController | null>(null)
  useEffect(() => () => request.current?.abort(), [])
  const input = call ?? loaded.find((item) => item.kind === 'tool_call')
  const output = result ?? loaded.find((item) => item.kind === 'tool_result')
  const representative = input ?? output
  const failed = output?.isError || output?.status === 'failed' || input?.status === 'failed'
  const status = failed ? 'failed' : output ? output.status : 'pending'
  const duration = input && output ? Math.max(0, Date.parse(output.finishedAt ?? output.createdAt) - Date.parse(input.createdAt)) : undefined
  const settled = runStatus && !['queued', 'running', 'recovery_required'].includes(runStatus)
  const loadPair = async () => {
    request.current?.abort()
    const controller = new AbortController(); request.current = controller
    setBusy(true); setError('')
    try {
      const page = await roomsRequest<RoomRunItemsPage>(`${roomPath(roomId)}/runs/${encodeURIComponent(runId)}/items?call_id=${encodeURIComponent(callId)}&limit=4`,
        'GET', undefined, controller.signal)
      if (!controller.signal.aborted) { setLoaded(page.items.filter((item) => 'callId' in item && item.callId === callId)); setQueried(true) }
    } catch (cause) { if (!controller.signal.aborted) setError(String(cause)) }
    finally { if (!controller.signal.aborted) setBusy(false) }
  }
  return <li className={`rooms-run-item${failed ? ' is-error' : ''}`} data-run-tool-call-id={callId}>
    <div className="rooms-run-item-heading">
      <strong>{representative?.toolName ?? callId}</strong>
      <span>{t(`roomsRunItemStatus_${status}`)}</span>
      {representative ? <time dateTime={representative.createdAt}>{new Date(representative.createdAt).toLocaleTimeString()}</time> : null}
    </div>
    {input ? <p className="rooms-run-tool-summary">{roomToolArgumentSummary(input.arguments)}</p> : null}
    {duration !== undefined && Number.isFinite(duration) ? <p className="rooms-run-note">{t('roomsRunToolDuration', { seconds: Math.round(duration / 100) / 10 })}</p> : null}
    {input ? <details><summary>{t('roomsRunToolArguments')}</summary>
      <RoomRunItemContent roomId={roomId} runId={runId} itemId={input.id} code preview={printable(input.arguments)} />
    </details> : null}
    {output ? <details open={Boolean(failed)}><summary>{t('roomsRunToolOutput')}</summary>
      <RoomRunItemContent roomId={roomId} runId={runId} itemId={output.id} code preview={printable(output.output)} />
    </details> : <p className="rooms-run-note">{t(settled && queried ? 'roomsRunToolUnavailable' : 'roomsRunToolWaiting')}</p>}
    {!input || !output ? <button type="button" className="rooms-run-secondary" disabled={busy} onClick={() => void loadPair()}>{t(busy ? 'roomsLoading' : 'roomsRunLoadToolPair')}</button> : null}
    {queried && !input ? <p className="rooms-run-note">{t('roomsRunToolPairMissing')}</p> : null}
    {error ? <p role="alert" className="rooms-run-error">{error}</p> : null}
  </li>
}
