import { useEffect, useState, type ReactElement } from 'react'
import {
  ExternalLink,
  FileText,
  GraduationCap,
  ImageDown,
  Loader2,
  Sparkles,
  X
} from 'lucide-react'
import { useTranslation } from 'react-i18next'
import type { PaperUnitMeta } from '@shared/paper/paper-meta-v2'
import { usePaperStore } from '../../../write/paper/paper-store'
import { CoolPapersIcon } from './CoolPapersIcon'

type Translate = (key: string, opts?: Record<string, unknown>) => string

function elapsedLabel(startedAt: number, now: number, t: Translate): string {
  const seconds = Math.max(0, Math.round((now - startedAt) / 1000))
  return t('writePaperElapsed', { seconds })
}

function useNow(active: boolean): number {
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    if (!active) return
    const timer = window.setInterval(() => setNow(Date.now()), 1000)
    return () => window.clearInterval(timer)
  }, [active])
  return now
}

const actionClass =
  'inline-flex h-7 shrink-0 items-center gap-1.5 rounded-lg border border-ds-border-muted bg-ds-card/80 px-2.5 text-[12px] font-medium text-ds-muted transition hover:border-accent/30 hover:bg-white hover:text-ds-ink disabled:cursor-not-allowed disabled:opacity-55 dark:bg-white/[0.04] dark:hover:bg-white/[0.08]'

const iconActionClass =
  'inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-lg text-ds-faint transition hover:bg-ds-hover hover:text-ds-ink disabled:cursor-not-allowed disabled:opacity-55'

/**
 * Paper-unit toolbar strip (§6.4): rendered under the focused group's toolbar
 * when the active file belongs to a paper unit. Shows the paper identity chips,
 * deep links, and the four actions — Cool notes, interpret, extract figures,
 * open interpretation.
 */
