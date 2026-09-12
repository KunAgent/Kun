import { RoomRuleTaskUpdate } from './RoomRuleTaskUpdate'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import type { Room } from '@shared/rooms-api'
import {
  roomPath,
  roomsRequest,
  type RoomRequestEntry,
  type RoomRule
} from './rooms-client'
import { roomButtonClass, roomFieldClass } from './RoomSettings'
import { useRoomMutation, useRoomResource } from './useRoomResource'

function RuleEditor({
  roomId,
  rule,
  onUpdated
}: {
  roomId: string
  rule: RoomRule
  onUpdated: () => Promise<void>
}) {
  const { t } = useTranslation('common')
  const [editing, setEditing] = useState(false)
  const [body, setBody] = useState(rule.body)
  const [editRevision, setEditRevision] = useState(rule.revision ?? 0)
  const [history, setHistory] = useState(false)
  const path = `${roomPath(roomId)}/rules/${encodeURIComponent(rule.id)}`
  const versions = useRoomResource<{ versions: RoomRule[] }>(
    roomId,
    history ? path + '/versions' : null
  )
  const mutation = useRoomMutation(onUpdated)
  const update = (patch: { body?: string; active?: boolean }) => {
    const expectedRevision =
      patch.body !== undefined ? editRevision : (rule.revision ?? 0)
    return mutation.run(
      `${rule.id}:${expectedRevision}:${JSON.stringify(patch)}`,
      (clientRequestId) =>
        roomsRequest(path, 'PATCH', {
          clientRequestId,
          expectedRevision,
          ...patch
        })
    )
  }
  return (
    <article className="space-y-2 rounded-lg border border-ds-border p-3">
      <div className="text-xs text-ds-muted">
        v{rule.version} ·{' '}
        {t(rule.active === false ? 'roomsDisabled' : 'roomsEnabled')}
      </div>
      {editing ? (
        <textarea
          aria-label={t('roomsEditAgreement')}
          className={roomFieldClass}
          rows={3}
          value={body}
          maxLength={16000}
          onChange={(event) => setBody(event.target.value)}
        />
      ) : (
        <p className="whitespace-pre-wrap break-words text-sm text-ds-ink">
          {rule.body}
        </p>
      )}
      <div className="flex flex-wrap gap-2">
        {editing ? (
          <button
            className={roomButtonClass}
            disabled={mutation.busy || !body.trim()}
            onClick={() =>
              void update({ body }).then((ok) => {
                if (ok) setEditing(false)
              })
            }
          >
            {t('roomsSave')}
          </button>
        ) : (
          <button
            className={roomButtonClass}
            onClick={() => {
              setBody(rule.body)
              setEditRevision(rule.revision ?? 0)
              setEditing(true)
            }}
          >
            {t('roomsEditAgreement')}
          </button>
        )}
        {editing ? (
          <button
            className={roomButtonClass}
            disabled={mutation.busy}
            onClick={() => setEditing(false)}
          >
            {t('roomsCancel')}
          </button>
        ) : null}
        <button
          className={roomButtonClass}
          disabled={mutation.busy}
          onClick={() => void update({ active: rule.active === false })}
        >
          {t(rule.active === false ? 'roomsEnable' : 'roomsDisable')}
        </button>
        <button
          className={roomButtonClass}
          onClick={() => setHistory(!history)}
        >
          {t('roomsHistory')}
        </button>
      </div>
      <RoomRuleTaskUpdate roomId={roomId} rule={rule} onUpdated={onUpdated} />
      {mutation.error || versions.error ? (
        <p role="alert" className="text-xs text-red-500">
          {mutation.error || versions.error}
        </p>
      ) : null}
      {history ? (
        <div className="max-h-60 space-y-2 overflow-auto">
          {versions.data?.versions.map((version) => (
            <p
              key={version.version}
              className="whitespace-pre-wrap break-words border-t border-ds-border pt-2 text-xs text-ds-muted"
            >
              v{version.version} ·{' '}
              {t(version.active === false ? 'roomsDisabled' : 'roomsEnabled')} ·{' '}
              {version.body}
            </p>
          ))}
        </div>
      ) : null}
    </article>
  )
}

