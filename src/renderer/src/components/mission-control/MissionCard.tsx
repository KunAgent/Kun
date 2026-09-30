import { useState, type FormEvent, type ReactElement } from 'react'
import { useTranslation } from 'react-i18next'
import { ChevronDown, ChevronRight } from 'lucide-react'
import type { ActivityRow } from '@shared/activity-row'
import type { AdeQuestionRecord } from '@shared/ade-teams'
import { StatusDot } from '../activity/StatusDot'
import { projectOfRow, rowHasChildren } from './mission-filters'
import { formatRelativeTime } from '../../lib/format-relative-time'

export type MissionCardStats = {
  /** `changedFiles.length` from the task-workspace record (12 §5.3). */
  filesChanged?: number
  insertions?: number
  deletions?: number
  verdict?: string
  /** P3-15: summed usage for the row's unit (team total on manager rows). */
  tokens?: number
}

export type MissionCardProps = {
  row: ActivityRow
  /** undefined while the lazy stat load is in flight; null = none. */
  stats?: MissionCardStats | null
  /** Open question when the row waits on one (worker rows only). */
  openQuestion?: AdeQuestionRecord
  expanded: boolean
  /** Worker rows of an expanded manager card. */
  childRows?: ActivityRow[]
  childStatsOf?: (row: ActivityRow) => MissionCardStats | null | undefined
  onOpen: (row: ActivityRow) => void
  onAnswer: (questionId: string, answer: string) => Promise<void>
  onToggleExpand: (row: ActivityRow) => void
}

const VERDICT_TONE: Record<string, string> = {
  passed: 'text-ds-status-success',
  waived: 'text-ds-status-success',
  needs_changes: 'text-ds-status-warning',
  rejected: 'text-ds-status-danger',
  pending: 'text-ds-status-muted'
}

/**
 * One Mission Control card (docs/ade/12 §5.1): fixed three-row height so
 * lazy stats never shift layout — header (dot + title + harness), preview
 * line, footer (project · branch · diff · verdict · time). Needs-you rows
 * carry inline actions; manager cards expand into worker sub-cards.
 */
