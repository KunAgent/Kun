import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import type { RoomTask } from '@shared/rooms-api'
import { roomPath, roomsRequest, type RoomRule } from './rooms-client'
import { roomButtonClass } from './RoomSettings'
import { useRoomMutation, useRoomResource } from './useRoomResource'

export function RoomRuleTaskUpdate({
  roomId,
  rule,
  onUpdated
}: {
  roomId: string
  rule: RoomRule
  onUpdated: () => Promise<void>
}) {
  const { t } = useTranslation('common')
  const [open, setOpen] = useState(false)
  const [selected, setSelected] = useState<
    Array<{ id: string; revision: number }>
  >([])
  const resource = useRoomResource<{ tasks: RoomTask[] }>(
    roomId,
    open
      ? roomPath(roomId) +
          '/tasks?limit=200&status=running,needs_input,needs_approval,queued,waiting_dependency'
      : null
  )
  const mutation = useRoomMutation(onUpdated)
  const publish = () =>
    mutation.run(
      `${rule.id}:${rule.version}:${JSON.stringify(selected)}`,
      async (clientRequestId) => {
        for (const [index, task] of selected.entries()) {
          await roomsRequest(
            `${roomPath(roomId)}/rules/${encodeURIComponent(rule.id)}/adopt`,
            'POST',
            {
              clientRequestId: `${clientRequestId}-${index}`,
              taskId: task.id,
              expectedTaskRevision: task.revision,
              version: rule.version,
              body: t(
                rule.active === false
                  ? 'roomsRuleRemovedPrompt'
                  : 'roomsRuleUpdatedPrompt',
                { id: rule.id, version: rule.version, body: rule.body }
              )
            }
          )
        }
        setSelected([])
        setOpen(false)
      }
    )
  return (
    <div className="space-y-2 text-xs text-ds-muted">
      <button className={roomButtonClass} onClick={() => setOpen(!open)}>
        {t('roomsNotifyActiveTasks')}
      </button>
      {open ? (
        <>
          <p>{t('roomsNotifyActiveTasksHint')}</p>
          {resource.data?.tasks.map((task) => (
            <label key={task.id} className="flex items-center gap-2">
              <input
                type="checkbox"
                checked={selected.some((value) => value.id === task.id)}
                disabled={mutation.busy}
                onChange={(event) =>
                  setSelected((current) =>
                    event.target.checked
                      ? [...current, { id: task.id, revision: task.revision }]
                      : current.filter((value) => value.id !== task.id)
                  )
                }
              />
              {task.title} · {task.memberSnapshot.displayName}
            </label>
          ))}
          <button
            className={roomButtonClass}
            disabled={mutation.busy || !selected.length}
            onClick={() => void publish()}
          >
            {t('roomsSendAgreementUpdate')}
          </button>
        </>
      ) : null}
      {resource.error || mutation.error ? (
        <p role="alert" className="text-red-500">
          {resource.error || mutation.error}
        </p>
      ) : null}
    </div>
  )
}
