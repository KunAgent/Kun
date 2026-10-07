import { useState, type DragEvent, type KeyboardEvent, type ReactElement } from 'react'
import { ChevronDown, GripVertical, Search, X } from 'lucide-react'
import { AgentIcon } from '../agent-icon'
import { AgentStatusDot } from './AgentCenterParts'
import { agentLineText } from './agent-center-presentation'
import type { AgentListEntry, AgentListGroup } from './agent-center-catalog'

type T = (key: string, options?: Record<string, unknown>) => string

type DropTarget = { id: string; before: boolean }

/**
 * The Agent list (docs/ade/18 §3.2): search, three groups, drag or Alt+Arrow
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

  return <div className="flex min-h-0 min-w-0 flex-col border-b border-ds-border-muted bg-ds-subtle lg:border-b-0 lg:border-r" data-agent-catalog-rail-column>
    <div className="px-3 pb-1 pt-3" data-agent-catalog-toolbar>
      <div className="relative">
        <Search size={14} aria-hidden="true" className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-ds-faint" />
        <input type="search" value={search} onChange={(event) => onSearch(event.target.value)}
          aria-label={t('agentIntegrations.search')} placeholder={t('agentIntegrations.search')}
          data-agent-catalog-search
          className="h-9 w-full rounded-lg border border-ds-border bg-ds-card pl-8 pr-9 text-[12px] text-ds-ink placeholder:text-ds-faint focus:border-accent focus:outline-none [&::-webkit-search-cancel-button]:hidden" />
        {search ? <button type="button" onClick={() => onSearch('')} aria-label={t('agentIntegrations.clearSearch')}
          className="absolute right-0.5 top-1/2 grid h-8 w-8 -translate-y-1/2 place-items-center rounded-md text-ds-muted hover:bg-ds-hover focus-visible:ring-2 focus-visible:ring-accent">
          <X size={13} />
        </button> : null}
      </div>
    </div>
    <div role="listbox" aria-label={t('agentCenter.title')} aria-orientation="vertical" data-agent-catalog-rail
      className="flex max-h-72 min-w-0 flex-col overflow-y-auto overscroll-contain px-2 pb-2 lg:max-h-[36rem] lg:min-h-0 lg:flex-1">
      {groups.map((group) => {
        const label = t(`agentCenter.group.${group.id}`)
        return <div key={group.id} role="group" aria-label={label} data-agent-group={group.id} className="flex flex-col gap-0.5">
          <div className="flex items-center justify-between px-2 pb-1 pt-3 text-[11.5px] font-semibold text-ds-faint"
            title={group.id === 'connected' && reorderable ? t('agentCenter.rail.reorderHint') : undefined}>
            <span>{label}</span><span className="font-medium">{group.total}</span>
          </div>
          {group.entries.map((entry) => {
            const { row, presentation } = entry
            const id = row.definition.id
            const selected = selectedId === id
            const draggable = group.id === 'connected' && reorderable
            const dropBefore = target && target.id === id && dragging !== id ? target.before : undefined
            return <div key={id} className="relative">
              {dropBefore === true ? <span aria-hidden className="absolute -top-px left-2 right-2 h-0.5 rounded bg-accent" /> : null}
              <button type="button" role="option" data-agent-list-id={id} data-selected={selected || undefined}
                data-agent-state={presentation.state} aria-selected={selected} tabIndex={selected ? 0 : -1}
                draggable={draggable}
                onDragStart={draggable ? (event) => { event.dataTransfer.effectAllowed = 'move'; event.dataTransfer.setData('text/plain', id); setDragging(id) } : undefined}
                onDragOver={draggable ? (event) => dragOver(event, id) : undefined}
                onDrop={draggable ? drop : undefined}
                onDragEnd={draggable ? () => { setDragging(null); setTarget(null) } : undefined}
                onClick={() => onSelect(id)} onKeyDown={(event) => navigate(event, entry)}
                className={`group flex w-full min-w-0 items-center gap-2.5 rounded-lg px-2 py-1.5 text-left transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-accent-tint/40 ${dragging === id ? 'opacity-50' : ''} ${selected ? 'bg-ds-card text-ds-ink shadow-sm ring-1 ring-ds-border' : 'text-ds-muted hover:bg-ds-hover hover:text-ds-ink'}`}>
                {draggable ? <GripVertical aria-hidden className="-ml-1 h-3.5 w-3.5 shrink-0 text-ds-faint opacity-0 transition group-hover:opacity-100 group-focus-visible:opacity-100" /> : null}
                <span className="relative grid h-8 w-8 shrink-0 place-items-center rounded-lg border border-ds-border-muted bg-ds-card">
                  <AgentIcon harnessId={id} size={16} className="text-ds-ink" />
                  <span className="absolute -bottom-0.5 -right-0.5 grid h-3 w-3 place-items-center rounded-full bg-ds-card">
                    <AgentStatusDot tone={presentation.tone} className={presentation.tone === 'running' ? '!h-2.5 !w-2.5' : '!h-2 !w-2'} />
                  </span>
                </span>
                <span className="min-w-0 flex-1">
                  <span className="flex min-w-0 items-center gap-1.5" title={row.definition.displayName}>
                    <span className={`truncate text-[13px] ${selected ? 'font-semibold' : 'font-medium'}`}>{row.definition.displayName}</span>
                    {defaultId === id ? <span className="shrink-0 rounded bg-accent-tint/10 px-1 text-[10px] font-medium leading-4 text-accent">{t('adeAgentAction.isDefault')}</span> : null}
                  </span>
                  <span className="mt-px block truncate text-[11px] text-ds-faint">{agentLineText(t, presentation.listLine)}</span>
                </span>
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
      className="mx-3 mb-2 flex items-center gap-1.5 rounded-md px-1.5 py-1.5 text-left text-[12px] font-medium text-accent hover:bg-ds-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-tint/40">
      <ChevronDown aria-hidden className={`h-3.5 w-3.5 transition ${expanded ? 'rotate-180' : ''}`} />
      {expanded ? t('agentCenter.rail.showLess') : t('agentCenter.rail.showMore', { count: folded.hidden })}
    </button> : null}
    <span role="status" aria-live="polite" className="sr-only">{announcement}</span>
    {onFindExtensions ? <div className="flex items-center justify-between gap-2 border-t border-ds-border-muted px-4 py-2.5 text-[12px] text-ds-faint">
      <span className="min-w-0">{t('agentCenter.rail.footer')}</span>
      <button type="button" onClick={onFindExtensions}
        className="shrink-0 rounded-md px-1 text-accent hover:underline focus-visible:ring-2 focus-visible:ring-accent-tint/40">{t('agentCenter.rail.findInExtensions')}</button>
    </div> : null}
  </div>
}