export function MissionCard({
  row,
  stats,
  openQuestion,
  expanded,
  childRows,
  childStatsOf,
  onOpen,
  onAnswer,
  onToggleExpand
}: MissionCardProps): ReactElement {
  const { t, i18n } = useTranslation('common')
  const [answering, setAnswering] = useState(false)
  const [answer, setAnswer] = useState('')
  const [sending, setSending] = useState(false)
  const needsYou = row.state === 'waiting' || row.state === 'failed'
  const expandable = rowHasChildren(row)
  const preview = row.progressNote
    ?? (row.state === 'waiting' && row.waitingReason
      ? t(`adeWaiting_${row.waitingReason}`)
      : row.lastMessagePreview)

  const submitAnswer = async (event: FormEvent): Promise<void> => {
    event.preventDefault()
    if (!openQuestion || !answer.trim() || sending) return
    setSending(true)
    try {
      await onAnswer(openQuestion.questionId, answer.trim())
      setAnswering(false)
      setAnswer('')
    } finally {
      setSending(false)
    }
  }

  return (
    <div data-mission-card data-tone={needsYou ? 'needs-you' : 'neutral'}>
      <div
        role="button"
        tabIndex={0}
        onClick={() => onOpen(row)}
        onKeyDown={(e) => {
          if (e.key === 'Enter' || e.key === ' ') onOpen(row)
        }}
        className="flex min-h-[68px] w-full cursor-pointer flex-col justify-between gap-0.5 rounded-lg border border-ds-border-muted bg-ds-card px-2.5 py-1.5 text-left transition hover:border-ds-border hover:bg-ds-hover"
      >
        <div className="flex min-w-0 items-center gap-1.5">
          <StatusDot row={row} />
          <span className="min-w-0 flex-1 truncate text-[12px] font-medium text-ds-ink">
            {row.title || row.unitId}
          </span>
          <span className="shrink-0 rounded px-1 text-[9.5px] uppercase tracking-wide text-ds-faint">
            {row.harnessId}
          </span>
          {expandable ? (
            <button
              type="button"
              aria-label={expanded ? t('missionCollapseWorkers') : t('missionExpandWorkers')}
              data-mission-expand
              onClick={(e) => {
                e.stopPropagation()
                onToggleExpand(row)
              }}
              className="shrink-0 rounded p-0.5 text-ds-faint hover:bg-ds-subtle hover:text-ds-muted"
            >
              {expanded ? (
                <ChevronDown className="h-3.5 w-3.5" strokeWidth={2} />
              ) : (
                <ChevronRight className="h-3.5 w-3.5" strokeWidth={2} />
              )}
            </button>
          ) : null}
        </div>
        <div className="min-h-4 truncate text-[11.5px] leading-4 text-ds-muted">
          {preview ?? ''}
        </div>
        <div className="flex min-h-4 items-center gap-1.5 truncate text-[10.5px] leading-4 text-ds-faint">
          <span className="truncate">{projectOfRow(row)}</span>
          {row.workspace.branch ? <span className="shrink-0">{row.workspace.branch}</span> : null}
          {stats?.filesChanged !== undefined ? (
            <span className="shrink-0">{t('missionFiles', { count: stats.filesChanged })}</span>
          ) : null}
          {stats?.insertions !== undefined || stats?.deletions !== undefined ? (
            <span className="shrink-0">
              <span className="text-ds-status-success">+{stats?.insertions ?? 0}</span>{' '}
              <span className="text-ds-status-danger">−{stats?.deletions ?? 0}</span>
            </span>
          ) : null}
          {stats?.verdict ? (
            <span className={`shrink-0 font-medium ${VERDICT_TONE[stats.verdict] ?? 'text-ds-status-muted'}`}>
              {t(`missionVerdict_${stats.verdict}`)}
            </span>
          ) : null}
          {stats?.tokens !== undefined ? (
            <span className="shrink-0 text-ds-faint" data-mission-tokens>
              {stats.tokens.toLocaleString()} tok
            </span>
          ) : null}
          <span className="ml-auto shrink-0">{formatRelativeTime(row.stateSince, i18n.language)}</span>
        </div>
      </div>
      {needsYou ? (
        <div className="mt-1 flex items-center gap-1.5 pl-1">
          <button
            type="button"
            onClick={() => onOpen(row)}
            className="rounded-full border border-ds-border-muted px-2 py-0.5 text-[11px] text-ds-muted hover:bg-ds-subtle hover:text-ds-ink"
          >
            {row.waitingReason === 'approval' || row.state === 'failed'
              ? t('missionGoApprove')
              : t('missionOpen')}
          </button>
          {row.waitingReason === 'question' && openQuestion ? (
            <button
              type="button"
              data-mission-answer
              onClick={() => setAnswering((v) => !v)}
              className="rounded-full border border-ds-status-warning/40 px-2 py-0.5 text-[11px] text-ds-status-warning hover:bg-ds-warning-soft"
            >
              {t('missionAnswer')}
            </button>
          ) : null}
        </div>
      ) : null}
      {answering && openQuestion ? (
        <form onSubmit={(e) => void submitAnswer(e)} className="mt-1 flex items-center gap-1.5 pl-1">
          <input
            value={answer}
            onChange={(e) => setAnswer(e.target.value)}
            placeholder={t('missionAnswerPlaceholder')}
            aria-label={t('missionAnswer')}
            className="min-w-0 flex-1 rounded-md border border-ds-border-muted bg-ds-main px-2 py-1 text-[11.5px] text-ds-ink outline-none focus:border-ds-status-warning"
          />
          <button
            type="submit"
            disabled={!answer.trim() || sending}
            className="shrink-0 rounded-md bg-ds-control px-2 py-1 text-[11px] text-ds-control-foreground disabled:opacity-50"
          >
            {t('missionAnswerSubmit')}
          </button>
        </form>
      ) : null}
      {expanded && childRows ? (
        <div className="ml-4 mt-1 flex flex-col gap-1 border-l border-ds-border-muted pl-2">
          {childRows.map((child) => (
            <MissionCard
              key={child.unitId}
              row={child}
              stats={childStatsOf?.(child)}
              openQuestion={undefined}
              expanded={false}
              onOpen={onOpen}
              onAnswer={onAnswer}
              onToggleExpand={onToggleExpand}
            />
          ))}
        </div>
      ) : null}
    </div>
  )
}
