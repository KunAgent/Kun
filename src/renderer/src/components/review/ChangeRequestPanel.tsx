import { useCallback, useEffect, useState, type ReactElement } from 'react'
import {
  CircleAlert,
  CircleCheck,
  CircleDashed,
  GitPullRequest,
  Loader2,
  RefreshCw
} from 'lucide-react'
import { useTranslation } from 'react-i18next'
import type {
  ChangeRequestCheck,
  ChangeRequestStatus,
  TaskWorkspaceRecord
} from '@shared/task-workspace'
import { getProvider } from '../../agent/registry'

const REFRESH_MS = 60_000

function checkIcon(check: ChangeRequestCheck): ReactElement {
  if (check.status !== 'completed') {
    return <CircleDashed className="h-3.5 w-3.5 text-ds-faint" strokeWidth={1.8} />
  }
  return check.conclusion === 'success'
    ? <CircleCheck className="h-3.5 w-3.5 text-emerald-600 dark:text-emerald-400" strokeWidth={1.8} />
    : <CircleAlert className="h-3.5 w-3.5 text-red-600 dark:text-red-400" strokeWidth={1.8} />
}

function formatDuration(ms: number | undefined): string {
  if (ms === undefined) return ''
  const seconds = Math.round(ms / 1000)
  if (seconds < 60) return `${seconds}s`
  return `${Math.floor(seconds / 60)}m ${seconds % 60}s`
}

/**
 * Forge change-request strip inside the review panel (docs/ade/11 §7.2):
 * PR title/state, CI check list, and a one-click "send the failed check
 * back to the worker" action. Polls `gh` every 60s only while a request
 * exists and the panel is mounted.
 */
