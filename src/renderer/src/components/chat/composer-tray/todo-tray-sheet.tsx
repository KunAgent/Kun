import { useId, useState, type ReactElement, type ReactNode } from 'react'
import { ArrowRight, Circle, CircleCheck, CircleDot, CircleSlash, CircleX } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import type { ThreadTodoItem, ThreadTodoList } from '../../../agent/types'
import {
  TrayFoldRow,
  TrayRow,
  TraySheetBody,
  TraySheetHeader,
  TrayStatusPill
} from './tray-primitives'
import { elapsedSecondsSince, formatTrayDuration, useTrayNow } from './tray-elapsed'
import {
  TODO_FLAG_TONE,
  getTodoProgress,
  isTodoItemActive,
  isTodoItemCompleted,
  isTodoItemOpen,
  resolveTodoPlanPath,
  todoItemFlag
} from './todo-progress'
import { resolveTodoFocusWindow, summarizeTodoFold, type TodoRange } from './todo-focus-window'
import { TodoOwnerLabel } from './todo-owner-label'

/*
 * Todo sheet (Todo board): header "任务清单 · 来自 <plan> · 4 / 12", then the
 * checklist in its original order. Long lists keep a focus window around the
 * current step with the earlier / later runs folded; each fold row toggles
 * its run open in place. While a Graph run owns progress the sheet is a
 * plain plan outline: every item, no current step, and a one-line note.
 */

type TodoRowState = 'done' | 'current' | 'active' | 'failed' | 'cancelled' | 'pending'

const ICON_CLASS = 'h-3.5 w-3.5'

export function TodoTraySheet({
  todos,
  outline,
  live,
  compact,
  onClose
}: {
  todos: ThreadTodoList
  /** A Graph run owns live progress: show the plan outline only. */
  outline: boolean
  /** The thread is running, so the current step's elapsed time ticks. */
  live: boolean
  compact: boolean
  onClose: () => void
}): ReactElement {
  const { t } = useTranslation('common')
  const [expandedBefore, setExpandedBefore] = useState(false)
  const [expandedAfter, setExpandedAfter] = useState(false)
  const beforeId = useId()
  const afterId = useId()
  const items = todos.items
  const total = items.length
  const progress = getTodoProgress(items)
  const currentIndex = outline ? -1 : progress.current - 1
  const planPath = resolveTodoPlanPath(items)
  const focus = outline
    ? { before: null, visible: { start: 0, end: total }, after: null }
    : resolveTodoFocusWindow(total, currentIndex)

  const renderRows = (range: TodoRange): ReactNode[] => items.slice(range.start, range.end).map((item, offset) => (
    <TodoTrayRow
      key={item.id}
      item={item}
      index={range.start + offset}
      total={total}
      current={range.start + offset === currentIndex && isTodoItemOpen(item)}
      live={live}
      compact={compact}
      planPath={planPath}
      listThreadId={todos.threadId}
    />
  ))

  return (
    <div data-todo-sheet={outline ? 'outline' : 'progress'}>
      <TraySheetHeader
        title={outline ? t('composerTrayTodo.outlineLabel') : t('composerTrayTodo.title')}
        summary={planPath ? (
          <>
            {t('composerTrayTodo.fromPlan')}{' '}
            <span className="font-mono" data-todo-plan-path>{planPath}</span>
          </>
        ) : undefined}
        actions={(
          <span className="px-1 text-[12px] tabular-nums text-ds-faint" data-todo-sheet-count>
            {outline
              ? t('composerTrayTodo.outlineSteps', { count: total })
              : `${progress.current} / ${progress.total}`}
          </span>
        )}
        onCollapse={onClose}
      />
      {outline ? (
        <p
          data-todo-plan-outline-hint
          className="truncate px-2.5 pb-1.5 text-[12px] leading-[18px] text-ds-faint"
          title={t('composerTrayTodo.outlineNote')}
        >
          {t('composerTrayTodo.outlineNote')}
        </p>
      ) : null}
      <TraySheetBody>
        {focus.before ? (
          <TodoFold
            id={beforeId}
            position="before"
            expanded={expandedBefore}
            onToggle={() => setExpandedBefore((value) => !value)}
            items={items}
            range={focus.before}
          >
            {expandedBefore ? renderRows(focus.before) : null}
          </TodoFold>
        ) : null}
        <div role="list" className="flex flex-col gap-0.5" aria-label={t('composerTrayTodo.title')}>
          {renderRows(focus.visible)}
        </div>
        {focus.after ? (
          <TodoFold
            id={afterId}
            position="after"
            expanded={expandedAfter}
            onToggle={() => setExpandedAfter((value) => !value)}
            items={items}
            range={focus.after}
          >
            {expandedAfter ? renderRows(focus.after) : null}
          </TodoFold>
        ) : null}
      </TraySheetBody>
    </div>
  )
}

