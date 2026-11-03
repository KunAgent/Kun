import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { ChevronDown, ChevronRight, CircleCheck, CircleSlash, GitBranch, ListChecks, Loader2, Pause, Play, Timer, TriangleAlert } from 'lucide-react'
import { TaskSuggestionPublicSchema, type TaskSuggestionView } from '@shared/task-suggestions'
import type { ToolBlock } from '../../agent/types'
import { useChatStore } from '../../store/chat-store'
import { useTaskSuggestion } from './use-task-suggestion'
import { TaskSuggestionRow } from './TaskSuggestionRow'
import { formatClock, taskCardCountdown, taskCardCounts, taskRowPhase, type TaskCardCounts } from './task-suggestion-card-model'

const RING = 2 * Math.PI * 6
const pill = 'inline-flex max-w-full shrink-0 items-center gap-1.5 rounded-full px-2.5 py-1 text-[12px] font-medium'
const EMPTY_AWAITING: Readonly<Record<string, true>> = {}

function CountdownRing({ fraction }: { fraction: number }) {
  return <svg width="16" height="16" viewBox="0 0 16 16" aria-hidden className="-rotate-90 shrink-0">
    <circle cx="8" cy="8" r="6" fill="none" stroke="currentColor" strokeOpacity="0.2" strokeWidth="2" />
    <circle cx="8" cy="8" r="6" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"
      strokeDasharray={RING} strokeDashoffset={RING * (1 - fraction)} style={{ transition: 'stroke-dashoffset 0.5s linear' }} />
  </svg>
}

function CardBadge({ card, counts }: { card: TaskSuggestionView; counts: TaskCardCounts }) {
  const { t } = useTranslation('common')
  const [now, setNow] = useState(Date.now)
  useEffect(() => {
    if (card.state !== 'countdown') return
    setNow(Date.now())
    const timer = setInterval(() => setNow(Date.now()), 500)
    return () => clearInterval(timer)
  }, [card.state, card.deadline])
  const countdown = taskCardCountdown(card, now)
  if (countdown) return <span role="timer" className={`${pill} bg-accent-tint/10 text-accent`} data-task-countdown>
    <CountdownRing fraction={countdown.fraction} />
    <span className="tabular-nums">{t('taskSuggestion.status.countdown', { time: formatClock(countdown.remainingMs) })}</span>
  </span>
  if (card.state === 'paused') return <span className={`${pill} bg-ds-subtle text-ds-muted`}><Pause size={13} aria-hidden />{t('taskSuggestion.status.paused')}</span>
  if (card.state === 'suggested') return <span className={`${pill} bg-ds-subtle text-ds-muted`}>{t('taskSuggestion.status.pending', { count: counts.suggested })}</span>
  const parts = [
    counts.done ? t('taskSuggestion.summary.done', { count: counts.done }) : '',
    counts.live ? t('taskSuggestion.summary.live', { count: counts.live }) : '',
    counts.failed ? t('taskSuggestion.summary.failed', { count: counts.failed }) : ''
  ].filter(Boolean)
  return <span className={`${pill} bg-ds-subtle text-ds-muted`} role="status">
    {counts.live ? <Loader2 size={13} className="animate-spin text-ds-status-running" aria-hidden /> : null}
    {parts.length ? parts.join(' · ') : t('taskSuggestion.status.progress', { started: counts.started, total: counts.total })}
    {counts.startFailed ? <span className="text-ds-status-danger">{parts.length ? ' · ' : ''}{t('taskSuggestion.summary.startFailed', { count: counts.startFailed })}</span> : null}
  </span>
}

/** Every task finished: one line with the outcome counts; expands back to the full card. */
function SettledLine({ counts, onExpand }: { counts: TaskCardCounts; onExpand: () => void }) {
  const { t } = useTranslation('common')
  return <section className="min-w-0 overflow-hidden rounded-2xl border border-ds-border bg-ds-card shadow-sm" data-task-suggestion-card data-state="settled">
    <button type="button" onClick={onExpand} aria-expanded={false}
      className="flex w-full min-w-0 items-center gap-3 px-4 py-2.5 text-left hover:bg-ds-hover">
      <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-[9px] bg-accent-tint/10 text-accent"><ListChecks size={14} aria-hidden /></span>
      <span className="min-w-0 flex-1 truncate text-[13.5px] font-semibold text-ds-ink">{t('taskSuggestion.status.settled', { count: counts.total })}</span>
      {counts.done ? <span className="inline-flex shrink-0 items-center gap-1 text-[12px] text-ds-status-success"><CircleCheck size={12} aria-hidden />{t('taskSuggestion.summary.done', { count: counts.done })}</span> : null}
      {counts.failed ? <span className="inline-flex shrink-0 items-center gap-1 text-[12px] text-ds-status-danger"><TriangleAlert size={12} aria-hidden />{t('taskSuggestion.summary.failed', { count: counts.failed })}</span> : null}
      {counts.ignored ? <span className="inline-flex shrink-0 items-center gap-1 text-[12px] text-ds-faint"><CircleSlash size={12} aria-hidden />{t('taskSuggestion.summary.ignored', { count: counts.ignored })}</span> : null}
      <ChevronRight size={14} className="shrink-0 text-ds-faint" aria-hidden />
    </button>
  </section>
}

/**
 * Suggested follow-up tasks of one assistant turn. Each started row becomes a
 * `task` session nested under this conversation in the sidebar.
 */
