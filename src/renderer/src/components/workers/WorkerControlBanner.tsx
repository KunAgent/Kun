import { useCallback, useEffect, useState, type ReactElement } from 'react'
import { useTranslation } from 'react-i18next'
import { HandMetal, Undo2, Users } from 'lucide-react'
import type { AdeTeamWorker } from '@shared/ade-teams'
import { getProvider } from '../../agent/registry'
import { useActivityStore } from '../../store/activity-store'

/**
 * Worker-thread control banner (12 §6.3): sits at the top of a worker
 * conversation — 「由总管管理 · 接管」 while the manager drives,
 * 「你正在接管 · 交还给总管」 after take-over. Hidden for non-worker
 * threads (the lookup 404s) and for released/detached workers.
 */
export function WorkerControlBanner({
  threadId
}: {
  threadId: string
}): ReactElement | null {
  const { t } = useTranslation('common')
  const [worker, setWorker] = useState<AdeTeamWorker | null>(null)
  const [resolved, setResolved] = useState(false)
  const [busy, setBusy] = useState(false)
  // Re-resolve when the worker row's control-relevant activity changes.
  const rowStamp = useActivityStore((s) => {
    const row = s.rows[threadId]
    return row ? `${row.state}:${row.updatedAt}` : ''
  })

  const reload = useCallback(async (): Promise<void> => {
    const provider = getProvider()
    if (!provider.getTeamWorker) {
      setResolved(true)
      return
    }
    try {
      const found = await provider.getTeamWorker(threadId)
      setWorker(found?.worker ?? null)
    } catch {
      setWorker(null)
    } finally {
      setResolved(true)
    }
  }, [threadId])

  useEffect(() => {
    setResolved(false)
    void reload()
  }, [reload, rowStamp])

  if (!resolved || !worker || worker.state !== 'active') return null
  const underUser = worker.control === 'user'

  const act = (action: 'take-over' | 'hand-back'): void => {
    const provider = getProvider()
    if (!provider.controlTeamWorker) return
    setBusy(true)
    void provider.controlTeamWorker(threadId, action)
      .then(reload)
      .catch(() => undefined)
      .finally(() => setBusy(false))
  }

  return (
    <div
      data-worker-control-banner={worker.control}
      className="mx-auto mb-3 flex w-full max-w-[46rem] items-center gap-2 rounded-full border border-ds-border bg-ds-card px-3 py-1.5"
    >
      {underUser ? (
        <HandMetal className="h-3.5 w-3.5 shrink-0 text-accent" strokeWidth={1.9} aria-hidden />
      ) : (
        <Users className="h-3.5 w-3.5 shrink-0 text-ds-faint" strokeWidth={1.9} aria-hidden />
      )}
      <span className="min-w-0 flex-1 truncate text-[12px] text-ds-muted">
        {underUser
          ? t('workerBannerUserControl', { label: worker.label })
          : t('workerBannerManaged', { label: worker.label })}
      </span>
      <button
        type="button"
        disabled={busy}
        onClick={() => act(underUser ? 'hand-back' : 'take-over')}
        className="inline-flex shrink-0 items-center gap-1 rounded-full border border-ds-border px-2.5 py-1 text-[11.5px] font-semibold text-ds-ink transition hover:bg-ds-hover disabled:opacity-40"
      >
        {underUser ? (
          <Undo2 className="h-3 w-3" strokeWidth={2} aria-hidden />
        ) : (
          <HandMetal className="h-3 w-3" strokeWidth={2} aria-hidden />
        )}
        {underUser ? t('workerBannerHandBack') : t('workerBannerTakeOver')}
      </button>
    </div>
  )
}
