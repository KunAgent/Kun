import { useCallback, useEffect, useState, type ReactElement } from 'react'
import { createPortal } from 'react-dom'
import { Loader2, RefreshCw, Swords, Trophy, X } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import type {
  AdeRaceCompareContender,
  AdeRaceComparison
} from '@shared/ade-teams'
import { getProvider } from '../../agent/registry'
import { useChatStore } from '../../store/chat-store'
import { ensureThreadBinding } from '../../store/review-store'

const POLL_MS = 10_000

function formatDuration(durationMs: number | undefined): string {
  if (durationMs === undefined) return '—'
  const seconds = Math.round(durationMs / 1000)
  if (seconds < 60) return `${seconds}s`
  const minutes = Math.floor(seconds / 60)
  return minutes < 60 ? `${minutes}m ${seconds % 60}s` : `${Math.floor(minutes / 60)}h ${minutes % 60}m`
}

function formatUsage(contender: AdeRaceCompareContender): string {
  const usage = contender.usage
  if (!usage) return '—'
  const cost = usage.costUsd ?? usage.valueEstimateUsd
  const costText = cost !== undefined ? ` · ~$${cost.toFixed(4)}` : ''
  return `${usage.totalTokens.toLocaleString()} tok${costText}`
}

function stateKey(contender: AdeRaceCompareContender): string {
  if (contender.createError) return 'create_failed'
  if (contender.timedOut) return 'timed_out'
  return contender.dispatchState ?? 'pending'
}

/**
 * Same-task race comparison (docs/ade/11 §5): one column per contender with
 * execution state, verdict, diff stats, checks, worker report, duration and
 * usage; the user picks the winner here — the manager's notes are advisory.
 */