export function WritePaperBar({
  unitDir,
  meta,
  onCoolNotes,
  onInterpret,
  onPreprocess,
  onOpenInterpretation,
  onCancel
}: {
  /** Workspace-relative unit dir, e.g. `papers/1706.03762`. */
  unitDir: string
  meta: PaperUnitMeta
  onCoolNotes: (force: boolean) => void
  onInterpret: () => void
  onPreprocess: (force: boolean) => void
  /** Receives the workspace-relative interpretation path. */
  onOpenInterpretation: (path: string) => void
  onCancel: (kind: 'cool-notes' | 'preprocess') => void
}): ReactElement {
  const { t } = useTranslation('common')
  const busy = usePaperStore((s) => s.busy)
  const coolJob = busy['cool-notes']
  const preprocessJob = busy.preprocess
  const coolRunning = coolJob?.status === 'running'
  const preprocessRunning = preprocessJob?.status === 'running'
  const now = useNow(coolRunning || preprocessRunning)

  const latestInterpretation = meta.interpretations?.at(-1)?.path ?? null
  const latestInterpretationPath = latestInterpretation ? `${unitDir}/${latestInterpretation}` : null
  const authorsLabel = meta.authors.length > 2
    ? `${meta.authors.slice(0, 2).join(', ')} ${t('writePaperEtAl')}`
    : meta.authors.join(', ')
  const arxivUrl = meta.arxivId ? `https://arxiv.org/abs/${meta.arxivId}` : null
  const coolUrl = meta.coolPapers
    ? `https://papers.cool/${meta.coolPapers.branch === 'venue' ? 'venue' : 'arxiv'}/${meta.coolPapers.id}`
    : meta.sourceUrl?.includes('papers.cool')
      ? meta.sourceUrl
      : null
  const openExternal = (url: string): void => {
    void window.kunGui?.openExternal?.(url)
  }

  return (
    <div className="write-paper-bar flex flex-col gap-1.5 border-b border-ds-border-muted bg-ds-subtle/40 px-3 py-2">
      <div className="flex min-w-0 items-center gap-2">
        <GraduationCap className="h-4 w-4 shrink-0 text-accent" strokeWidth={1.9} />
        <span className="min-w-0 flex-1 truncate text-[13px] font-semibold text-ds-ink" title={meta.title}>
          {meta.title}
        </span>
        {authorsLabel ? (
          <span className="hidden max-w-[30%] truncate text-[12px] text-ds-faint md:inline" title={meta.authors.join(', ')}>
            {authorsLabel}
          </span>
        ) : null}
        {meta.year ? <span className="shrink-0 text-[12px] text-ds-faint">{meta.year}</span> : null}
        {meta.venue ? (
          <span className="hidden shrink-0 rounded-full bg-accent/10 px-2 py-0.5 text-[11px] font-medium text-accent lg:inline">
            {meta.venue}
          </span>
        ) : null}
        {arxivUrl ? (
          <button
            type="button"
            className={iconActionClass}
            title={t('writePaperOpenArxiv')}
            aria-label={t('writePaperOpenArxiv')}
            onClick={() => openExternal(arxivUrl)}
          >
            <ExternalLink className="h-3.5 w-3.5" strokeWidth={1.9} />
          </button>
        ) : null}
        {coolUrl ? (
          <button
            type="button"
            className={iconActionClass}
            title={t('writePaperOpenCool')}
            aria-label={t('writePaperOpenCool')}
            onClick={() => openExternal(coolUrl)}
          >
            <CoolPapersIcon className="h-3.5 w-3.5" />
          </button>
        ) : null}
      </div>

      <div className="flex min-w-0 flex-wrap items-center gap-1.5">
        {coolRunning ? (
          <span className="inline-flex h-7 items-center gap-1.5 rounded-lg border border-accent/25 bg-accent/10 px-2.5 text-[12px] font-medium text-accent">
            <Loader2 className="h-3.5 w-3.5 animate-spin" strokeWidth={2} />
            {elapsedLabel(coolJob.startedAt, now, t)}
            <button
              type="button"
              className="ml-0.5 inline-flex h-4 w-4 items-center justify-center rounded-full transition hover:bg-accent/15"
              title={t('writePaperCancel')}
              aria-label={t('writePaperCancel')}
              onClick={() => onCancel('cool-notes')}
            >
              <X className="h-3 w-3" strokeWidth={2.2} />
            </button>
          </span>
        ) : (
          <button
            type="button"
            className={actionClass}
            disabled={preprocessRunning}
            title={t('writePaperCoolNotesHint')}
            onClick={() => onCoolNotes(false)}
            onContextMenu={(event) => {
              event.preventDefault()
              onCoolNotes(true)
            }}
          >
            <CoolPapersIcon className="h-3.5 w-3.5" />
            {t('writePaperCoolNotes')}
          </button>
        )}

        <button
          type="button"
          className={`${actionClass} border-accent/30 bg-accent/[0.08] text-accent hover:bg-accent/15 hover:text-accent`}
          disabled={coolRunning || preprocessRunning}
          title={t('writePaperInterpretHint')}
          onClick={onInterpret}
        >
          <Sparkles className="h-3.5 w-3.5" strokeWidth={1.9} />
          {t('writePaperInterpret')}
        </button>

        {preprocessRunning ? (
          <span className="inline-flex h-7 items-center gap-1.5 rounded-lg border border-accent/25 bg-accent/10 px-2.5 text-[12px] font-medium text-accent">
            <Loader2 className="h-3.5 w-3.5 animate-spin" strokeWidth={2} />
            {preprocessJob.message || t(`writePaperStage_${preprocessJob.stage}`, { defaultValue: preprocessJob.stage })}
            <button
              type="button"
              className="ml-0.5 inline-flex h-4 w-4 items-center justify-center rounded-full transition hover:bg-accent/15"
              title={t('writePaperCancel')}
              aria-label={t('writePaperCancel')}
              onClick={() => onCancel('preprocess')}
            >
              <X className="h-3 w-3" strokeWidth={2.2} />
            </button>
          </span>
        ) : (
          <button
            type="button"
            className={actionClass}
            disabled={coolRunning}
            title={t('writePaperExtractFiguresHint')}
            onClick={() => onPreprocess(false)}
            onContextMenu={(event) => {
              event.preventDefault()
              onPreprocess(true)
            }}
          >
            <ImageDown className="h-3.5 w-3.5" strokeWidth={1.9} />
            {t('writePaperExtractFigures')}
          </button>
        )}

        {latestInterpretationPath ? (
          <button
            type="button"
            className={actionClass}
            title={latestInterpretation ?? undefined}
            onClick={() => onOpenInterpretation(latestInterpretationPath)}
          >
            <FileText className="h-3.5 w-3.5" strokeWidth={1.9} />
            {t('writePaperOpenInterpretation')}
          </button>
        ) : null}

      </div>
    </div>
  )
}
