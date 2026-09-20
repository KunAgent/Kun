import { Brain } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import type { CoreTurnItemJson } from '../../agent/kun-contract'
import { RoomMessageBody } from './RoomMessageBody'
import { RoomRunItemContent } from './RoomRunItemContent'
import { buildRoomRunConversation, runItemText } from './room-run-conversation'
import { RoomRunToolCard } from './RoomRunToolCard'

/**
 * Renders a run as a Code-style chronological stream. This is presentation
 * only: approvals, user inputs and tool records are shown as history and never
 * gain submit/approve/cancel controls.
 */
export function RoomRunItems({
  items,
  roomId,
  runId,
  runStatus
}: {
  items: CoreTurnItemJson[]
  roomId: string
  runId: string
  runStatus?: string
}) {
  const { t } = useTranslation('common')
  const conversation = buildRoomRunConversation(items)
  return (
    <ol className="rooms-run-stream">
      {conversation.process.map((entry) => {
        if (entry.kind === 'tool') {
          return <RoomRunToolCard key={entry.callId} roomId={roomId} runId={runId}
            callId={entry.callId} call={entry.call} result={entry.result} runStatus={runStatus} />
        }
        const item = entry.item
        if (entry.kind === 'reasoning') {
          return (
            <li key={item.id} className="rooms-run-reasoning" data-run-item-id={item.id}>
              <details>
                <summary>
                  <Brain size={14} strokeWidth={1.9} />
                  {t('roomsRunReasoning')}
                </summary>
                <RoomRunItemContent roomId={roomId} runId={runId} itemId={item.id} preview={item.text ?? ''} />
              </details>
            </li>
          )
        }
        if (entry.kind === 'user') {
          return (
            <li key={item.id} className="rooms-run-user" data-run-item-id={item.id}>
              <RoomMessageBody
                body={item.displayText ?? item.text ?? ''}
                attachmentIds={item.attachmentIds ?? []}
              />
            </li>
          )
        }
        if (entry.kind === 'assistant') {
          return (
            <li key={item.id} className="rooms-run-intermediate" data-run-item-id={item.id}>
              <div className="rooms-run-item-label">{t('roomsRunItem_assistant_text', { defaultValue: 'assistant_text' })}</div>
              <RoomRunItemContent roomId={roomId} runId={runId} itemId={item.id} preview={item.text ?? ''} />
            </li>
          )
        }
        if (entry.kind === 'error') {
          return (
            <li key={item.id} className="rooms-run-error-row" data-run-item-id={item.id}>
              <p role="alert" className="rooms-run-error">
                {item.message ?? item.summary ?? item.text ?? t('roomsRunItem_error', { defaultValue: 'Error' })}
              </p>
            </li>
          )
        }
        return (
          <li key={item.id} className="rooms-run-record" data-run-item-id={item.id}>
            <div className="rooms-run-item-label">
              {t(`roomsRunItem_${item.kind}`, { defaultValue: item.kind })}
            </div>
            <RoomRunItemContent roomId={roomId} runId={runId} itemId={item.id} preview={runItemText(item)} />
          </li>
        )
      })}
    </ol>
  )
}