export function ChangeRequestPanel({
  binding
}: {
  binding: TaskWorkspaceRecord
}): ReactElement | null {
  const { t } = useTranslation('common')
  const workspaceId = binding.workspaceId
  const [status, setStatus] = useState<ChangeRequestStatus | null>(null)
  const [pending, setPending] = useState<'create' | string | null>(null)
  const [sendNote, setSendNote] = useState<string | null>(null)

  const refresh = useCallback((): void => {
    const provider = getProvider()
    if (!provider.getChangeRequest) return
    void provider.getChangeRequest(workspaceId)
      .then(setStatus)
      .catch(() => undefined)
  }, [workspaceId])

  useEffect(() => refresh(), [refresh])

  const request = status?.request ?? binding.changeRequest

  // Poll only while a request exists AND the panel is mounted — closing
  // the panel stops `gh` calls entirely (11 §7.2).
  const hasRequest = request !== undefined
  useEffect(() => {
    if (!hasRequest) return
    const timer = setInterval(refresh, REFRESH_MS)
    return () => clearInterval(timer)
  }, [hasRequest, refresh])

  if (!status && !request) return null

  const failed = (request?.checks ?? []).filter(
    (check) => check.conclusion === 'failure'
      || check.conclusion === 'timed_out'
      || check.conclusion === 'action_required'
  )
  const unavailableReason = !status?.available ? status?.reason : undefined

  const createRequest = (): void => {
    const provider = getProvider()
    if (!provider.createChangeRequest) return
    setPending('create')
    void provider.createChangeRequest(workspaceId, {})
      .then(() => refresh())
      .catch(() => undefined)
      .finally(() => setPending(null))
  }

  const sendBackCheck = (check: ChangeRequestCheck): void => {
    const provider = getProvider()
    if (!binding.unitId || !provider.sendReview) return
    setPending(check.name)
    const note = t('reviewCrCheckSendBackNote', {
      name: check.name,
      conclusion: check.conclusion ?? 'failure',
      number: request?.number ?? 0
    })
    void provider.sendReview(workspaceId, {
      commentIds: [],
      target: { kind: 'worker', workerId: binding.unitId },
      note
    })
      .then(() => setSendNote(check.name))
      .catch(() => undefined)
      .finally(() => setPending(null))
  }

  return (
    <div
      className="shrink-0 border-b border-ds-border-muted px-3 py-1.5 text-[11.5px]"
      data-testid="change-request-panel"
    >
      {request ? (
        <div className="flex items-center gap-2">
          <GitPullRequest className="h-3.5 w-3.5 shrink-0 text-ds-faint" strokeWidth={1.8} />
          <a
            href={request.url}
            onClick={(event) => {
              event.preventDefault()
              void window.kunGui?.openExternal?.(request.url)
            }}
            className="min-w-0 flex-1 truncate text-ds-ink hover:underline"
          >
            #{request.number} {request.title}
          </a>
          <span className={`shrink-0 rounded-full px-1.5 py-0.5 text-[10.5px] ${
            request.state === 'open'
              ? 'bg-emerald-500/15 text-emerald-600 dark:text-emerald-400'
              : request.state === 'merged'
                ? 'bg-violet-500/15 text-violet-600 dark:text-violet-400'
                : 'bg-ds-hover text-ds-muted'
          }`}>
            {request.isDraft ? t('reviewCrDraft') : t(`reviewCr_${request.state}`)}
          </span>
          {status?.available ? (
            <button
              type="button"
              onClick={refresh}
              aria-label={t('reviewCrRefresh')}
              title={t('reviewCrRefresh')}
              className="inline-flex h-6 w-6 shrink-0 items-center justify-center rounded-[6px] text-ds-faint hover:bg-ds-hover hover:text-ds-ink"
            >
              <RefreshCw className="h-3 w-3" strokeWidth={1.8} />
            </button>
          ) : null}
        </div>
      ) : (
        <div className="flex items-center gap-2">
          <GitPullRequest className="h-3.5 w-3.5 shrink-0 text-ds-faint" strokeWidth={1.8} />
          <span className="min-w-0 flex-1 text-ds-muted">
            {unavailableReason
              ? t(`reviewCrUnavailable_${unavailableReason}`)
              : status === null
                ? t('reviewLoading')
                : t('reviewCrNone')}
          </span>
          <button
            type="button"
            onClick={createRequest}
            disabled={pending !== null || status?.available !== true}
            title={unavailableReason ? t(`reviewCrUnavailable_${unavailableReason}`) : undefined}
            className="inline-flex h-7 shrink-0 items-center gap-1.5 rounded-[7px] border border-ds-border-muted px-2.5 font-medium text-ds-muted hover:text-ds-ink disabled:cursor-not-allowed disabled:opacity-50"
          >
            {pending === 'create'
              ? <Loader2 className="h-3.5 w-3.5 animate-spin" strokeWidth={1.8} />
              : null}
            {t('reviewCrCreate')}
          </button>
        </div>
      )}

      {request && request.checks.length ? (
        <div className="mt-1 space-y-0.5">
          <div className="text-[10.5px] text-ds-faint">
            {failed.length
              ? t('reviewCrChecksFailed', { count: failed.length })
              : t('reviewCrChecksPassing')}
          </div>
          {request.checks.map((check) => (
            <div key={check.name} className="flex items-center gap-1.5">
              {checkIcon(check)}
              <span className="min-w-0 flex-1 truncate text-ds-muted">{check.name}</span>
              <span className="shrink-0 text-[10.5px] text-ds-faint">
                {formatDuration(check.durationMs)}
              </span>
              {failed.includes(check) && binding.unitId ? (
                <button
                  type="button"
                  onClick={() => sendBackCheck(check)}
                  disabled={pending !== null}
                  className="shrink-0 rounded border border-ds-border-muted px-1.5 py-0.5 text-[10.5px] text-ds-muted hover:text-ds-ink disabled:opacity-50"
                >
                  {pending === check.name
                    ? <Loader2 className="inline h-3 w-3 animate-spin" strokeWidth={1.8} />
                    : null}
                  {sendNote === check.name ? t('reviewCrSent') : t('reviewCrSendBack')}
                </button>
              ) : null}
            </div>
          ))}
        </div>
      ) : null}
    </div>
  )
}
