import type { ReactElement, ReactNode } from 'react'
import { Check, ChevronRight, MessageCirclePlus, SquarePen } from 'lucide-react'
import { RoomPopover } from '../rooms/RoomPopover'
import { openAgentChatDialog } from '../rooms/agent-chat-picker'
import './sidebar-code-nav.css'

/** Code's two primary actions: a project task, or a conversation with Agents. */
export function SidebarPrimaryActions({ runtimeReady, newTaskLabel, newChatLabel, disabledHint, onNewTask }: {
  runtimeReady: boolean
  newTaskLabel: string
  newChatLabel: string
  disabledHint: string
  onNewTask: () => void
}): ReactElement {
  return <div className="sidebar-primary-actions ds-no-drag">
    <button type="button" className="sidebar-new-task" data-cursor-spotlight-target disabled={!runtimeReady}
      title={runtimeReady ? newTaskLabel : disabledHint} onClick={runtimeReady ? onNewTask : undefined}>
      <SquarePen size={16} strokeWidth={1.8} aria-hidden="true" />
      <span>{newTaskLabel}</span>
    </button>
    <button type="button" className="sidebar-new-chat" data-cursor-spotlight-target disabled={!runtimeReady}
      aria-label={newChatLabel} title={runtimeReady ? newChatLabel : disabledHint}
      onClick={() => openAgentChatDialog('picker')}>
      <MessageCirclePlus size={16} strokeWidth={1.8} aria-hidden="true" />
    </button>
  </div>
}

export type SidebarMenuItem = { id: string; label: string; icon: ReactNode; active: boolean; onSelect: () => void }

/** A compact navigation row that groups related destinations in one menu. */
export function SidebarMenuRow({ icon, label, items, trailing }: {
  icon: ReactNode
  label: string
  items: SidebarMenuItem[]
  trailing?: ReactNode
}): ReactElement {
  const active = items.some((item) => item.active)
  return <RoomPopover label={label} width={220} className={'sidebar-menu-row' + (active ? ' is-active' : '')}
    trigger={<>
      <span className="sidebar-menu-row-icon" aria-hidden="true">{icon}</span>
      <span className="sidebar-menu-row-label">{label}</span>
      {trailing ? <span className="sidebar-menu-row-trailing">{trailing}</span> : null}
      <ChevronRight size={13} className="sidebar-menu-row-chevron" aria-hidden="true" />
    </>}>
    {(close) => <div className="rooms-menu-list sidebar-menu-row-list">
      {items.map((item) => <button type="button" key={item.id} aria-pressed={item.active}
        onClick={() => { close(); item.onSelect() }}>
        <span className="sidebar-menu-row-icon" aria-hidden="true">{item.icon}</span>
        <span className="sidebar-menu-row-label">{item.label}</span>
        {item.active ? <Check size={14} aria-hidden="true" /> : null}
      </button>)}
    </div>}
  </RoomPopover>
}

/** A single compact navigation row for destinations that stand alone. */
export function SidebarNavRow({ icon, label, active, disabled = false, onClick }: {
  icon: ReactNode; label: string; active: boolean; disabled?: boolean; onClick?: () => void
}): ReactElement {
  return <button type="button" className={'sidebar-menu-row' + (active ? ' is-active' : '')} data-cursor-spotlight-target
    aria-current={active ? 'page' : undefined} disabled={disabled} onClick={onClick}>
    <span className="sidebar-menu-row-icon" aria-hidden="true">{icon}</span>
    <span className="sidebar-menu-row-label">{label}</span>
  </button>
}
