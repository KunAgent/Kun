import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import type {
  RoomCleanupPreview,
  RoomIntegration,
  RoomTask
} from '@shared/rooms-api'
import { roomsRequest, roomTaskPath, type RoomTaskDetail } from './rooms-client'
import { RoomExecutionGates } from './RoomTaskGates'
type IntegrationDetail = RoomIntegration &
  Pick<RoomTaskDetail, 'approvals' | 'userInputs'>
import { roomButtonClass, roomFieldClass } from './RoomSettings'
import { useRoomMutation, useRoomResource } from './useRoomResource'

export function RoomIntegrationPanel({
  task,
  onUpdated,
  onOpenThread
}: {
  task: RoomTask
  onUpdated: () => Promise<void>
  onOpenThread: (id: string) => void
}) {
  const { t } = useTranslation('common')
  const [commands, setCommands] = useState('')
  const [preview, setPreview] = useState(false)
  const [confirmed, setConfirmed] = useState<Record<string, boolean>>({})
  const path = roomTaskPath(task)
  const resource = useRoomResource<{ integrations: IntegrationDetail[] }>(
    task.roomId,
    path + '/integrations'
  )
  const cleanup = useRoomResource<RoomCleanupPreview>(
    task.roomId,
    preview ? path + '/cleanup' : null
  )
  const refresh = async () => {
    await resource.refresh()
    await cleanup.refresh()
    await onUpdated()
  }
  const mutation = useRoomMutation(refresh)
  const prepare = () =>
    mutation.run(
      `${task.id}:${task.revision}:prepare:${commands}`,
      (clientRequestId) =>
        roomsRequest(path + '/integrations', 'POST', {
          clientRequestId,
          expectedRevision: task.revision,
          ...(commands.trim()
            ? {
                validationCommands: commands
                  .split('\n')
                  .map((command) => command.trim())
                  .filter(Boolean)
              }
            : {})
        })
    )
  const act = (
    integration: RoomIntegration,
    action: 'resolve' | 'apply' | 'cancel' | 'open' | 'validate'
  ) =>
    mutation.run(
      `${integration.id}:${integration.revision}:${action}:${commands}`,
      async (clientRequestId) => {
        const result = await roomsRequest<{ integration: RoomIntegration }>(
          `${path}/integrations/${encodeURIComponent(integration.id)}/${action}`,
          'POST',
          {
            clientRequestId,
            expectedRevision: integration.revision ?? 0,
            confirmUnverified: Boolean(confirmed[integration.id]),
            ...(['resolve', 'validate'].includes(action) && commands.trim()
              ? {
                  validationCommands: commands
                    .split('\n')
                    .map((command) => command.trim())
                    .filter(Boolean)
                }
              : {})
          }
        )
        if (action === 'open' && result.integration.threadId)
          onOpenThread(result.integration.threadId)
      }
    )
  const clean = () => {
    const value = cleanup.data
    if (!value?.eligible) return
    void mutation.run(
      `${task.id}:${value.token}:cleanup`,
      async (clientRequestId) => {
        if (
          !(await window.kunGui.confirmDialog({
            message: t('roomsCleanupConfirm'),
            detail: value.paths.map((item) => item.path).join('\n'),
            confirmLabel: t('roomsCleanup')
          }))
        )
          return
        await roomsRequest(path + '/cleanup', 'POST', {
          clientRequestId,
          expectedRevision: value.revision,
          token: value.token
        })
      }
    )
  }
  return (
    <section className="space-y-3 border-t border-ds-border pt-4">
      <h4 className="font-medium text-ds-ink">{t('roomsIntegration')}</h4>
      <p className="text-xs text-ds-muted">{t('roomsIntegrationHint')}</p>
      <label className="block text-xs text-ds-muted">
        {t('roomsValidationCommands')}
        <textarea
          className={roomFieldClass}
          rows={2}
          value={commands}
          onChange={(event) => setCommands(event.target.value)}
          placeholder={t('roomsValidationCommandsHint')}
        />
      </label>
      <button
        className={roomButtonClass}
        disabled={
          mutation.busy ||
          !task.latestDeliveryId ||
          [
            'running',
            'queued',
            'needs_input',
            'needs_approval',
            'stopping'
          ].includes(task.status)
        }
        onClick={() => void prepare()}
      >
        {t('roomsPrepareIntegration')}
      </button>
      {resource.data?.integrations.map((integration) => (
        <article
          key={integration.id}
          className="space-y-2 rounded-lg border border-ds-border p-3"
        >
          <p className="text-sm text-ds-ink">
            {t(`roomsState_${integration.status}`)} ·{' '}
            {new Date(integration.createdAt).toLocaleString()}
          </p>
          <p className="break-all text-xs text-ds-muted">
            {integration.targetSha.slice(0, 12)} +{' '}
            {integration.sourceSha.slice(0, 12)} →{' '}
            {integration.candidateSha?.slice(0, 12) ?? '…'}
          </p>
          <p className="break-all font-mono text-xs text-ds-muted">
            {integration.path}
          </p>
          {integration.deliveryId !== task.latestDeliveryId ? (
            <p className="text-xs text-amber-600">
              {t('roomsIntegrationStale')}
            </p>
          ) : null}
          {integration.conflicts.length ? (
            <pre className="whitespace-pre-wrap text-xs text-amber-600">
              {integration.conflicts.join('\n')}
            </pre>
          ) : null}
          {integration.error ? (
            <p className="break-words text-xs text-red-500">
              {integration.error}
            </p>
          ) : null}
          <RoomExecutionGates detail={integration} onUpdated={refresh} />
          {integration.validation.map((check, index) => (
            <details key={index} className="text-xs text-ds-muted">
              <summary>
                {check.command} · {check.exitCode ?? '—'}
              </summary>
              <pre className="max-h-40 overflow-auto whitespace-pre-wrap">
                {check.output}
              </pre>
            </details>
          ))}
          {integration.review ? (
            <div className="text-xs text-ds-muted">
              <p>
                {t('roomsReviewResults')} ·{' '}
                {t(`roomsState_${integration.review.verdict}`)} ·{' '}
                {integration.review.versionHash.slice(0, 12)}
              </p>
              <pre className="max-h-40 overflow-auto whitespace-pre-wrap">
                {JSON.stringify(integration.review.findings, null, 2)}
              </pre>
            </div>
          ) : null}
          <details className="text-xs text-ds-muted">
            <summary>{t('roomsDiff')}</summary>
            <pre className="max-h-80 overflow-auto">
              {integration.diff || t('roomsNoDiff')}
            </pre>
          </details>
          {integration.candidates && integration.candidates.length > 1 ? (
            <details className="text-xs text-ds-muted">
              <summary>{t('roomsHistory')}</summary>
              {integration.candidates.map((candidate) => (
                <div
                  key={candidate.pinId}
                  className="mt-2 border-t border-ds-border pt-2"
                >
                  <code>{candidate.sha}</code>
                  <p>{candidate.createdAt}</p>
                  <pre className="max-h-40 overflow-auto">{candidate.diff}</pre>
                </div>
              ))}
            </details>
          ) : null}
          {integration.status === 'ready' && !integration.validation.length ? (
            <label className="flex items-start gap-2 text-xs text-amber-600">
              <input
                type="checkbox"
                checked={Boolean(confirmed[integration.id])}
                onChange={(event) =>
                  setConfirmed((current) => ({
                    ...current,
                    [integration.id]: event.target.checked
                  }))
                }
              />
              {t('roomsConfirmUnverified')}
            </label>
          ) : null}
          <div className="flex flex-wrap gap-2">
            {['conflict', 'failed'].includes(integration.status) ? (
              <>
                <button
                  className={roomButtonClass}
                  disabled={mutation.busy}
                  onClick={() => void act(integration, 'open')}
                >
                  {t('roomsEditIntegration')}
                </button>
                <button
                  className={roomButtonClass}
                  disabled={mutation.busy}
                  onClick={() => void act(integration, 'validate')}
                >
                  {t('roomsRevalidateIntegration')}
                </button>
              </>
            ) : null}
            {integration.threadId ? (
              <button
                className={roomButtonClass}
                onClick={() => onOpenThread(integration.threadId!)}
              >
                {t('roomsOpenCode')}
              </button>
            ) : null}
            {['conflict', 'failed'].includes(integration.status) ? (
              <button
                className={roomButtonClass}
                disabled={mutation.busy}
                onClick={() => void act(integration, 'resolve')}
              >
                {t('roomsResolveIntegration')}
              </button>
            ) : null}
            {['preparing', 'validating', 'recovery_required'].includes(
              integration.status
            ) ||
            (integration.status === 'failed' && integration.threadId) ? (
              <button
                className={roomButtonClass}
                disabled={mutation.busy}
                onClick={() => void act(integration, 'cancel')}
              >
                {t('roomsStop')}
              </button>
            ) : null}
            {integration.status === 'ready' ? (
              <button
                className={roomButtonClass}
                disabled={
                  mutation.busy ||
                  integration.deliveryId !== task.latestDeliveryId ||
                  (!integration.validation.length &&
                    !confirmed[integration.id]) ||
                  integration.validation.some(
                    (check) => check.exitCode !== 0
                  ) ||
                  Boolean(
                    integration.review &&
                    (integration.review.verdict !== 'passed' ||
                      integration.review.versionHash !==
                        integration.candidateSha)
                  )
                }
                onClick={() => void act(integration, 'apply')}
              >
                {t('roomsApplyIntegration')}
              </button>
            ) : null}
          </div>
        </article>
      ))}
      <button className={roomButtonClass} onClick={() => setPreview(!preview)}>
        {t('roomsCleanupPreview')}
      </button>
      {preview && cleanup.data ? (
        <div className="space-y-2 text-xs text-ds-muted">
          <p>{cleanup.data.reason ?? t('roomsCleanupReady')}</p>
          {cleanup.data.paths.map((item) => (
            <p key={item.path} className="break-all">
              {item.path} · {(item.bytes / 1024 / 1024).toFixed(1)} MB
            </p>
          ))}
          <button
            className={roomButtonClass}
            disabled={mutation.busy || !cleanup.data.eligible}
            onClick={clean}
          >
            {t('roomsCleanup')}
          </button>
        </div>
      ) : null}
      {mutation.error || resource.error || cleanup.error ? (
        <p role="alert" className="text-xs text-red-500">
          {mutation.error || resource.error || cleanup.error}
        </p>
      ) : null}
    </section>
  )
}
