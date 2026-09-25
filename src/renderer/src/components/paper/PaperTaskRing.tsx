import { useEffect, useState, type ReactElement } from 'react'
import { CheckCircle2, Loader2, X } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { cancelPaperJob } from '../../write/paper/paper-actions'
import { usePaperStore, type PaperJobUiState } from '../../write/paper/paper-store'
import type { PaperJobKind } from '@shared/paper/paper-types'

const CANCELABLE: ReadonlySet<PaperJobKind> = new Set([
  'import',
  'cool-notes',
  'preprocess',
  'translate-document'
])

/**
 * Background-task ring (U6): aggregates `usePaperStore.busy` into a floating
 * bottom-left indicator. Hidden when idle; click expands a job list with
 * per-job stage labels and cancel buttons.
 */
export function PaperTaskRing(): ReactElement | null {
  const { t } = useTranslation('common')
  const busy = usePaperStore((s) => s.busy)
  const notice = usePaperStore((s) => s.notice)
  const [open, setOpen] = useState(false)
  const jobs = Object.values(busy).filter(
    (job): job is PaperJobUiState => Boolean(job && job.status === 'running')
  )
  const running = jobs.length

  // Surface transient notices next to the ring so job completions stay visible.
  const [flash, setFlash] = useState<string | null>(null)
  useEffect(() => {
    if (!notice) return
    setFlash(notice.message)
    const timer = window.setTimeout(() => setFlash(null), 4000)
    return () => window.clearTimeout(timer)
  }, [notice])

  if (!running && !flash) return null

  return (
    <div className="pointer-events-none absolute bottom-4 left-4 z-30 flex flex-col items-start gap-2">
      {open && running ? (
        <div className="pointer-events-auto w-[240px] rounded-2xl border border-ds-border bg-ds-card/95 p-1.5 shadow-2xl backdrop-blur-xl">
          {jobs.map((job) => (
            <div
              key={job.requestId}
              className="flex items-center gap-2 rounded-xl px-2 py-1.5"
            >
              <Loader2 className="h-3.5 w-3.5 shrink-0 animate-spin text-accent" strokeWidth={2} />
              <div className="min-w-0 flex-1">
                <p className="truncate text-[12px] font-medium text-ds-ink">
                  {t(`writePaperJob_${job.kind}`, { defaultValue: job.kind })}
                </p>
                <p className="truncate text-[10.5px] text-ds-faint">
                  {job.message ||
                    t(`writePaperStage_${job.stage}`, { defaultValue: job.stage })}
                </p>
              </div>
              {CANCELABLE.has(job.kind) ? (
                <button
                  type="button"
                  className="inline-flex h-5 w-5 shrink-0 items-center justify-center rounded-full text-ds-faint transition hover:bg-ds-hover hover:text-ds-ink"
                  title={t('writePaperCancel')}
                  aria-label={t('writePaperCancel')}
                  onClick={() => cancelPaperJob(job.kind)}
                >
                  <X className="h-3 w-3" strokeWidth={2.2} />
                </button>
              ) : null}
            </div>
          ))}
        </div>
      ) : null}
      {flash ? (
        <div className="pointer-events-auto flex max-w-[300px] items-center gap-1.5 rounded-full border border-ds-border bg-ds-card/95 px-3 py-1.5 shadow-lg backdrop-blur-xl">
          <CheckCircle2 className="h-3.5 w-3.5 shrink-0 text-emerald-500" strokeWidth={2} />
          <span className="truncate text-[11.5px] text-ds-muted">{flash}</span>
        </div>
      ) : null}
      {running ? (
        <button
          type="button"
          onClick={() => setOpen((value) => !value)}
          title={t('writePaperTasksRunning', { count: running })}
          aria-label={t('writePaperTasksRunning', { count: running })}
          className="pointer-events-auto relative flex h-9 w-9 items-center justify-center rounded-full border border-ds-border bg-ds-card/95 text-accent shadow-lg backdrop-blur-xl transition hover:scale-105"
        >
          <Loader2 className="h-4.5 w-4.5 animate-spin" strokeWidth={2} />
          <span className="absolute -right-0.5 -top-0.5 flex h-4 min-w-4 items-center justify-center rounded-full bg-accent px-1 text-[9px] font-bold text-white">
            {running}
          </span>
        </button>
      ) : null}
    </div>
  )
}
