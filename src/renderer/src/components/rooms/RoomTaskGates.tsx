import { RoomApprovalCard } from './RoomApprovalCard'
import { lazy, Suspense, useState } from 'react'
import { currentRemoteSurface } from '../../mobile/use-remote-surface'
import { useTranslation } from 'react-i18next'
import type { RoomRecoveryInfo, RoomTask } from '@shared/rooms-api'
import {
  roomsRequest,
  roomTaskPath,
  type RoomTaskDetail,
  type RoomUserInput
} from './rooms-client'
import { roomInputAnswers, submitRoomUserInput } from './RoomChoiceCard'
import { roomButtonClass, roomFieldClass } from './RoomSettings'
import { useRoomMutation, useRoomResource } from './useRoomResource'

export { roomInputAnswers } from './RoomChoiceCard'

const MobileRoomUserInput = lazy(() => import('../../mobile/rooms/MobileRoomUserInput').then((module) => ({
  default: module.MobileRoomUserInput
})))

function RoomInputForm({
  input,
  onUpdated
}: {
  input: RoomUserInput
  onUpdated: () => Promise<void>
}) {
  const { t } = useTranslation('common')
  const [selected, setSelected] = useState<Record<string, string[]>>({})
  const [freeform, setFreeform] = useState<Record<string, string>>({})
  const mutation = useRoomMutation(onUpdated)
  const answers = roomInputAnswers(input, selected, freeform)
  const valid = input.questions.every((question, index) => {
    const count =
      (selected[question.id]?.length ?? 0) +
      (freeform[question.id]?.trim() ? 1 : 0)
    return (
      Boolean(answers[index].value) &&
      count >= (question.minSelections ?? 1) &&
      count <=
        (question.maxSelections ??
          (question.selectionMode === 'multiple' ? Infinity : 1))
    )
  })
  const submit = (cancelled = false) =>
    mutation.run(
      `${input.id}:${cancelled ? 'cancel' : JSON.stringify(answers)}`,
      () =>
        submitRoomUserInput(input.id, cancelled ? { cancelled: true } : { answers })
    )
  return (
    <form
      className="space-y-3 rounded-lg border border-amber-500/40 p-3"
      onSubmit={(event) => {
        event.preventDefault()
        if (valid) void submit()
      }}
    >
      <p className="whitespace-pre-wrap text-sm text-ds-ink">{input.prompt}</p>
      {input.questions.map((question) => (
        <fieldset
          key={question.id}
          disabled={mutation.busy}
          className="space-y-2"
        >
          <legend className="mb-2 text-sm font-medium text-ds-ink">
            {question.question}
          </legend>
          {question.options.map((option) => (
            <label
              key={option.label}
              className="flex items-start gap-2 text-sm text-ds-ink"
            >
              <input
                type={
                  question.selectionMode === 'multiple' ? 'checkbox' : 'radio'
                }
                name={question.id}
                checked={selected[question.id]?.includes(option.label) ?? false}
                onChange={(event) => {
                  setSelected((current) => ({
                    ...current,
                    [question.id]:
                      question.selectionMode === 'multiple'
                        ? event.target.checked
                          ? [...(current[question.id] ?? []), option.label]
                          : (current[question.id] ?? []).filter(
                              (value) => value !== option.label
                            )
                        : [option.label]
                  }))
                  if (question.selectionMode !== 'multiple')
                    setFreeform((current) => ({
                      ...current,
                      [question.id]: ''
                    }))
                }}
              />
              <span>
                {option.label}
                <span className="block text-xs text-ds-muted">
                  {option.description}
                </span>
              </span>
            </label>
          ))}
          <input
            className={roomFieldClass}
            aria-label={`${question.question} · ${t('roomsOtherAnswer')}`}
            placeholder={t('roomsOtherAnswer')}
            value={freeform[question.id] ?? ''}
            onChange={(event) => {
              setFreeform((current) => ({
                ...current,
                [question.id]: event.target.value
              }))
              if (question.selectionMode !== 'multiple')
                setSelected((current) => ({ ...current, [question.id]: [] }))
            }}
          />
        </fieldset>
      ))}
      {mutation.error ? (
        <p role="alert" className="text-xs text-red-500">
          {mutation.error}
        </p>
      ) : null}
      <div className="flex gap-2">
        <button
          type="submit"
          className={roomButtonClass}
          disabled={mutation.busy || !valid}
        >
          {t('roomsSubmitAnswer')}
        </button>
        <button
          type="button"
          className={roomButtonClass}
          disabled={mutation.busy}
          onClick={() => void submit(true)}
        >
          {t('roomsCancel')}
        </button>
      </div>
    </form>
  )
}