/** Fold row plus the run it reveals (rendered under the row when expanded). */
function TodoFold({
  id,
  position,
  expanded,
  onToggle,
  items,
  range,
  children
}: {
  id: string
  position: 'before' | 'after'
  expanded: boolean
  onToggle: () => void
  items: readonly ThreadTodoItem[]
  range: TodoRange
  children: ReactNode
}): ReactElement {
  const { t } = useTranslation('common')
  const summary = summarizeTodoFold(items, range)
  const count = summary.count
  const label = position === 'before'
    ? t(summary.allCompleted ? 'composerTrayTodo.foldDone' : 'composerTrayTodo.foldEarlier', { count })
    : t(summary.noneCompleted ? 'composerTrayTodo.foldRemaining' : 'composerTrayTodo.foldLater', { count })
  const pills = summary.blocked > 0 || summary.failed > 0 ? (
    <>
      {summary.blocked > 0 ? (
        <TrayStatusPill tone="waiting">{t('composerTrayTodo.blockedCount', { count: summary.blocked })}</TrayStatusPill>
      ) : null}
      {summary.failed > 0 ? (
        <TrayStatusPill tone="error">{t('composerTrayTodo.failedCount', { count: summary.failed })}</TrayStatusPill>
      ) : null}
    </>
  ) : undefined
  return (
    <>
      <span className="contents" data-todo-fold={position}>
        <TrayFoldRow expanded={expanded} onToggle={onToggle} label={label} trailing={pills} controls={id} />
      </span>
      {/* `hidden` alone: a display utility here would override it and leave a gap. */}
      <div id={id} role="list" className={expanded ? 'flex flex-col gap-0.5' : undefined} hidden={!expanded} aria-label={label}>
        {children}
      </div>
    </>
  )
}

function rowState(item: ThreadTodoItem, current: boolean): TodoRowState {
  if (current) return 'current'
  if (isTodoItemCompleted(item)) return 'done'
  const flag = todoItemFlag(item)
  if (flag === 'failed' || flag === 'cancelled') return flag
  return isTodoItemActive(item) ? 'active' : 'pending'
}

function TodoRowIcon({ state }: { state: TodoRowState }): ReactElement {
  switch (state) {
    case 'done':
      return <CircleCheck className={`${ICON_CLASS} text-ds-status-success`} strokeWidth={2.2} />
    case 'current':
      return <ArrowRight className={`${ICON_CLASS} text-ds-ink`} strokeWidth={2.2} />
    case 'active':
      return <CircleDot className={`${ICON_CLASS} text-ds-status-running`} strokeWidth={2.2} />
    case 'failed':
      return <CircleX className={`${ICON_CLASS} text-ds-status-danger`} strokeWidth={2.2} />
    case 'cancelled':
      return <CircleSlash className={`${ICON_CLASS} text-ds-faint`} strokeWidth={2} />
    default:
      return <Circle className={`${ICON_CLASS} text-ds-faint`} strokeWidth={2} />
  }
}

