import { useEffect, useState, type ReactElement } from 'react'
import { CheckCircle2, CircleDashed, Layers, Loader2, MinusCircle, X, XCircle } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { cancelPaperJob } from '../../write/paper/paper-actions'
import { usePaperStore, type PaperJobUiState } from '../../write/paper/paper-store'
import type { PaperJobKind } from '@shared/paper/paper-types'
import {
  cancelPaperBatchInterpret,
  usePaperBatchInterpret,
  type PaperBatchItem,
  type PaperBatchJob
} from '../../paper/paper-batch-interpret'
import { openPaperSession } from '../../paper/paper-session-open'

const CANCELABLE: ReadonlySet<PaperJobKind> = new Set([
  'import',
  'cool-notes',
  'preprocess',
  'translate-document'
])

function BatchItemIcon({ status }: { status: PaperBatchItem['status'] }): ReactElement {
  const props = { className: 'h-3.5 w-3.5 shrink-0', strokeWidth: 2 }
  if (status === 'preparing' || status === 'running') return <Loader2 {...props} className={`${props.className} animate-spin text-accent`} />
  if (status === 'done') return <CheckCircle2 {...props} className={`${props.className} text-emerald-500`} />
  if (status === 'failed') return <XCircle {...props} className={`${props.className} text-red-500`} />
  if (status === 'waiting') return <CircleDashed {...props} className={`${props.className} text-ds-faint`} />
  return <MinusCircle {...props} className={`${props.className} text-ds-faint`} />
}

/** Batch interpretation progress: one row per paper, finished ones open their session. */
function BatchPanel({ job }: { job: PaperBatchJob }): ReactElement {
  const { t } = useTranslation('common')
  const dismiss = usePaperBatchInterpret((state) => state.dismiss)
  const settled = job.items.filter((item) => !['waiting', 'preparing', 'running'].includes(item.status)).length
  return (
    <div className="pointer-events-auto w-[300px] rounded-2xl border border-ds-border bg-ds-elevated p-2 shadow-2xl backdrop-blur-xl"
      data-testid="paper-batch-panel">
      <div className="flex items-center gap-2 px-1.5 pb-1.5">
        <Layers className="h-3.5 w-3.5 shrink-0 text-accent" strokeWidth={2} />
        <p className="min-w-0 flex-1 truncate text-[12px] font-semibold text-ds-ink">
          {t('paperBatchProgress', { done: settled, total: job.items.length })}
        </p>
        {job.running ? (
          <button type="button" onClick={cancelPaperBatchInterpret}
            className="rounded-md px-1.5 py-0.5 text-[11px] text-ds-muted transition hover:bg-ds-hover hover:text-ds-ink">
            {job.canceled ? t('paperBatchStopping') : t('paperBatchStop')}
          </button>
        ) : (
          <button type="button" aria-label={t('close')} onClick={dismiss}
            className="inline-flex h-5 w-5 items-center justify-center rounded-full text-ds-faint transition hover:bg-ds-hover hover:text-ds-ink">
            <X className="h-3 w-3" strokeWidth={2.2} />
          </button>
        )}
      </div>
      <div className="max-h-[260px] overflow-y-auto">
        {job.items.map((item) => (
          <div key={item.unitDir} className="flex items-center gap-2 rounded-xl px-1.5 py-1.5">
            <BatchItemIcon status={item.status} />
            <div className="min-w-0 flex-1">
              <p className="truncate text-[12px] text-ds-ink" title={item.title}>{item.title}</p>
              {item.detail ? <p className="truncate text-[10.5px] text-ds-faint" title={item.detail}>{item.detail}</p> : null}
            </div>
            {item.status === 'done' && item.threadId ? (
              <button type="button" onClick={() => void openPaperSession(job.workspaceRoot, item.threadId!, item.unitDir)}
                className="shrink-0 rounded-md px-1.5 py-0.5 text-[11px] font-medium text-accent transition hover:bg-accent/10">
                {t('paperBatchOpen')}
              </button>
            ) : null}
          </div>
        ))}
      </div>
    </div>
  )
}

/**
 * Background-task ring: aggregates paper jobs (import, preprocess, notes,
 * translation) and a batch interpretation into a floating bottom-left
 * indicator. Hidden when idle; click expands the job list.
 */
export function PaperTaskRing(): ReactElement | null {
  const { t } = useTranslation('common')
  const busy = usePaperStore((s) => s.busy)
  const batch = usePaperBatchInterpret((s) => s.job)
  const [open, setOpen] = useState(false)
  const jobs = Object.values(busy).filter(
    (job): job is PaperJobUiState => Boolean(job && job.status === 'running')
  )
  const running = jobs.length + (batch?.running ? 1 : 0)

  // A batch that starts shows its progress right away.
  const batchId = batch?.id ?? null
  useEffect(() => {
    if (batchId) setOpen(true)
  }, [batchId])

  // Completions are announced once, by the shared paper notice toast.
  if (!running && !batch) return null

  return (
    <div className="pointer-events-none absolute bottom-4 left-4 z-30 flex flex-col items-start gap-2">
      {open && batch ? <BatchPanel job={batch} /> : null}
      {open && jobs.length ? (
        <div className="pointer-events-auto w-[240px] rounded-2xl border border-ds-border bg-ds-elevated p-1.5 shadow-2xl backdrop-blur-xl">
          {jobs.map((job) => (
            <div key={job.requestId} className="flex items-center gap-2 rounded-xl px-2 py-1.5">
              <Loader2 className="h-3.5 w-3.5 shrink-0 animate-spin text-accent" strokeWidth={2} />
              <div className="min-w-0 flex-1">
                <p className="truncate text-[12px] font-medium text-ds-ink">
                  {t(`writePaperJob_${job.kind}`, { defaultValue: job.kind })}
                </p>
                <p className="truncate text-[10.5px] text-ds-faint">
                  {job.message || t(`writePaperStage_${job.stage}`, { defaultValue: job.stage })}
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
      {running || batch ? (
        <button
          type="button"
          onClick={() => setOpen((value) => !value)}
          title={t('writePaperTasksRunning', { count: running })}
          aria-label={t('writePaperTasksRunning', { count: running })}
          aria-expanded={open}
          data-testid="paper-task-ring"
          className="pointer-events-auto relative flex h-9 w-9 items-center justify-center rounded-full border border-ds-border bg-ds-elevated text-accent shadow-lg backdrop-blur-xl transition hover:scale-105"
        >
          {running ? <Loader2 className="h-4.5 w-4.5 animate-spin" strokeWidth={2} /> : <Layers className="h-4 w-4" strokeWidth={2} />}
          {running ? (
            <span className="absolute -right-0.5 -top-0.5 flex h-4 min-w-4 items-center justify-center rounded-full bg-accent px-1 text-[9px] font-bold text-white">
              {running}
            </span>
          ) : null}
        </button>
      ) : null}
    </div>
  )
}