export function TaskSuggestionCard({ block, readOnly }: { block: ToolBlock; readOnly: boolean }) {
  const { t } = useTranslation('common')
  const activeThreadId = useChatStore((state) => state.activeThreadId)
  const awaiting = useChatStore((state) => state.awaitingUserInputThreadIds) ?? EMPTY_AWAITING
  const id = block.meta!.taskSuggestionId as string
  const parsed = TaskSuggestionPublicSchema.safeParse(block.meta?.taskSuggestion)
  const { card, act, busy, error } = useTaskSuggestion(id, parsed.success ? parsed.data : undefined)
  const [expanded, setExpanded] = useState(false)
  if (!card) return <section className="rounded-2xl border border-ds-border bg-ds-card p-4 text-[13px] text-ds-muted" role="status">
    {error || t('taskSuggestion.loading')}
  </section>
  const counts = taskCardCounts(card)
  if (card.state === 'settled' && !expanded) return <SettledLine counts={counts} onExpand={() => setExpanded(true)} />
  const locked = readOnly || activeThreadId !== card.source.threadId
  const workspaceName = card.workspace.split(/[\\/]/).filter(Boolean).pop()
  const anyWorktree = card.tasks.some((task) => task.worktree)
  const ghost = 'inline-flex h-[26px] items-center gap-1 rounded-lg px-2.5 text-[12px] font-medium text-ds-muted hover:bg-ds-hover hover:text-ds-ink disabled:opacity-50'
  const outline = 'inline-flex h-[26px] items-center gap-1 rounded-lg border border-ds-border bg-ds-card px-2.5 text-[12px] font-medium text-ds-ink hover:bg-ds-hover disabled:opacity-50'
  const primary = 'inline-flex h-[26px] items-center gap-1 rounded-lg bg-accent px-2.5 text-[12px] font-medium text-white hover:brightness-110 disabled:opacity-50'
  const preStart = card.state === 'suggested' || card.state === 'countdown' || card.state === 'paused'
  return <section className="min-w-0 overflow-hidden rounded-2xl border border-ds-border bg-ds-card shadow-sm"
    data-task-suggestion-card data-intent-id={card.intentId} data-state={card.state}>
    <header className="flex min-w-0 items-start gap-3 px-4 py-3">
      <span className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-xl bg-accent-tint/10 text-accent">
        <ListChecks size={16} aria-hidden />
      </span>
      <div className="min-w-0 flex-1">
        <p className="text-[11.5px] font-medium text-ds-faint">{t('taskSuggestion.kicker')}</p>
        <h4 className="mt-0.5 line-clamp-2 break-words text-[14px] font-semibold leading-5 text-ds-ink" title={card.reason}>
          {t('taskSuggestion.title', { count: counts.total })}
        </h4>
      </div>
      <CardBadge card={card} counts={counts} />
      {card.state === 'settled' ? <button type="button" onClick={() => setExpanded(false)} aria-expanded
        className="mt-1 shrink-0 rounded-md p-0.5 text-ds-faint hover:bg-ds-hover hover:text-ds-ink"><ChevronDown size={14} aria-hidden /></button> : null}
    </header>
    <ol className="border-t border-ds-border-muted" data-task-suggestion-rows>
      {card.tasks.map((task, index) => <TaskSuggestionRow key={task.id} card={card} task={task} index={index}
        phase={taskRowPhase(task, awaiting)} locked={locked} busy={busy} act={act} />)}
    </ol>
    <footer className="flex flex-col gap-2 border-t border-ds-border-muted px-4 pb-3 pt-2.5">
      <div className="flex min-w-0 flex-wrap items-center gap-x-3 gap-y-1.5 text-[12px] text-ds-faint">
        {workspaceName ? <span className="inline-flex min-w-0 items-center gap-1" title={card.workspace}>
          <GitBranch size={12} className="shrink-0" aria-hidden /><span className="truncate">{workspaceName}</span>
        </span> : null}
        <span>{anyWorktree ? t('taskSuggestion.meta.worktreeOn') : t('taskSuggestion.meta.worktreeOff')}</span>
        {card.autoStarted ? <span className="inline-flex items-center gap-1"><Timer size={12} aria-hidden />{t('taskSuggestion.meta.autoStarted')}</span> : null}
        {!locked ? <span className="ml-auto inline-flex flex-wrap items-center gap-1.5">
          {card.state === 'countdown' ? <>
            <button type="button" disabled={busy} className={primary} onClick={() => void act('start')}>{t('taskSuggestion.actions.startNow')}</button>
            <button type="button" disabled={busy} className={ghost} onClick={() => void act('pause')}><Pause size={11} aria-hidden />{t('taskSuggestion.actions.pause')}</button>
          </> : null}
          {card.state === 'paused' ? <button type="button" disabled={busy} className={ghost} onClick={() => void act('resume')}>{t('taskSuggestion.actions.resume')}</button> : null}
          {(card.state === 'suggested' || card.state === 'paused' || card.state === 'active') && counts.suggested > 0 ? <button type="button" disabled={busy}
            className={outline} data-task-start-all onClick={() => void act('start')}>
            <Play size={10} fill="currentColor" aria-hidden />{t('taskSuggestion.actions.startAll', { count: counts.suggested })}
          </button> : null}
          {preStart && counts.suggested > 0 ? <button type="button" disabled={busy} className={ghost}
            onClick={() => void act('ignore')}>{t('taskSuggestion.actions.dismiss')}</button> : null}
        </span> : null}
      </div>
      {preStart && !locked ? <p className="text-[12px] leading-[1.5] text-ds-faint">
        {card.state === 'countdown' ? t('taskSuggestion.meta.routeHint') : t('taskSuggestion.meta.hint')}
      </p> : null}
      {error ? <p role="alert" className="break-words text-xs text-red-600 dark:text-red-300">{error}</p> : null}
    </footer>
  </section>
}