function TodoTrayRow({
  item,
  index,
  total,
  current,
  live,
  compact,
  planPath,
  listThreadId
}: {
  item: ThreadTodoItem
  index: number
  total: number
  current: boolean
  live: boolean
  compact: boolean
  planPath: string | null
  listThreadId: string
}): ReactElement {
  const { t } = useTranslation('common')
  const state = rowState(item, current)
  const flag = todoItemFlag(item)
  const statusLabel = item.taskStatus
    ? t(`executionTaskStatus.${item.taskStatus}`, { defaultValue: item.taskStatus })
    : t(`todoStatus.${item.status}`)
  const textClass = state === 'done'
    ? 'text-ds-faint line-through decoration-ds-border'
    : state === 'cancelled'
      ? 'text-ds-faint'
      : state === 'current'
        ? 'font-semibold text-ds-ink'
        : 'text-ds-ink'
  // Rows from several plans name their own source; one plan sits in the header.
  const source = !planPath && item.source?.kind === 'plan'
    ? `${item.source.relativePath} · ${item.source.ordinal + 1}`
    : null
  const owner = item.ownerThreadId && item.ownerThreadId !== listThreadId ? item.ownerThreadId : null
  const detail = item.reason || source ? (
    <span className="-mt-1 flex min-w-0 flex-col gap-0.5 pl-6 text-[12px] leading-[17px] text-ds-faint">
      {item.reason ? <span className="break-words [overflow-wrap:anywhere]" data-todo-reason>{item.reason}</span> : null}
      {source ? <span className="truncate font-mono" data-todo-source>{source}</span> : null}
    </span>
  ) : undefined

  return (
    <TrayRow
      role="listitem"
      aria-posinset={index + 1}
      aria-setsize={total}
      data-todo-item={item.id}
      data-todo-state={state}
      data-todo-current={current ? 'true' : undefined}
      highlighted={current}
      leading={<span aria-hidden="true" className="inline-flex"><TodoRowIcon state={state} /></span>}
      title={(
        // One flex line, so the step text keeps the space: the owner name
        // gives way first (down to its avatar), the meta stays at most 45%.
        <span className="flex min-w-0 items-baseline gap-2">
          <span className={`min-w-0 truncate ${textClass}`} title={item.content}>
            {flag ? null : <span className="sr-only">{statusLabel}: </span>}
            {item.content}
          </span>
          {current && !flag ? <TodoCurrentMeta item={item} live={live} /> : null}
          {flag ? (
            <TrayStatusPill tone={TODO_FLAG_TONE[flag]} className="ml-auto self-center">{statusLabel}</TrayStatusPill>
          ) : null}
          {owner ? <TodoOwnerLabel ownerThreadId={owner} compact={compact} className={flag ? undefined : 'ml-auto'} /> : null}
        </span>
      )}
      detail={detail}
    />
  )
}

/**
 * "正在做 · 4 分钟" for a running current step (elapsed since its last status
 * change, ticking only while the thread runs), "正在做" when the time is not
 * known, "下一步" when the current step has not started.
 */
function TodoCurrentMeta({ item, live }: { item: ThreadTodoItem; live: boolean }): ReactElement {
  const { t } = useTranslation('common')
  const active = isTodoItemActive(item)
  const ticking = active && live
  const nowMs = useTrayNow(ticking, 15_000)
  const elapsed = ticking ? elapsedSecondsSince(item.updatedAt, nowMs) : null
  const text = !active
    ? t('composerTrayTodo.upNext')
    : elapsed == null
      ? t('composerTrayTodo.inProgress')
      : t('composerTrayTodo.inProgressFor', { duration: formatTrayDuration(elapsed, t, 'minutes') })
  return (
    <span className="max-w-[45%] shrink-0 truncate text-[12px] font-normal tabular-nums text-ds-faint" data-todo-current-meta>
      {text}
    </span>
  )
}