export function RaceCompareView({
  raceId,
  onClose
}: {
  raceId: string
  onClose: () => void
}): ReactElement | null {
  const { t } = useTranslation('common')
  const [comparison, setComparison] = useState<AdeRaceComparison | null>(null)
  const [error, setError] = useState<string | undefined>()
  const [pending, setPending] = useState<'decide' | 'discard' | null>(null)
  const [confirmDiscard, setConfirmDiscard] = useState(false)

  const reload = useCallback(async () => {
    const provider = getProvider()
    if (!provider.getRaceComparison) return
    try {
      setComparison(await provider.getRaceComparison(raceId))
      setError(undefined)
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause))
    }
  }, [raceId])

  useEffect(() => {
    void reload()
  }, [reload])

  // Poll while the race is still running so state/badge updates appear live.
  useEffect(() => {
    if (comparison?.race.state !== 'running') return
    const timer = setInterval(() => void reload(), POLL_MS)
    return () => clearInterval(timer)
  }, [comparison?.race.state, reload])

  const openWorkspace = (contender: AdeRaceCompareContender): void => {
    if (contender.workerId) {
      void useChatStore.getState().selectThread(contender.workerId)
      void ensureThreadBinding(contender.workerId)
    }
  }

  // Decide is user-only; the winner enters the normal review/integrate flow.
  const decide = async (contender: AdeRaceCompareContender): Promise<void> => {
    const provider = getProvider()
    if (!provider.decideRace || !contender.dispatchId) return
    setPending('decide')
    try {
      await provider.decideRace(raceId, contender.dispatchId)
      await reload()
      openWorkspace(contender)
    } finally {
      setPending(null)
    }
  }

  const discardOthers = async (): Promise<void> => {
    const provider = getProvider()
    if (!provider.discardRaceOthers) return
    setPending('discard')
    try {
      await provider.discardRaceOthers(raceId)
      setConfirmDiscard(false)
      await reload()
    } finally {
      setPending(null)
    }
  }

  if (typeof document === 'undefined') return null
  const race = comparison?.race
  const contenders = comparison?.contenders ?? []
  const losers = race?.winnerDispatchId
    ? contenders.filter((entry) => entry.dispatchId !== race.winnerDispatchId)
    : []

  return createPortal(
    <div
      className="fixed inset-0 z-[1000] flex items-center justify-center bg-black/35"
      role="dialog"
      aria-label={t('raceCompareTitle')}
    >
      <div className="flex max-h-[85vh] w-[min(980px,92vw)] flex-col rounded-[12px] border border-ds-border bg-white shadow-xl dark:bg-ds-card">
        <div className="flex h-11 shrink-0 items-center gap-2 border-b border-ds-border-muted px-4">
          <Swords className="h-4 w-4 shrink-0 text-ds-faint" strokeWidth={1.8} />
          <span className="min-w-0 flex-1 truncate text-[13px] font-semibold text-ds-ink">
            {race?.label ?? raceId}
          </span>
          {race ? (
            <span className="shrink-0 rounded-full bg-ds-hover px-2 py-0.5 text-[10.5px] text-ds-muted">
              {t(`raceState.${race.state}`)}
            </span>
          ) : null}
          {race?.startSha ? (
            <span className="shrink-0 font-mono text-[10.5px] text-ds-faint">
              @{race.startSha.slice(0, 8)}
            </span>
          ) : null}
          <button
            type="button"
            onClick={() => void reload()}
            aria-label={t('raceRefresh')}
            title={t('raceRefresh')}
            className="inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-[7px] text-ds-faint hover:bg-ds-hover hover:text-ds-ink"
          >
            <RefreshCw className="h-3.5 w-3.5" strokeWidth={1.8} />
          </button>
          <button
            type="button"
            onClick={onClose}
            aria-label={t('raceClose')}
            className="inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-[7px] text-ds-faint hover:bg-ds-hover hover:text-ds-ink"
          >
            <X className="h-3.5 w-3.5" strokeWidth={1.8} />
          </button>
        </div>

        <div className="min-h-0 flex-1 overflow-auto px-4 py-3">
          {error ? <p className="py-6 text-center text-[12px] text-ds-error">{error}</p> : null}
          {!error && !comparison ? (
            <p className="flex items-center justify-center gap-2 py-6 text-[12px] text-ds-muted">
              <Loader2 className="h-3.5 w-3.5 animate-spin" strokeWidth={1.8} />
              {t('raceLoading')}
            </p>
          ) : null}
          {comparison ? (
            <table className="w-full border-collapse text-left">
              <tbody>
                <tr>
                  <th className="w-28 pr-2 align-top text-[11px] font-medium text-ds-faint">
                    {t('raceRowAgent')}
                  </th>
                  {contenders.map((contender) => (
                    <td key={contender.dispatchId ?? contender.label} className="pr-3 align-top">
                      <div className="flex items-center gap-1.5">
                        <span className="truncate text-[12px] font-medium text-ds-ink">
                          {contender.harnessId}
                          {contender.model ? ` · ${contender.model}` : ''}
                        </span>
                        {race?.winnerDispatchId === contender.dispatchId ? (
                          <Trophy className="h-3.5 w-3.5 shrink-0 text-amber-500" strokeWidth={1.8} />
                        ) : null}
                      </div>
                    </td>
                  ))}
                </tr>
                <tr>
                  <th className="pr-2 pt-3 align-top text-[11px] font-medium text-ds-faint">
                    {t('raceRowStatus')}
                  </th>
                  {contenders.map((contender) => (
                    <td key={contender.dispatchId ?? contender.label} className="pr-3 pt-3 align-top">
                      <div className="flex flex-wrap items-center gap-1.5">
                        <span className="rounded-full bg-ds-hover px-2 py-0.5 text-[10.5px] text-ds-muted">
                          {t(`raceDispatchState.${stateKey(contender)}`)}
                        </span>
                        {contender.verdict ? (
                          <span className="rounded-full bg-ds-hover px-2 py-0.5 text-[10.5px] text-ds-muted">
                            {t(`raceVerdict.${contender.verdict.status}`)}
                          </span>
                        ) : null}
                      </div>
                      {contender.createError ? (
                        <p className="mt-1 text-[11px] text-ds-error">{contender.createError}</p>
                      ) : null}
                    </td>
                  ))}
                </tr>
                <tr>
                  <th className="pr-2 pt-3 align-top text-[11px] font-medium text-ds-faint">
                    {t('raceRowChanges')}
                  </th>
                  {contenders.map((contender) => (
                    <td key={contender.dispatchId ?? contender.label} className="pr-3 pt-3 align-top">
                      {contender.capture ? (
                        <button
                          type="button"
                          onClick={() => openWorkspace(contender)}
                          className="text-[12px] text-ds-link hover:underline"
                        >
                          {contender.capture.changedFiles} {t('raceFiles')} · +
                          {contender.capture.insertions} −{contender.capture.deletions}
                        </button>
                      ) : (
                        <span className="text-[12px] text-ds-faint">—</span>
                      )}
                    </td>
                  ))}
                </tr>
                <tr>
                  <th className="pr-2 pt-3 align-top text-[11px] font-medium text-ds-faint">
                    {t('raceRowChecks')}
                  </th>
                  {contenders.map((contender) => (
                    <td key={contender.dispatchId ?? contender.label} className="pr-3 pt-3 align-top">
                      {contender.checks?.length ? (
                        <ul className="space-y-0.5">
                          {contender.checks.map((check, index) => (
                            <li key={`${check.name}-${index}`} className="text-[11px] text-ds-muted">
                              {check.name}: {check.status}
                            </li>
                          ))}
                        </ul>
                      ) : (
                        <span className="text-[12px] text-ds-faint">—</span>
                      )}
                    </td>
                  ))}
                </tr>
                <tr>
                  <th className="pr-2 pt-3 align-top text-[11px] font-medium text-ds-faint">
                    {t('raceRowReport')}
                  </th>
                  {contenders.map((contender) => (
                    <td key={contender.dispatchId ?? contender.label} className="pr-3 pt-3 align-top">
                      <p className="whitespace-pre-wrap text-[11px] text-ds-muted">
                        {contender.workerReport?.summary ?? contender.resultExcerpt ?? '—'}
                      </p>
                    </td>
                  ))}
                </tr>
                <tr>
                  <th className="pr-2 pt-3 align-top text-[11px] font-medium text-ds-faint">
                    {t('raceRowUsage')}
                  </th>
                  {contenders.map((contender) => (
                    <td key={contender.dispatchId ?? contender.label} className="pr-3 pt-3 align-top">
                      <span className="text-[11px] text-ds-muted">
                        {formatDuration(contender.durationMs)} · {formatUsage(contender)}
                      </span>
                    </td>
                  ))}
                </tr>
                {race?.notes ? (
                  <tr>
                    <th className="pr-2 pt-3 align-top text-[11px] font-medium text-ds-faint">
                      {t('raceRowRecommendation')}
                    </th>
                    <td colSpan={contenders.length} className="pt-3 align-top">
                      <p className="whitespace-pre-wrap rounded-[8px] bg-ds-hover/60 px-3 py-2 text-[11px] text-ds-muted">
                        {race.notes}
                      </p>
                    </td>
                  </tr>
                ) : null}
              </tbody>
            </table>
          ) : null}
        </div>

        {comparison ? (
          <div className="flex shrink-0 flex-wrap items-center gap-2 border-t border-ds-border-muted px-4 py-3">
            {race?.state === 'ready'
              ? contenders
                  .filter((contender) => contender.dispatchId && !contender.createError)
                  .map((contender) => (
                    <button
                      key={contender.dispatchId}
                      type="button"
                      disabled={pending !== null}
                      onClick={() => void decide(contender)}
                      className="rounded-[8px] bg-ds-accent px-3 py-1.5 text-[12px] font-medium text-white hover:opacity-90 disabled:opacity-50"
                    >
                      {t('racePickWinner', { label: contender.label })}
                    </button>
                  ))
              : null}
            {race?.state === 'decided' && losers.length > 0 ? (
              confirmDiscard ? (
                <>
                  <span className="text-[11px] text-ds-muted">
                    {t('raceDiscardConfirm', { count: losers.length })}
                  </span>
                  <span className="w-full text-[11px] text-ds-faint">
                    {losers
                      .map((entry) => entry.taskWorkspaceId ?? entry.label)
                      .join(' · ')}
                  </span>
                  <button
                    type="button"
                    disabled={pending !== null}
                    onClick={() => void discardOthers()}
                    className="rounded-[8px] bg-ds-error px-3 py-1.5 text-[12px] font-medium text-white hover:opacity-90 disabled:opacity-50"
                  >
                    {pending === 'discard' ? '…' : t('raceDiscardConfirmButton')}
                  </button>
                  <button
                    type="button"
                    disabled={pending !== null}
                    onClick={() => setConfirmDiscard(false)}
                    className="rounded-[8px] border border-ds-border px-3 py-1.5 text-[12px] text-ds-muted hover:text-ds-ink"
                  >
                    {t('raceDiscardCancel')}
                  </button>
                </>
              ) : (
                <button
                  type="button"
                  onClick={() => setConfirmDiscard(true)}
                  className="rounded-[8px] border border-ds-border px-3 py-1.5 text-[12px] text-ds-muted hover:text-ds-ink"
                >
                  {t('raceDiscardOthers')}
                </button>
              )
            ) : null}
          </div>
        ) : null}
      </div>
    </div>,
    document.body
  )
}