export function RoomOverview({
  room,
  rules,
  onUpdated,
  onTask,
  onMessage
}: {
  room: Room
  rules: RoomRule[]
  onUpdated: () => Promise<void>
  onTask: (id: string) => void
  onMessage: (id: string) => void
}) {
  const { t } = useTranslation('common')
  const [section, setSection] = useState<'requests' | 'rules' | null>(null)
  const resource = useRoomResource<{ requests: RoomRequestEntry[] }>(
    room.id,
    `${roomPath(room.id)}/requests`
  )
  const mutation = useRoomMutation(async () => {
    await resource.refresh()
    await onUpdated()
  })
  const requests = resource.data?.requests ?? []
  const attention = requests.filter(
    (request) =>
      ['failed', 'needs_input'].includes(request.status) ||
      request.outcome?.status === 'needs_attention'
  ).length
  return (
    <section className="shrink-0 border-b border-ds-border">
      <div className="flex gap-4 px-4 py-2 text-xs text-ds-muted">
        <button
          aria-expanded={section === 'requests'}
          onClick={() => setSection(section === 'requests' ? null : 'requests')}
        >
          {t('roomsRequests')} ({requests.length})
          {attention ? ` · ${t('roomsAttention')} ${attention}` : ''}
        </button>
        <button
          aria-expanded={section === 'rules'}
          onClick={() => setSection(section === 'rules' ? null : 'rules')}
        >
          {t('roomsRules')} (
          {rules.filter((rule) => rule.active !== false).length})
        </button>
      </div>
      {section ? (
        <div className="max-h-72 space-y-3 overflow-auto px-4 pb-3">
          {section === 'rules' ? (
            <>
              <p className="text-xs text-ds-muted">
                {t('roomsRuleVersionHint')}
              </p>
              {rules.map((rule) => (
                <RuleEditor
                  key={rule.id}
                  roomId={room.id}
                  rule={rule}
                  onUpdated={onUpdated}
                />
              ))}
            </>
          ) : (
            requests.map((request) => (
              <article
                key={request.id}
                className="space-y-2 rounded-lg border border-ds-border p-3"
              >
                <button
                  className="line-clamp-2 text-left text-sm font-medium text-ds-ink"
                  onClick={() => onMessage(request.sourceMessageId)}
                >
                  {request.message.body}
                </button>
                <p className="text-xs text-ds-muted">
                  {t(`roomsState_${request.outcome?.status ?? request.status}`)}
                  {request.outcome
                    ? ` · ${request.outcome.completed}/${request.outcome.total} ${t('roomsState_completed')} · ${request.outcome.delivered} ${t('roomsDelivery')}`
                    : ''}
                </p>
                {request.outcome?.summary ? (
                  <p className="whitespace-pre-wrap text-xs text-ds-muted">
                    {request.outcome.summary}
                  </p>
                ) : null}
                {request.error ? (
                  <p className="whitespace-pre-wrap break-words text-xs text-red-500">
                    {request.error}
                  </p>
                ) : null}
                <div className="flex flex-wrap gap-2">
                  {request.outcome?.taskIds.map((id, index) => (
                    <button
                      key={id}
                      className={roomButtonClass}
                      onClick={() => onTask(id)}
                    >
                      {t('roomsDetails')} {index + 1}
                    </button>
                  ))}
                  {['failed', 'needs_input'].includes(request.status) ? (
                    <button
                      className={roomButtonClass}
                      disabled={mutation.busy}
                      onClick={() =>
                        void mutation.run(
                          `${request.id}:${request.revision}`,
                          (clientRequestId) =>
                            roomsRequest(
                              `${roomPath(room.id)}/requests/${encodeURIComponent(request.id)}/retry`,
                              'POST',
                              {
                                clientRequestId,
                                expectedRevision: request.revision
                              }
                            )
                        )
                      }
                    >
                      {t('roomsRetryCoordination')}
                    </button>
                  ) : null}
                </div>
              </article>
            ))
          )}
          {resource.error || mutation.error ? (
            <p role="alert" className="text-xs text-red-500">
              {resource.error || mutation.error}
            </p>
          ) : null}
        </div>
      ) : null}
    </section>
  )
}
