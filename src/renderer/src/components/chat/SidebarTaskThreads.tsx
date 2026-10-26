import { createContext, useCallback, useContext, useMemo, useState, type MouseEvent as ReactMouseEvent, type ReactElement, type ReactNode } from 'react'
import { useTranslation } from 'react-i18next'
import { Archive, ChevronDown, ChevronRight, CircleAlert, CircleCheck, CircleHelp, CornerUpLeft, Split, Square, Trash2 } from 'lucide-react'
import type { NormalizedThread } from '../../agent/types'
import { useActivityStore } from '../../store/activity-store'
import { SidebarActivityIndicator } from '../sidebar/SidebarActivityIndicator'
import { SidebarIconButton } from '../sidebar/SidebarPrimitives'
import type { SidebarThreadActivity } from './sidebar-project-selectors'
import { loadCollapsedTaskGroups, saveCollapsedTaskGroups, strongestTaskActivity, taskGroupCounts } from './sidebar-task-threads'
import { AgentIcon } from '../agent-icon'
import { selectSidebarWorkerRows, type SidebarWorkerRow } from './sidebar-worker-rows'

type SidebarTaskThreadsValue = {
  childrenByParent: Map<string, NormalizedThread[]>
  /** The sidebar's own activity rule (running, awaiting input, unread...) for one thread. */
  activityOf: (thread: NormalizedThread) => SidebarThreadActivity
  activeThreadId: string | null
  onSelect: (threadId: string) => void
  onContextMenu: (event: ReactMouseEvent<HTMLDivElement>, thread: NormalizedThread) => void
  onArchive: (thread: NormalizedThread) => void | Promise<void>
  onDelete: (thread: NormalizedThread) => void | Promise<void>
}

type TaskGroupState = {
  collapsed: ReadonlySet<string>
  toggle: (parentId: string) => void
  /** Dispatched workers by parent thread; they are side threads the thread list omits. */
  workersByParent: ReadonlyMap<string, SidebarWorkerRow[]>
}

const TaskThreadsContext = createContext<(SidebarTaskThreadsValue & TaskGroupState) | null>(null)

export function SidebarTaskThreadsProvider({ value, children }: { value: SidebarTaskThreadsValue; children: ReactNode }) {
  const [collapsed, setCollapsed] = useState<ReadonlySet<string>>(loadCollapsedTaskGroups)
  const toggle = useCallback((parentId: string) => setCollapsed((current) => {
    const next = new Set(current)
    if (next.has(parentId)) next.delete(parentId)
    else next.add(parentId)
    saveCollapsedTaskGroups(next)
    return next
  }), [])
  const activityRows = useActivityStore((state) => state.rows)
  const workersByParent = useMemo(() => selectSidebarWorkerRows(activityRows), [activityRows])
  const merged = useMemo(() => ({ ...value, collapsed, toggle, workersByParent }), [value, collapsed, toggle, workersByParent])
  return <TaskThreadsContext.Provider value={merged}>{children}</TaskThreadsContext.Provider>
}

export type SidebarTaskGroup = {
  children: NormalizedThread[]
  workers: SidebarWorkerRow[]
  collapsed: boolean
  toggle: () => void
  activity: SidebarThreadActivity
  started: number
  total: number
}

/** Task sessions and dispatched workers nested under one parent row, or null when it has none (or no provider). */
export function useSidebarTaskGroup(parentId: string): SidebarTaskGroup | null {
  const context = useContext(TaskThreadsContext)
  const children = context?.childrenByParent.get(parentId) ?? NO_THREADS
  const workers = context?.workersByParent.get(parentId) ?? NO_WORKERS
  if (!context || (!children.length && !workers.length)) return null
  const activeChild = children.some((child) => child.id === context.activeThreadId) ||
    workers.some((worker) => worker.threadId === context.activeThreadId)
  // A collapsed group reopens while one of its sessions is the open conversation.
  const collapsed = context.collapsed.has(parentId) && !activeChild
  return {
    children, workers, collapsed, toggle: () => context.toggle(parentId),
    activity: strongestTaskActivity([...children.map((child) => context.activityOf(child)), ...workers.map((worker) => worker.activity)]),
    ...taskGroupCounts(children)
  }
}

const NO_THREADS: NormalizedThread[] = []
const NO_WORKERS: SidebarWorkerRow[] = []

/** Disclosure arrow shown before a parent row's title. */
export function TaskGroupChevron({ group }: { group: SidebarTaskGroup }): ReactElement {
  const { t } = useTranslation('common')
  const label = group.collapsed ? t('taskSuggestion.sidebar.expand') : t('taskSuggestion.sidebar.collapse')
  return <span role="button" tabIndex={0} aria-label={label} title={label} aria-expanded={!group.collapsed}
    data-task-group-toggle
    onPointerDown={(event) => event.stopPropagation()}
    onClick={(event) => { event.stopPropagation(); group.toggle() }}
    onKeyDown={(event) => { if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); event.stopPropagation(); group.toggle() } }}
    className="-ml-1 flex h-4 w-4 shrink-0 items-center justify-center rounded text-ds-faint hover:bg-[var(--ds-sidebar-row-hover)] hover:text-ds-ink">
    {group.collapsed ? <ChevronRight className="h-3 w-3" strokeWidth={2} aria-hidden /> : <ChevronDown className="h-3 w-3" strokeWidth={2} aria-hidden />}
  </span>
}

