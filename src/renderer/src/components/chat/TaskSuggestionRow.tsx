import { useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import {
  Check, ChevronDown, ChevronRight, CircleAlert, CircleCheck, CircleSlash, Clock3, Copy, CornerDownRight,
  Hand, Loader2, MoreHorizontal, Play, RotateCcw, Split, X
} from 'lucide-react'
import type { TaskSuggestionActionInput, TaskSuggestionActionName, TaskSuggestionTaskView, TaskSuggestionView } from '@shared/task-suggestions'
import { useChatStore } from '../../store/chat-store'
import { COMPOSER_PREFILL_EVENT, type ComposerPrefillDetail } from '../../artifacts/composer-prefill'
import { AgentDispatchRouteLabel, AgentDispatchRoutePicker } from './AgentDispatchRoutePicker'
import { TaskSuggestionRowDetail } from './TaskSuggestionRowDetail'
import { minutesSince, taskBriefPlainText, taskRowEditable, type TaskRowPhase } from './task-suggestion-card-model'

type Act = (action: TaskSuggestionActionName, input?: TaskSuggestionActionInput) => Promise<unknown>

const small = 'inline-flex h-[26px] shrink-0 items-center gap-1 rounded-lg px-2 text-[12px] font-medium transition disabled:opacity-50'
const link = 'inline-flex shrink-0 items-center gap-0.5 rounded-md px-1.5 py-1 text-[12px] font-medium text-accent hover:bg-ds-hover'

export function openTaskThread(threadId: string | undefined): void {
  if (threadId) void useChatStore.getState().selectThread(threadId)
}

function StartMenu({ task, onClose, act }: { task: TaskSuggestionTaskView; onClose: () => void; act: Act }) {
  const { t } = useTranslation('common')
  const ref = useRef<HTMLDivElement>(null)
  useEffect(() => {
    const onDown = (event: MouseEvent) => { if (!ref.current?.contains(event.target as Node)) onClose() }
    const onKey = (event: KeyboardEvent) => { if (event.key === 'Escape') onClose() }
    document.addEventListener('mousedown', onDown)
    document.addEventListener('keydown', onKey)
    return () => { document.removeEventListener('mousedown', onDown); document.removeEventListener('keydown', onKey) }
  }, [onClose])
  const labels = { goal: t('taskSuggestion.brief.goal'), scope: t('taskSuggestion.brief.scope'), done: t('taskSuggestion.brief.done') }
  const item = 'flex w-full items-center gap-2 rounded-lg px-2.5 py-[7px] text-left text-[12.5px] text-ds-ink hover:bg-ds-hover'
  const run = (fn: () => unknown) => () => { onClose(); void fn() }
  return <div ref={ref} role="menu" className="absolute right-3 top-full z-30 mt-1 w-56 rounded-xl border border-ds-border bg-ds-card p-1.5 shadow-[var(--ds-shadow-overlay)]">
    <button type="button" role="menuitem" className={`${item} bg-ds-hover`} onClick={run(() => act('start', { taskIds: [task.id] }))}>
      <Split size={13} aria-hidden />{t('taskSuggestion.menu.session')}
      <span className="ml-auto text-[11px] text-ds-faint">{t('taskSuggestion.menu.default')}</span>
    </button>
    <button type="button" role="menuitem" className={item} onClick={run(async () => {
      window.dispatchEvent(new CustomEvent<ComposerPrefillDetail>(COMPOSER_PREFILL_EVENT, { detail: { text: taskBriefPlainText(task, labels) } }))
      await act('continue_here', { taskId: task.id })
    })}><CornerDownRight size={13} aria-hidden />{t('taskSuggestion.menu.here')}</button>
    <button type="button" role="menuitem" className={item} onClick={run(() => navigator.clipboard?.writeText(taskBriefPlainText(task, labels)))}>
      <Copy size={13} aria-hidden />{t('taskSuggestion.menu.copy')}</button>
    <div className="mx-1 my-1 border-t border-ds-border-muted" />
    <button type="button" role="menuitem" className={`${item} text-ds-muted`} onClick={run(() => act('ignore', { taskIds: [task.id] }))}>
      <X size={13} aria-hidden />{t('taskSuggestion.menu.ignore')}</button>
  </div>
}

function PhaseLabel({ phase, task }: { phase: TaskRowPhase; task: TaskSuggestionTaskView }) {
  const { t } = useTranslation('common')
  const base = 'inline-flex shrink-0 items-center gap-1 text-[12px] whitespace-nowrap'
  const minutes = minutesSince(task.startedAt, Date.now())
  switch (phase) {
    case 'starting': return <span className={`${base} text-ds-status-running`}><Loader2 size={12} className="animate-spin" aria-hidden />{t('taskSuggestion.row.starting')}</span>
    case 'running': return <span className={`${base} text-ds-status-running`}><Loader2 size={12} className="animate-spin" aria-hidden />
      {minutes !== null && minutes > 0 ? t('taskSuggestion.row.runningFor', { minutes }) : t('taskSuggestion.row.running')}</span>
    case 'waiting': return <span className={`${base} text-ds-status-warning`}><Hand size={12} aria-hidden />{t('taskSuggestion.row.waiting')}</span>
    case 'done': return <span className={`${base} text-ds-status-success`}><CircleCheck size={12} aria-hidden />{t('taskSuggestion.row.done')}</span>
    case 'failed': return <span className={`${base} text-ds-status-danger`}><CircleAlert size={12} aria-hidden />{t('taskSuggestion.row.failed')}</span>
    case 'start_failed': return <span className={`${base} text-ds-status-danger`}><CircleAlert size={12} aria-hidden />{t('taskSuggestion.row.start_failed')}</span>
    case 'cancelled': return <span className={`${base} text-ds-faint`}><CircleSlash size={12} aria-hidden />{t('taskSuggestion.row.cancelled')}</span>
    case 'ignored': return <span className={`${base} text-ds-faint`}><CircleSlash size={12} aria-hidden />{t('taskSuggestion.row.ignored')}</span>
    case 'here': return <span className={`${base} text-ds-faint`}><CornerDownRight size={12} aria-hidden />{t('taskSuggestion.row.here')}</span>
    default: return <span className={`${base} text-ds-faint`}><Clock3 size={12} aria-hidden />{t('taskSuggestion.row.suggested')}</span>
  }
}

function rowSubtitle(task: TaskSuggestionTaskView, t: (key: string, options?: Record<string, unknown>) => string): { text: string; danger: boolean } {
  if (task.state === 'start_failed' && task.failure) {
    return { text: `${t(`taskSuggestion.failure.${task.failure.code}`)} · ${task.failure.message}`, danger: true }
  }
  if ((task.state === 'done' || task.state === 'failed' || task.state === 'cancelled') && task.result) {
    const minutes = task.startedAt && task.settledAt
      ? Math.max(1, Math.round((Date.parse(task.settledAt) - Date.parse(task.startedAt)) / 60_000)) : null
    const parts = [
      minutes ? t('taskSuggestion.report.duration', { minutes }) : '',
      task.branch ? t('taskSuggestion.report.branch', { branch: task.branch }) : '',
      task.result.changedFiles ? t('taskSuggestion.report.changedFiles', { count: task.result.changedFiles }) : '',
      task.result.error ?? ''
    ].filter(Boolean)
    return { text: parts.join(' · '), danger: task.state === 'failed' }
  }
  return { text: task.area ?? '', danger: false }
}

/** One task on the card: number, title, route or live state, and the row's own actions. */
export function TaskSuggestionRow({ card, task, index, phase, locked, busy, act }: {
  card: TaskSuggestionView
  task: TaskSuggestionTaskView
  index: number
  phase: TaskRowPhase
  locked: boolean
  busy: boolean
  act: Act
}) {
  const { t } = useTranslation('common')
  const [open, setOpen] = useState(false)
  const [menu, setMenu] = useState(false)
  const editable = !locked && taskRowEditable(task)
  const countdown = card.state === 'countdown'
  const subtitle = rowSubtitle(task, t)
  const numberTone = task.state === 'done' ? 'bg-ds-success-soft text-ds-status-success'
    : task.state === 'start_failed' || task.state === 'failed' ? 'bg-ds-danger-soft text-ds-status-danger'
      : 'bg-ds-subtle text-ds-muted'
  return <li className={`relative border-b border-ds-border-muted last:border-b-0 ${task.state === 'start_failed' ? 'bg-ds-danger-soft' : ''}`}
    data-task-suggestion-row={task.id} data-state={task.state}>
    <div className="flex min-w-0 items-center gap-3 px-4 py-2.5">
      <span className={`flex h-5 w-5 shrink-0 items-center justify-center rounded-md text-[11px] font-semibold tabular-nums ${numberTone}`}>
        {task.state === 'done' ? <Check size={11} strokeWidth={2.6} aria-hidden /> : index + 1}
      </span>
      <button type="button" onClick={() => setOpen(!open)} aria-expanded={open}
        title={open ? t('taskSuggestion.actions.hideDetails') : t('taskSuggestion.actions.details')}
        className="min-w-0 flex-1 text-left">
        <span className="flex min-w-0 items-center gap-1 text-[13px] font-medium leading-[18px] text-ds-ink">
          {open ? <ChevronDown size={12} className="shrink-0 text-ds-faint" aria-hidden /> : null}
          <span className="truncate">{task.title}</span>
        </span>
        {subtitle.text ? <span className={`mt-px block truncate text-[12px] leading-4 ${subtitle.danger ? 'text-ds-status-danger' : 'text-ds-muted'}`}
          title={subtitle.text}>{subtitle.text}</span> : null}
      </button>
      {task.state === 'suggested' && editable
        ? <AgentDispatchRoutePicker route={task.route} disabled={busy} roleUse="session" workspace={card.workspace}
          onChange={(route) => void act('update', { taskId: task.id, changes: { route } })} />
        : task.state === 'suggested' ? <AgentDispatchRouteLabel route={task.route} /> : null}
      {task.state === 'suggested' && editable && !countdown ? <>
        <button type="button" disabled={busy} data-task-start={task.id} onClick={() => void act('start', { taskIds: [task.id] })}
          className={`${small} bg-accent text-white hover:brightness-110`}>
          <Play size={10} fill="currentColor" aria-hidden />{t('taskSuggestion.actions.start')}
        </button>
        <button type="button" disabled={busy} aria-label={t('taskSuggestion.actions.more')} aria-haspopup="menu" aria-expanded={menu}
          onClick={() => setMenu(!menu)} className={`${small} w-[26px] justify-center px-0 text-ds-faint hover:bg-ds-hover hover:text-ds-ink`}>
          <MoreHorizontal size={14} aria-hidden />
        </button>
      </> : <PhaseLabel phase={phase} task={task} />}
      {task.state === 'start_failed' && editable ? <>
        <button type="button" disabled={busy} onClick={() => void act('retry', { taskId: task.id })}
          className={`${small} border border-ds-border bg-ds-card text-ds-ink hover:bg-ds-hover`}>
          <RotateCcw size={11} aria-hidden />{t('taskSuggestion.actions.retry')}</button>
        {task.worktree ? <button type="button" disabled={busy}
          onClick={() => void act('retry', { taskId: task.id, changes: { worktree: false } })}
          className={`${small} text-ds-muted hover:bg-ds-hover hover:text-ds-ink`}>{t('taskSuggestion.actions.noWorktree')}</button> : null}
      </> : null}
      {task.threadId && task.state !== 'starting' && task.state !== 'start_failed' ? <button type="button" className={link}
        onClick={() => openTaskThread(task.threadId)} data-task-open={task.id}>
        {task.state === 'done' ? t('taskSuggestion.actions.viewResult') : t('taskSuggestion.actions.open')}
        <ChevronRight size={13} aria-hidden />
      </button> : null}
    </div>
    {menu ? <StartMenu task={task} act={act} onClose={() => setMenu(false)} /> : null}
    {open ? <TaskSuggestionRowDetail task={task} locked={locked} busy={busy} act={act} /> : null}
  </li>
}