export function RoomExecutionGates({
  detail,
  onUpdated
}: {
  detail: Pick<RoomTaskDetail, 'approvals' | 'userInputs'> | null
  onUpdated: () => Promise<void>
}) {
  const { t } = useTranslation('common')
  const mutation = useRoomMutation(onUpdated)
  return (
    <div className="space-y-3">
      {detail?.approvals?.map((approval) => <RoomApprovalCard key={approval.id} approval={approval} onUpdated={onUpdated} />)}
      {detail?.userInputs?.map((input) => currentRemoteSurface() === 'mobile' ? (
        <Suspense key={input.id} fallback={<p role="status">{t('roomsLoading')}</p>}>
          <MobileRoomUserInput input={input} onUpdated={onUpdated} />
        </Suspense>
      ) : <RoomInputForm key={input.id} input={input} onUpdated={onUpdated} />)}
      {mutation.error ? (
        <p role="alert" className="text-xs text-red-500">
          {mutation.error}
        </p>
      ) : null}
    </div>
  )
}

export function RoomTaskGates({
  task,
  detail,
  onUpdated
}: {
  task: RoomTask
  detail: RoomTaskDetail | null
  onUpdated: () => Promise<void>
}) {
  const { t } = useTranslation('common')
  const mutation = useRoomMutation(onUpdated)
  const showRecovery = task.status === 'recovery_required'
  const canInspect =
    showRecovery ||
    ['completed', 'awaiting_acceptance', 'failed', 'cancelled'].includes(
      task.status
    )
  const recovery = useRoomResource<RoomRecoveryInfo>(
    task.roomId,
    canInspect ? roomTaskPath(task) + '/recovery' : null
  )
  const recover = (action: 'reconcile' | 'retry' | 'abandon') =>
    mutation.run(
      `${task.id}:${task.revision}:${action}`,
      async (clientRequestId) => {
        if (
          action === 'abandon' &&
          !(await window.kunGui.confirmDialog({
            message: t('roomsAbandonConfirm'),
            detail: t('roomsAbandonDetail'),
            confirmLabel: t('roomsAbandon')
          }))
        )
          return
        await roomsRequest(roomTaskPath(task) + '/recover', 'POST', {
          clientRequestId,
          expectedRevision: task.revision,
          action
        })
        await recovery.refresh()
      }
    )
  return (
    <div className="space-y-3">
      <RoomExecutionGates detail={detail} onUpdated={onUpdated} />
      {canInspect && task.applicationStatus !== 'applied' ? (
        <section className="space-y-2 rounded-lg border border-amber-500/40 p-3">
          <h4 className="text-sm font-medium text-ds-ink">
            {t(showRecovery ? 'roomsRecovery' : 'roomsAbandon')}
          </h4>
          <p className="whitespace-pre-wrap break-words text-xs text-ds-muted">
            {recovery.data?.reason ?? t('roomsLoading')}
          </p>
          {recovery.data ? (
            <p className="break-all text-xs text-ds-faint">
              {recovery.data.threadId} / {recovery.data.turnId} ·{' '}
              {recovery.data.observedAt}
            </p>
          ) : null}
          <div className="flex flex-wrap gap-2">
            {showRecovery ? (
              <>
                <button
                  className={roomButtonClass}
                  disabled={mutation.busy}
                  onClick={() => void recover('reconcile')}
                >
                  {t('roomsReconcile')}
                </button>
                <button
                  className={roomButtonClass}
                  disabled={mutation.busy || !recovery.data?.canRetry}
                  onClick={() => void recover('retry')}
                >
                  {t('roomsRetry')}
                </button>
              </>
            ) : null}
            <button
              className={roomButtonClass}
              disabled={mutation.busy || !recovery.data?.canAbandon}
              onClick={() => void recover('abandon')}
            >
              {t('roomsAbandon')}
            </button>
          </div>
        </section>
      ) : null}
      {mutation.error || recovery.error ? (
        <p role="alert" className="text-xs text-red-500">
          {mutation.error || recovery.error}
        </p>
      ) : null}
    </div>
  )
}
