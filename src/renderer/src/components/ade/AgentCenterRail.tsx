import { useState, type DragEvent, type KeyboardEvent, type ReactElement } from 'react'
import { Check, ChevronDown, GripVertical, LoaderCircle, Search, X } from 'lucide-react'
import { AgentIcon } from '../agent-icon'
import { AgentElapsed, AgentStatusDot } from './AgentCenterParts'
import { agentLineText, type AgentPresentation } from './agent-center-presentation'
import type { AgentListEntry, AgentListGroup } from './agent-center-catalog'

type T = (key: string, options?: Record<string, unknown>) => string

type DropTarget = { id: string; before: boolean }

/**
 * The Agent list: search, three groups, drag or Alt+Arrow
 * to reorder the connected ones, and a fold for the long "not installed" tail.
 */
export function AgentCenterRail({ groups, selectedId, defaultId, search, expanded, onSearch, onToggleExpanded, onSelect, onMove, onFindExtensions, t }: {
  groups: AgentListGroup[]
  selectedId?: string
  defaultId: string
  search: string
  expanded: boolean
  onSearch: (value: string) => void
  onToggleExpanded: () => void
  onSelect: (id: string) => void
  /** `targetIndex` is the Agent's new position among the connected Agents. */
  onMove: (id: string, targetIndex: number) => void
  onFindExtensions?: () => void
  t: T
}): ReactElement {
  const [dragging, setDragging] = useState<string | null>(null)
  const [target, setTarget] = useState<DropTarget | null>(null)
  const [announcement, setAnnouncement] = useState('')
  const connected = groups.find((group) => group.id === 'connected')?.entries ?? []
  const connectedIds = connected.map((entry) => entry.row.definition.id)
  // A filtered list hides some connected Agents, so a move could not say where they go.
  const reorderable = connectedIds.length > 1 && !search.trim()
  const folded = groups.find((group) => group.id === 'notInstalled')

  const move = (id: string, targetIndex: number): void => {
    const total = connectedIds.length
    const position = Math.max(0, Math.min(total - 1, targetIndex))
    onMove(id, position)
    const name = connected.find((entry) => entry.row.definition.id === id)?.row.definition.displayName ?? id
    setAnnouncement(t('agentCenter.rail.moved', { name, position: position + 1, total }))
  }

  const navigate = (event: KeyboardEvent<HTMLButtonElement>, entry: AgentListEntry): void => {
    const id = entry.row.definition.id
    const connectedIndex = connectedIds.indexOf(id)
    if (event.altKey && reorderable && connectedIndex !== -1 && (event.key === 'ArrowUp' || event.key === 'ArrowDown')) {
      event.preventDefault()
      move(id, connectedIndex + (event.key === 'ArrowDown' ? 1 : -1))
      return
    }
    const items = [...event.currentTarget.closest('[data-agent-catalog-rail]')?.querySelectorAll<HTMLButtonElement>('[data-agent-list-id]') ?? []]
    const index = items.indexOf(event.currentTarget)
    let next: number
    switch (event.key) {
      case 'ArrowDown': next = Math.min(items.length - 1, index + 1); break
      case 'ArrowUp': next = Math.max(0, index - 1); break
      case 'Home': next = 0; break
      case 'End': next = items.length - 1; break
      default: return
    }
    event.preventDefault()
    const element = items[next]
    if (!element) return
    onSelect(element.getAttribute('data-agent-list-id') ?? id)
    element.focus()
  }

  const dragOver = (event: DragEvent<HTMLButtonElement>, id: string): void => {
    if (!dragging) return
    event.preventDefault()
    const rect = event.currentTarget.getBoundingClientRect()
    const before = event.clientY < rect.top + rect.height / 2
    // dragover fires continuously; only a new drop position needs a render.
    setTarget((current) => current?.id === id && current.before === before ? current : { id, before })
  }
  const drop = (event: DragEvent<HTMLButtonElement>): void => {
    event.preventDefault()
    if (dragging && target && dragging !== target.id) {
      const rest = connectedIds.filter((id) => id !== dragging)
      move(dragging, rest.indexOf(target.id) + (target.before ? 0 : 1))
    }
    setDragging(null)
    setTarget(null)
  }

  // The column's tint and divider live on its wrapper, which spans the full row; this box is
  // capped to the viewport so the list below can scroll instead of running off the window.
  return <div className="ds-agent-rail flex min-h-0 min-w-0 flex-1 flex-col" data-agent-catalog-rail-column>
    <div className="px-3 pb-1 pt-3" data-agent-catalog-toolbar>
      <div className="relative">
        <Search size={14} aria-hidden="true" className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-ds-faint" />
        <input type="search" value={search} onChange={(event) => onSearch(event.target.value)}
          aria-label={t('agentIntegrations.search')} placeholder={t('agentIntegrations.search')}
          data-agent-catalog-search
          className="h-8 w-full rounded-[9px] border border-ds-border bg-ds-card pl-8 pr-9 text-[12.5px] text-ds-ink placeholder:text-ds-faint focus:border-accent focus:outline-none [&::-webkit-search-cancel-button]:hidden" />
        {search ? <button type="button" onClick={() => onSearch('')} aria-label={t('agentIntegrations.clearSearch')}
          className="absolute right-0.5 top-1/2 grid h-7 w-7 -translate-y-1/2 place-items-center rounded-md text-ds-muted hover:bg-ds-hover focus-visible:ring-2 focus-visible:ring-accent">
          <X size={13} />
        </button> : null}
      </div>
    </div>
    <div role="listbox" aria-label={t('agentCenter.title')} aria-orientation="vertical" data-agent-catalog-rail
      className="flex max-h-72 min-h-0 min-w-0 flex-col overflow-y-auto px-2 pb-2 lg:max-h-none lg:flex-1">
      {groups.map((group) => {
        const label = t(`agentCenter.group.${group.id}`)
        return <div key={group.id} role="group" aria-label={label} data-agent-group={group.id} className="flex flex-col gap-0.5">
          <div className="flex items-center justify-between px-2 pb-1.5 pt-3.5 text-[11.5px] font-semibold text-ds-faint"
            title={group.id === 'connected' && reorderable ? t('agentCenter.rail.reorderHint') : undefined}>
            <span>{label}</span><span className="font-medium tabular-nums">{group.total}</span>
          </div>
          {group.entries.map((entry) => {
            const { row, presentation } = entry
            const id = row.definition.id
            const selected = selectedId === id
            const draggable = group.id === 'connected' && reorderable
            const dropBefore = target && target.id === id && dragging !== id ? target.before : undefined
            const activity = presentation.activity
            const running = activity?.tone === 'running'
            return <div key={id} className="relative">
              {dropBefore === true ? <span aria-hidden className="absolute -top-px left-2 right-2 h-0.5 rounded bg-accent" /> : null}
              <button type="button" role="option" data-agent-list-id={id} data-selected={selected || undefined}
                data-agent-state={presentation.state} data-agent-activity={activity ? `${activity.kind}:${activity.tone}` : undefined}
                aria-selected={selected} tabIndex={selected ? 0 : -1}
                draggable={draggable}
                onDragStart={draggable ? (event) => { event.dataTransfer.effectAllowed = 'move'; event.dataTransfer.setData('text/plain', id); setDragging(id) } : undefined}
                onDragOver={draggable ? (event) => dragOver(event, id) : undefined}
                onDrop={draggable ? drop : undefined}
                onDragEnd={draggable ? () => { setDragging(null); setTarget(null) } : undefined}
                onClick={() => onSelect(id)} onKeyDown={(event) => navigate(event, entry)}
                className={`group flex min-h-12 w-full min-w-0 items-center gap-2.5 rounded-[10px] px-2 py-1.5 text-left transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-accent-tint/40 ${dragging === id ? 'opacity-50' : ''} ${selected ? 'bg-ds-hover text-ds-ink' : 'text-ds-ink hover:bg-[color-mix(in_srgb,var(--ds-surface-hover)_60%,transparent)]'}`}>
                {draggable ? <GripVertical aria-hidden className="-ml-1.5 -mr-1 h-3.5 w-3.5 shrink-0 text-ds-faint opacity-0 transition group-hover:opacity-100 group-focus-visible:opacity-100" /> : null}
                <span className="relative grid h-[30px] w-[30px] shrink-0 place-items-center rounded-lg border border-ds-border-muted bg-ds-card">
                  <AgentIcon harnessId={id} size={15} className="text-ds-ink" />
                  {running ? null : <span className="absolute -bottom-0.5 -right-0.5 grid h-3 w-3 place-items-center rounded-full bg-ds-card">
                    <AgentStatusDot tone={activity?.tone === 'warning' ? 'warning' : presentation.tone} className="!h-2 !w-2" />
                  </span>}
                </span>
                <span className="min-w-0 flex-1">
                  <span className="flex min-w-0 items-center gap-1.5" title={row.definition.displayName}>
                    <span className={`truncate text-[13px] leading-[18px] ${selected ? 'font-semibold' : 'font-medium'}`}>{row.definition.displayName}</span>
                    {defaultId === id ? <span className="shrink-0 rounded bg-accent-tint/10 px-1 text-[10px] font-medium leading-4 text-accent">{t('adeAgentAction.isDefault')}</span> : null}
                  </span>
                  <RailLine presentation={presentation} t={t} />
                </span>
                {running ? <LoaderCircle aria-hidden className="h-3.5 w-3.5 shrink-0 animate-spin text-accent" />
                  : activity?.tone === 'success' ? <Check aria-hidden className="h-3.5 w-3.5 shrink-0 text-ds-status-success" strokeWidth={2.6} />
                    : presentation.updateVersion ? <span className="shrink-0 rounded-full bg-accent-soft px-1.5 text-[10.5px] font-semibold leading-[18px] text-accent"
                      title={t('agentCenter.header.updatePill', { version: presentation.updateVersion })} data-agent-update-pill>{presentation.updateVersion}</span> : null}
              </button>
              {dropBefore === false ? <span aria-hidden className="absolute -bottom-px left-2 right-2 h-0.5 rounded bg-accent" /> : null}
            </div>
          })}
        </div>
      })}
    </div>
    {/* Outside the listbox: only options may sit inside it. It belongs to the last group. */}
    {folded && (folded.hidden > 0 || expanded) ? <button type="button" data-agent-group-toggle onClick={onToggleExpanded}
      aria-expanded={expanded}
      className="mx-3 mb-2 flex items-center gap-1.5 self-start rounded-md px-1.5 py-1.5 text-left text-[12px] font-medium text-accent hover:bg-ds-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-tint/40">
      <ChevronDown aria-hidden className={`h-3.5 w-3.5 transition ${expanded ? 'rotate-180' : ''}`} />
      {expanded ? t('agentCenter.rail.showLess') : t('agentCenter.rail.showMore', { count: folded.hidden })}
    </button> : null}
    <span role="status" aria-live="polite" className="sr-only">{announcement}</span>
    {onFindExtensions ? <div className="mt-auto flex items-center justify-between gap-2 border-t border-ds-border-muted px-4 py-2.5 text-[12px] text-ds-faint">
      <span className="min-w-0">{t('agentCenter.rail.footer')}</span>
      <button type="button" onClick={onFindExtensions}
        className="shrink-0 rounded-md px-1 text-accent hover:underline focus-visible:ring-2 focus-visible:ring-accent-tint/40">{t('agentCenter.rail.findInExtensions')}</button>
    </div> : null}
  </div>
}

const LINE_TONE = { running: 'text-accent', success: 'text-ds-status-success', warning: 'text-ds-status-warning', muted: 'text-ds-faint' } as const

/** The row's second line: work in flight (with its elapsed time) wins over the plain state. */
function RailLine({ presentation, t }: { presentation: AgentPresentation; t: T }): ReactElement {
  const activity = presentation.activity
  if (!activity) return <span className="mt-px block truncate text-[11.5px] leading-4 text-ds-faint">{agentLineText(t, presentation.listLine)}</span>
  return <span className={`mt-px flex min-w-0 text-[11.5px] leading-4 ${LINE_TONE[activity.tone]}`} data-agent-activity-line>
    <span className="truncate">{agentLineText(t, activity.line)}</span>
    {activity.tone === 'running' && activity.since ? <span className="shrink-0">&nbsp;<AgentElapsed since={activity.since} /></span> : null}
  </span>
}
