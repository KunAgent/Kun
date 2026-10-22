import { useMemo, type ReactElement } from 'react'
import { useTranslation } from 'react-i18next'
import { CircleAlert, CircleCheck, CircleSlash, GitBranch, Split } from 'lucide-react'
import type { TaskSuggestionTaskView, TaskSuggestionView } from '@shared/task-suggestions'
import { useThreadTaskSuggestions, useTaskSuggestion } from './use-task-suggestion'
import { pendingTaskReports } from './task-suggestion-card-model'
import { openTaskThread } from './TaskSuggestionRow'

function TaskReportCard({ card, task, index }: { card: TaskSuggestionView; task: TaskSuggestionTaskView; index: number }) {
  const { t } = useTranslation('common')
  const { act, busy } = useTaskSuggestion(card.intentId, card)
  const result = task.result!
  const tone = task.state === 'done'
    ? { icon: <CircleCheck size={15} aria-hidden />, tile: 'bg-ds-success-soft text-ds-status-success', key: 'taskSuggestion.report.done' }
    : task.state === 'cancelled'
      ? { icon: <CircleSlash size={15} aria-hidden />, tile: 'bg-ds-subtle text-ds-muted', key: 'taskSuggestion.report.cancelled' }
      : { icon: <CircleAlert size={15} aria-hidden />, tile: 'bg-ds-danger-soft text-ds-status-danger', key: 'taskSuggestion.report.failed' }
  const minutes = task.startedAt && task.settledAt
    ? Math.max(1, Math.round((Date.parse(task.settledAt) - Date.parse(task.startedAt)) / 60_000)) : null
  const body = result.summary || result.error || t('taskSuggestion.report.noSummary')
  return <section className="flex min-w-0 gap-3 rounded-2xl border border-ds-border bg-ds-card px-4 py-3 shadow-sm"
    data-task-report={task.id} data-state={task.state}>
    <span className={`mt-px flex h-[30px] w-[30px] shrink-0 items-center justify-center rounded-[10px] ${tone.tile}`}>{tone.icon}</span>
    <div className="min-w-0 flex-1">
      <h4 className="truncate text-[13.5px] font-semibold leading-[19px] text-ds-ink" title={task.title}>
        {t(tone.key, { index: index + 1, title: task.title })}
      </h4>
      <div className="mt-0.5 flex flex-wrap items-center gap-x-2.5 gap-y-0.5 text-[12px] text-ds-faint">
        {task.branch ? <span className="inline-flex items-center gap-1"><GitBranch size={11} aria-hidden />{task.branch}</span> : null}
        {result.changedFiles ? <span>{t('taskSuggestion.report.changedFiles', { count: result.changedFiles })}</span> : null}
        {minutes ? <span>{t('taskSuggestion.report.duration', { minutes })}</span> : null}
        {task.route.model ? <span className="truncate">{task.route.model}</span> : null}
      </div>
      <p className={`mt-1.5 line-clamp-4 whitespace-pre-wrap break-words text-[12.5px] leading-[1.6] ${result.summary ? 'text-ds-muted' : result.error ? 'text-ds-status-danger' : 'text-ds-faint'}`}>{body}</p>
      <div className="mt-2 flex items-center gap-1.5">
        <button type="button" onClick={() => openTaskThread(task.threadId)}
          className="inline-flex h-[26px] items-center gap-1 rounded-lg border border-ds-border bg-ds-card px-2.5 text-[12px] font-medium text-ds-ink hover:bg-ds-hover">
          <Split size={12} aria-hidden />{t('taskSuggestion.report.open')}
        </button>
        <button type="button" disabled={busy} onClick={() => void act('acknowledge', { taskIds: [task.id] })}
          className="ml-auto inline-flex h-[26px] items-center rounded-lg px-2.5 text-[12px] text-ds-muted hover:bg-ds-hover hover:text-ds-ink disabled:opacity-50">
          {t('taskSuggestion.report.dismiss')}
        </button>
      </div>
    </div>
  </section>
}

/** Finished task sessions report back at the end of the conversation that suggested them. */
export function TaskReportStack({ reports }: { reports: ReturnType<typeof pendingTaskReports> }) {
  return <div className="space-y-2.5" data-task-reports>
    {reports.map(({ card, task, index }) => <TaskReportCard key={`${card.intentId}:${task.id}`} card={card} task={task} index={index} />)}
  </div>
}

/**
 * Trailing timeline content for the active conversation: its pending task
 * reports after any existing trailing card. Stable identity while nothing changes.
 */
export function useTaskReportSlot(threadId: string | null | undefined, trailing: ReactElement | null): ReactElement | null {
  const cards = useThreadTaskSuggestions(threadId)
  const reports = useMemo(() => pendingTaskReports(cards), [cards])
  const key = reports.map(({ card, task }) => `${card.intentId}:${task.id}:${card.revision}`).join('|')
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const stack = useMemo(() => (reports.length ? <TaskReportStack reports={reports} /> : null), [key])
  if (!stack) return trailing
  if (!trailing) return stack
  return <div className="space-y-3">{trailing}{stack}</div>
}