/** started/total chip; once collapsed it carries the most urgent child state. */
export function TaskGroupChip({ group }: { group: SidebarTaskGroup }): ReactElement {
  const { t } = useTranslation('common')
  const tone = !group.collapsed ? 'text-ds-muted border-ds-border-muted'
    : group.activity === 'failed' ? 'text-ds-status-danger border-ds-status-danger bg-ds-danger-soft'
      : group.activity === 'awaiting-input' ? 'text-ds-status-warning border-ds-status-warning bg-[var(--ds-warning-soft)]'
        : 'text-ds-muted border-ds-border-muted'
  const icon = group.collapsed && group.activity === 'failed' ? <CircleAlert className="h-2.5 w-2.5" strokeWidth={2.4} aria-hidden />
    : group.collapsed && group.activity === 'awaiting-input' ? <CircleHelp className="h-2.5 w-2.5" strokeWidth={2.4} aria-hidden />
      : group.collapsed && group.activity === 'read' ? <CircleCheck className="h-2.5 w-2.5" strokeWidth={2.4} aria-hidden />
        : <Split className="h-2.5 w-2.5" strokeWidth={2} aria-hidden />
  const workersOnly = !group.children.length
  const running = group.workers.filter((worker) => worker.activity === 'running').length
  const label = group.collapsed ? group.children.length + group.workers.length
    : workersOnly ? (running || group.workers.length) : `${group.started}/${group.total}`
  const title = workersOnly ? t('taskSuggestion.sidebar.workers', { count: group.workers.length })
    : t('taskSuggestion.sidebar.count', { started: group.started, total: group.total })
  return <span title={title} data-task-group-chip
    className={`inline-flex shrink-0 items-center gap-[3px] rounded-md border px-[5px] text-[10.5px] leading-4 tabular-nums ${tone}`}>
    {icon}{label}
  </span>
}

function TaskThreadRow({ thread, parentId, context }: {
  thread: NormalizedThread
  parentId: string
  context: SidebarTaskThreadsValue
}): ReactElement {
  const { t } = useTranslation('common')
  const active = context.activeThreadId === thread.id
  const activity = context.activityOf(thread)
  const indicator = activity === 'running' || activity === 'failed' || activity === 'awaiting-input' || activity === 'unread' ? activity : null
  return <div role="treeitem" aria-selected={active} data-task-thread-row={thread.id}
    className={`group relative flex min-h-[30px] min-w-0 cursor-pointer items-center gap-1.5 rounded-[9px] border px-2 py-1 text-[12.5px] leading-[18px] text-ds-ink transition
      before:absolute before:-left-2.5 before:top-1/2 before:w-2 before:border-t before:border-ds-border before:content-[''] ${
      active ? 'border-[var(--ds-sidebar-row-ring)] bg-[var(--ds-sidebar-row-active)]' : 'border-transparent hover:bg-[var(--ds-sidebar-row-hover)]'
    } ${activity === 'read' && !active ? 'text-ds-muted' : ''}`}
    onClick={() => context.onSelect(thread.id)}
    onContextMenu={(event) => context.onContextMenu(event, thread)}
    title={thread.title}>
    <span className={`min-w-0 flex-1 truncate ${activity === 'unread' && !active ? 'font-semibold' : ''}`}>{thread.title}</span>
    <span className="flex shrink-0 items-center group-hover:opacity-0 group-focus-within:opacity-0">
      {indicator ? <SidebarActivityIndicator activity={indicator} runningLabel={t('sidebarThreadRunning')}
        failedLabel={t('sidebarThreadFailed')} unreadLabel={t('sidebarThreadUnread')} awaitingInputLabel={t('sidebarThreadAwaitingInput')} /> : null}
    </span>
    <span className="absolute right-1 top-1/2 hidden -translate-y-1/2 items-center gap-0.5 rounded-lg bg-[var(--ds-sidebar-row-hover)] p-0.5 group-hover:flex group-focus-within:flex">
      <SidebarIconButton title={t('taskSuggestion.session.back')} onClick={() => context.onSelect(parentId)} stopPropagation className="h-6 w-6">
        <CornerUpLeft className="h-3 w-3" strokeWidth={1.9} />
      </SidebarIconButton>
      <SidebarIconButton title={t('sidebarThreadArchive')} onClick={() => void context.onArchive(thread)} stopPropagation className="h-6 w-6">
        <Archive className="h-3 w-3" strokeWidth={1.9} />
      </SidebarIconButton>
      <SidebarIconButton title={t('sidebarThreadDelete')} tone="danger" onClick={() => void context.onDelete(thread)} stopPropagation className="h-6 w-6">
        <Trash2 className="h-3 w-3" strokeWidth={1.9} />
      </SidebarIconButton>
    </span>
  </div>
}

