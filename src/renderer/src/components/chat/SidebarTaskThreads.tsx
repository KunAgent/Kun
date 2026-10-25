import { createContext, useCallback, useContext, useMemo, useState, type MouseEvent as ReactMouseEvent, type ReactElement, type ReactNode } from 'react'
import { useTranslation } from 'react-i18next'
import { Archive, ChevronDown, ChevronRight, CircleAlert, CircleCheck, CircleHelp, CornerUpLeft, Split, Trash2 } from 'lucide-react'
import type { NormalizedThread } from '../../agent/types'
import { SidebarActivityIndicator } from '../sidebar/SidebarActivityIndicator'
import { SidebarIconButton } from '../sidebar/SidebarPrimitives'
import type { SidebarThreadActivity } from './sidebar-project-selectors'
import { loadCollapsedTaskGroups, saveCollapsedTaskGroups, strongestTaskActivity, taskGroupCounts } from './sidebar-task-threads'

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

type TaskGroupState = { collapsed: ReadonlySet<string>; toggle: (parentId: string) => void }

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
  const merged = useMemo(() => ({ ...value, collapsed, toggle }), [value, collapsed, toggle])
  return <TaskThreadsContext.Provider value={merged}>{children}</TaskThreadsContext.Provider>
}

export type SidebarTaskGroup = {
  children: NormalizedThread[]
  collapsed: boolean
  toggle: () => void
  activity: SidebarThreadActivity
  started: number
  total: number
}

/** Task sessions nested under one parent row, or null when it has none (or no provider). */
export function useSidebarTaskGroup(parentId: string): SidebarTaskGroup | null {
  const context = useContext(TaskThreadsContext)
  const children = context?.childrenByParent.get(parentId)
  if (!context || !children?.length) return null
  const activeChild = children.some((child) => child.id === context.activeThreadId)
  // A collapsed group reopens while one of its sessions is the open conversation.
  const collapsed = context.collapsed.has(parentId) && !activeChild
  return {
    children, collapsed, toggle: () => context.toggle(parentId),
    activity: strongestTaskActivity(children.map((child) => context.activityOf(child))),
    ...taskGroupCounts(children)
  }
}

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
  return <span title={t('taskSuggestion.sidebar.count', { started: group.started, total: group.total })} data-task-group-chip
    className={`inline-flex shrink-0 items-center gap-[3px] rounded-md border px-[5px] text-[10.5px] leading-4 tabular-nums ${tone}`}>
    {icon}{group.collapsed ? group.children.length : `${group.started}/${group.total}`}
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
  </div>
}
