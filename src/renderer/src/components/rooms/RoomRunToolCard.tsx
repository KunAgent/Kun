import { useEffect, useRef, useState } from 'react'
import { ChevronDown, ChevronRight } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import type { RoomRunItemsPage } from '@shared/rooms-api'
import type { CoreTurnItemJson } from '../../agent/kun-contract'
import type { ToolBlock } from '../../agent/types'
import { toolBlockFromItem } from '../../agent/kun-mapper-tools'
import { summarizeToolBlock } from '../chat/message-timeline-process-detail'
import { toolBlockIcon } from '../chat/message-timeline-process-summary'
import { roomPath, roomsRequest } from './rooms-client'
import { RoomRunItemContent } from './RoomRunItemContent'

const printable = (value: unknown) => typeof value === 'string' ? value : JSON.stringify(value, null, 2) ?? ''

export function RoomRunToolCard({ roomId, runId, callId, call, result, runStatus }: {
  roomId: string; runId: string; callId: string; call?: CoreTurnItemJson; result?: CoreTurnItemJson; runStatus?: string
}) {
  const { t } = useTranslation('common')
  const [loaded, setLoaded] = useState<CoreTurnItemJson[]>([]), [queried, setQueried] = useState(false)
  const [busy, setBusy] = useState(false), [error, setError] = useState('')
  const [expanded, setExpanded] = useState(false)
  const request = useRef<AbortController | null>(null)
  useEffect(() => () => request.current?.abort(), [])
  const input = call ?? loaded.find((item) => item.kind === 'tool_call')
  const output = result ?? loaded.find((item) => item.kind === 'tool_result')
  const representative = input ?? output
  const failed = output?.isError || output?.status === 'failed' || input?.status === 'failed'
  const status = failed ? 'failed' : output ? output.status : 'pending'
  const duration = input && output ? Math.max(0, Date.parse(output.finishedAt ?? output.createdAt) - Date.parse(input.createdAt)) : undefined
  const settled = runStatus && !['queued', 'running', 'recovery_required'].includes(runStatus)
  const block: ToolBlock | null = representative ? toolBlockFromItem(representative) : null
  const summary = block ? summarizeToolBlock(block, t) : (representative?.toolName ?? callId)
  const Icon = block ? toolBlockIcon(block) : null
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
  return <li className={`rooms-run-tool-row${failed ? ' is-error' : ''}`} data-run-tool-call-id={callId}>
    <button
      type="button"
      className="rooms-run-tool-toggle"
      aria-expanded={expanded}
      onClick={() => setExpanded((value) => !value)}
    >
      {Icon ? <Icon className="rooms-run-tool-icon" size={14} strokeWidth={1.9} /> : null}
      <span className="rooms-run-tool-summary">{summary}</span>
      <span className={`rooms-run-tool-status is-${status}`}>
        {t(`roomsRunItemStatus_${status}`, { defaultValue: status })}
      </span>
      {duration !== undefined && Number.isFinite(duration)
        ? <span className="rooms-run-tool-duration">{Math.round(duration / 100) / 10}s</span>
        : null}
      {expanded
        ? <ChevronDown className="rooms-run-tool-chevron" size={14} strokeWidth={1.8} />
        : <ChevronRight className="rooms-run-tool-chevron" size={14} strokeWidth={1.8} />}
    </button>
    {expanded ? (
      <div className="rooms-run-tool-details">
        {!input || !output ? (
          <div className="rooms-run-tool-pair">
            {!input && !output ? <p className="rooms-run-note">{t(settled && queried ? 'roomsRunToolUnavailable' : 'roomsRunToolWaiting')}</p> : null}
            <button type="button" className="rooms-run-secondary" disabled={busy} onClick={() => void loadPair()}>
              {t(busy ? 'roomsLoading' : 'roomsRunLoadToolPair')}
            </button>
            {queried && !input ? <p className="rooms-run-note">{t('roomsRunToolPairMissing')}</p> : null}
          </div>
        ) : null}
        {input ? (
          <details>
            <summary>{t('roomsRunToolArguments')}</summary>
            <RoomRunItemContent roomId={roomId} runId={runId} itemId={input.id} code preview={printable(input.arguments)} />
          </details>
        ) : null}
        {output ? (
          <details open={Boolean(failed)}>
            <summary>{t('roomsRunToolOutput')}</summary>
            <RoomRunItemContent roomId={roomId} runId={runId} itemId={output.id} code preview={printable(output.output)} />
          </details>
        ) : null}
        {error ? <p role="alert" className="rooms-run-error">{error}</p> : null}
      </div>
    ) : null}
  </li>
}