/** The nested rows under an expanded parent, joined by a tree line. */
export function TaskThreadChildren({ parentId, group }: { parentId: string; group: SidebarTaskGroup }): ReactElement | null {
  const context = useContext(TaskThreadsContext)
  if (!context || group.collapsed) return null
  return <div role="group" data-task-thread-children={parentId}
    className="relative ml-[17px] mt-0.5 flex flex-col gap-0.5 pl-2.5 before:absolute before:bottom-3 before:left-0 before:top-0 before:border-l before:border-ds-border before:content-['']">
    {group.children.map((child) => <TaskThreadRow key={child.id} thread={child} parentId={parentId} context={context} />)}
    {group.workers.length ? <WorkerRows workers={group.workers} labelled={group.children.length > 0} context={context} /> : null}
  </div>
}

const WORKER_END_LABEL: Partial<Record<SidebarThreadActivity, string>> = {
  failed: 'sidebarThreadFailed', 'awaiting-input': 'sidebarThreadAwaitingInput'
}

function WorkerRows({ workers, labelled, context }: { workers: SidebarWorkerRow[]; labelled: boolean; context: SidebarTaskThreadsValue }): ReactElement {
  const { t } = useTranslation('common')
  return <>
    {labelled || workers.length > 1 ? <div data-worker-group-label className="flex h-[22px] items-center gap-1.5 px-2 text-[11px] text-ds-faint">
      <Split className="h-3 w-3" strokeWidth={1.9} aria-hidden />{t('taskSuggestion.sidebar.workers', { count: workers.length })}
    </div> : null}
    {workers.map((worker) => {
      const active = context.activeThreadId === worker.threadId
      const indicator = worker.activity === 'running' || worker.activity === 'failed' || worker.activity === 'awaiting-input' ? worker.activity : null
      const endLabel = WORKER_END_LABEL[worker.activity]
      const end = endLabel ? t(endLabel) : worker.activity === 'running' ? worker.detail : ''
      return <div key={worker.unitId} role="treeitem" aria-selected={active} data-worker-row={worker.unitId}
        className={`group relative flex min-h-[30px] min-w-0 cursor-pointer items-center gap-2 rounded-[9px] border px-2 py-1 text-[12.5px] leading-[18px] text-ds-ink transition
          before:absolute before:-left-2.5 before:top-1/2 before:w-2 before:border-t before:border-ds-border before:content-[''] ${
          active ? 'border-[var(--ds-sidebar-row-ring)] bg-[var(--ds-sidebar-row-active)]' : 'border-transparent hover:bg-[var(--ds-sidebar-row-hover)]'
        } ${worker.activity === 'read' && !active ? 'text-ds-muted' : ''}`}
        onClick={() => context.onSelect(worker.threadId)} title={worker.title}>
        <span aria-hidden className="flex h-[18px] w-[18px] shrink-0 items-center justify-center">
          <AgentIcon harnessId={worker.harnessId} size={16} />
        </span>
        <span className="min-w-0 flex-1 truncate">{worker.title}</span>
        <span className="flex max-w-[45%] shrink-0 items-center gap-1.5 group-hover:opacity-0 group-focus-within:opacity-0">
          {end ? <span className={`truncate text-[11.5px] ${worker.activity === 'failed' ? 'text-ds-status-danger' : worker.activity === 'awaiting-input' ? 'text-ds-status-warning' : 'text-ds-faint'}`}>{end}</span> : null}
          {indicator ? <SidebarActivityIndicator activity={indicator} runningLabel={t('sidebarThreadRunning')}
            failedLabel={t('sidebarThreadFailed')} unreadLabel={t('sidebarThreadUnread')} awaitingInputLabel={t('sidebarThreadAwaitingInput')} /> : null}
          {worker.activity === 'read' ? <CircleCheck className="h-3 w-3 text-ds-status-success" strokeWidth={2.2} aria-label={t('taskSuggestion.sidebar.workerDone')} /> : null}
        </span>
        {worker.activity === 'running' || worker.activity === 'awaiting-input' ? <span className="absolute right-1 top-1/2 hidden -translate-y-1/2 items-center gap-0.5 rounded-lg bg-[var(--ds-sidebar-row-hover)] p-0.5 group-hover:flex group-focus-within:flex">
          <SidebarIconButton title={t('taskSuggestion.sidebar.workerStop')} tone="danger" stopPropagation className="h-6 w-6"
            onClick={() => { if (worker.turnId) void import('../../agent/registry').then(({ getProvider }) => getProvider().interruptTurn(worker.threadId, worker.turnId!)).catch(() => undefined) }}>
            <Square className="h-3 w-3" strokeWidth={1.9} />
          </SidebarIconButton>
        </span> : null}
      </div>
    })}
  </>
}
