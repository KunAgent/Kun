import { useTranslation } from 'react-i18next'
import type { CoreTurnItemJson } from '../../agent/kun-contract'
import { RoomMessageBody } from './RoomMessageBody'
import { RoomRunItemContent } from './RoomRunItemContent'

const hiddenKinds = new Set([
  'model_context',
  'runtime_context_source',
  'goal_context',
  'interruption_note'
])

function printable(value: unknown): string {
  if (typeof value === 'string') return value
  return JSON.stringify(value, null, 2) ?? ''
}

/** Deliberately uses only presentation: approval/input/tool records cannot execute actions here. */
export function RoomRunItems({
  items,
  roomId,
  runId
}: {
  items: CoreTurnItemJson[]
  roomId: string
  runId: string
}) {
  const { t } = useTranslation('common')
  return (
    <ol className="rooms-run-items">
      {items
        .filter((item) => !hiddenKinds.has(item.kind))
        .map((item) => {
          const isTool =
            item.kind === 'tool_call' || item.kind === 'tool_result'
          const error =
            item.kind === 'error' || item.status === 'failed' || item.isError
          const raw = item as CoreTurnItemJson & {
            message?: string
            reason?: string
            attachmentIds?: string[]
            reviewText?: string
          }
          let body =
            item.text ?? item.summary ?? raw.reviewText ?? raw.message ?? ''
          if (item.kind === 'user_message')
            body = item.displayText ?? item.text ?? ''
          if (item.kind === 'approval')
            body = [item.summary, raw.reason].filter(Boolean).join('\n\n')
          if (item.kind === 'user_input')
            body = [
              item.prompt,
              ...(item.questions ?? []).map(
                (question) => question.question ?? question.prompt ?? ''
              ),
              ...(item.answers ?? []).map(
                (answer) => `${answer.label}: ${answer.value ?? ''}`
              )
            ]
              .filter(Boolean)
              .join('\n\n')
          return (
            <li
              key={item.id}
              className={`rooms-run-item${error ? ' is-error' : ''}`}
              data-run-item-id={item.id}
            >
              <div className="rooms-run-item-heading">
                <strong>
                  {isTool
                    ? item.toolName
                    : t(`roomsRunItem_${item.kind}`, {
                        defaultValue: item.kind
                      })}
                </strong>
                <span>
                  {t(`roomsRunItemStatus_${item.status}`, {
                    defaultValue: item.status
                  })}
                </span>
                <time dateTime={item.createdAt}>
                  {new Date(item.createdAt).toLocaleTimeString([], {
                    hour: '2-digit',
                    minute: '2-digit',
                    second: '2-digit'
                  })}
                </time>
              </div>
              {isTool ? (
                <details open={Boolean(error)}>
                  <summary>
                    {t(
                      item.kind === 'tool_call'
                        ? 'roomsRunToolArguments'
                        : 'roomsRunToolOutput'
                    )}
                  </summary>
                  <RoomRunItemContent
                    roomId={roomId}
                    runId={runId}
                    itemId={item.id}
                    code
                    preview={printable(
                      item.kind === 'tool_call' ? item.arguments : item.output
                    )}
                  />
                </details>
              ) : item.kind === 'assistant_reasoning' ||
                item.kind === 'user_message' ? (
                <details>
                  <summary>
                    {t(
                      item.kind === 'user_message'
                        ? 'roomsRunRawInput'
                        : 'roomsRunReasoning'
                    )}
                  </summary>
                  <RoomRunItemContent
                    roomId={roomId}
                    runId={runId}
                    itemId={item.id}
                    preview={body}
                  />
                  {raw.attachmentIds?.length ? (
                    <RoomMessageBody
                      body=""
                      attachmentIds={raw.attachmentIds}
                    />
                  ) : null}
                </details>
              ) : (
                <>
                  <RoomRunItemContent
                    roomId={roomId}
                    runId={runId}
                    itemId={item.id}
                    preview={body}
                  />
                  {raw.attachmentIds?.length ? (
                    <RoomMessageBody
                      body=""
                      attachmentIds={raw.attachmentIds}
                    />
                  ) : null}
                </>
              )}
            </li>
          )
        })}
    </ol>
  )
}
