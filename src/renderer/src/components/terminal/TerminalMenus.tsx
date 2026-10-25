import { useRef, type ReactElement, type ReactNode } from 'react'
import {
  Columns2,
  Copy,
  Eraser,
  ExternalLink,
  History,
  PanelBottom,
  PanelRight,
  PencilLine,
  RotateCw,
  SlidersHorizontal,
  SquareTerminal,
  TerminalSquare,
  X
} from 'lucide-react'
import type { ClosedTerminal, TerminalDockPosition } from './terminal-dock-model'
import { controlShortcut, dockShortcut, isMacPlatform } from './terminal-shortcuts'

type T = (key: string, options?: Record<string, unknown>) => string

export type FloatingAnchor = { x: number; y: number; alignRight?: boolean }

function Item({ icon, label, kbd, tone, disabled, onClick }: {
  icon?: ReactNode
  label: string
  kbd?: string
  tone?: 'danger'
  disabled?: boolean
  onClick: () => void
}): ReactElement {
  return (
    <button type="button" role="menuitem" className="kun-terminal-menu-item" data-tone={tone} disabled={disabled} onClick={onClick}>
      {icon ?? <span style={{ width: 14 }} />}
      <span className="kun-terminal-menu-label">{label}</span>
      {kbd ? <span className="kun-terminal-kbd">{kbd}</span> : null}
    </button>
  )
}

function Menu({ anchor, label, width = 248, onClose, children }: {
  anchor: FloatingAnchor
  label: string
  width?: number
  onClose: () => void
  children: ReactNode
}): ReactElement {
  const left = anchor.alignRight ? Math.max(8, anchor.x - width) : Math.min(Math.max(8, anchor.x), window.innerWidth - width - 8)
  const top = Math.min(anchor.y, window.innerHeight - 360)
  return (
    <div
      className="kun-terminal-popover kun-terminal-menu"
      role="menu"
      aria-label={label}
      style={{ left, top, width }}
      onPointerDown={(event) => event.stopPropagation()}
      onKeyDown={(event) => { if (event.key === 'Escape') onClose() }}
    >
      {children}
    </div>
  )
}

const ICON = { className: 'h-3.5 w-3.5 shrink-0', strokeWidth: 1.9 } as const

export function TerminalMoreMenu({
  anchor,
  position,
  hasSession,
  canInterrupt,
  closed,
  cwd,
  onClear,
  onRename,
  onRestart,
  onInterrupt,
  onCopyId,
  onDock,
  onOpenSystem,
  onReopen,
  onSettings,
  onClose,
  t
}: {
  anchor: FloatingAnchor
  position: TerminalDockPosition
  hasSession: boolean
  canInterrupt: boolean
  closed: ClosedTerminal[]
  cwd?: string
  onClear: () => void
  onRename: () => void
  onRestart: () => void
  onInterrupt: () => void
  onCopyId: () => void
  onDock: (position: TerminalDockPosition) => void
  onOpenSystem: () => void
  onReopen: (paneId: string) => void
  onSettings: () => void
  onClose: () => void
  t: T
}): ReactElement {
  const run = (action: () => void) => () => {
    action()
    onClose()
  }
  return (
    <Menu anchor={anchor} label={t('termDockMore')} onClose={onClose}>
      <Item icon={<Eraser {...ICON} />} label={t('termDockClear')} kbd={isMacPlatform() ? dockShortcut('K') : undefined} disabled={!hasSession} onClick={run(onClear)} />
      <Item icon={<PencilLine {...ICON} />} label={t('termDockRename')} disabled={!hasSession} onClick={run(onRename)} />
      <Item icon={<RotateCw {...ICON} />} label={t('termDockRestartShell')} disabled={!hasSession} onClick={run(onRestart)} />
      <Item icon={<X {...ICON} />} label={t('termDockInterrupt')} kbd={controlShortcut('C')} tone="danger" disabled={!canInterrupt} onClick={run(onInterrupt)} />
      <Item icon={<Copy {...ICON} />} label={t('termDockCopySessionId')} disabled={!hasSession} onClick={run(onCopyId)} />
      <div className="kun-terminal-menu-separator" />
      {position === 'bottom'
        ? <Item icon={<PanelRight {...ICON} />} label={t('termDockDockRight')} onClick={run(() => onDock('right'))} />
        : <Item icon={<PanelBottom {...ICON} />} label={t('termDockDockBottom')} onClick={run(() => onDock('bottom'))} />}
      <Item icon={<ExternalLink {...ICON} />} label={t('termDockOpenSystem')} disabled={!cwd} onClick={run(onOpenSystem)} />
      {closed.length ? (
        <>
          <div className="kun-terminal-menu-separator" />
          <div className="kun-terminal-menu-heading">{t('termDockRecentlyClosed')}</div>
          {closed.map((entry) => (
            <Item key={entry.pane.id} icon={<History {...ICON} />} label={entry.title} onClick={run(() => onReopen(entry.pane.id))} />
          ))}
        </>
      ) : null}
      <div className="kun-terminal-menu-separator" />
      <Item icon={<SlidersHorizontal {...ICON} />} label={t('termDockSettings')} onClick={run(onSettings)} />
    </Menu>
  )
}

export function TerminalTabMenu({
  anchor,
  canSplit,
  tabCount,
  onRename,
  onSplit,
  onCloseOthers,
  onCloseAll,
  onClose,
  t
}: {
  anchor: FloatingAnchor
  canSplit: boolean
  tabCount: number
  onRename: () => void
  onSplit: () => void
  onCloseOthers: () => void
  onCloseAll: () => void
  onClose: () => void
  t: T
}): ReactElement {
  const run = (action: () => void) => () => {
    action()
    onClose()
  }
  return (
    <Menu anchor={anchor} label={t('termDockTabMenu')} width={210} onClose={onClose}>
      <Item icon={<PencilLine {...ICON} />} label={t('termDockRename')} onClick={run(onRename)} />
      <Item icon={<Columns2 {...ICON} />} label={t('termDockSplit')} disabled={!canSplit} onClick={run(onSplit)} />
      <div className="kun-terminal-menu-separator" />
      <Item icon={<SquareTerminal {...ICON} />} label={t('termDockCloseOthers')} disabled={tabCount <= 1} onClick={run(onCloseOthers)} />
      <Item icon={<TerminalSquare {...ICON} />} label={t('termDockCloseAll')} tone="danger" onClick={run(onCloseAll)} />
    </Menu>
  )
}

export function TerminalCloseConfirm({
  title,
  count,
  onCancel,
  onConfirm,
  t
}: {
  title: string
  count: number
  onCancel: () => void
  onConfirm: (dontAskAgain: boolean) => void
  t: T
}): ReactElement {
  const dontAsk = useRef(false)
  return (
    <div className="kun-terminal-dialog-backdrop" onPointerDown={onCancel}>
      <div
        className="kun-terminal-dialog"
        role="alertdialog"
        aria-modal="true"
        aria-labelledby="kun-terminal-close-title"
        onPointerDown={(event) => event.stopPropagation()}
        onKeyDown={(event) => { if (event.key === 'Escape') onCancel() }}
      >
        <h2 id="kun-terminal-close-title">{count > 1 ? t('termDockCloseManyTitle', { n: count }) : t('termDockCloseTitle', { title })}</h2>
        <p>{count > 1 ? t('termDockCloseManyBody') : t('termDockCloseBody')}</p>
        <label><input type="checkbox" onChange={(event) => { dontAsk.current = event.target.checked }} style={{ margin: 0, accentColor: 'var(--ds-accent)' }} />{t('termDockDontAsk')}</label>
        <div className="kun-terminal-dialog-actions">
          <button type="button" className="kun-terminal-button" onClick={onCancel}>{t('termDockCancel')}</button>
          <button type="button" className="kun-terminal-button" data-tone="danger" autoFocus onClick={() => onConfirm(dontAsk.current)}>{t('termDockEndAndClose')}</button>
        </div>
      </div>
    </div>
  )
}

export function TerminalEmptyState({
  closed,
  onNewShell,
  onNewMenu,
  onReopen,
  t
}: {
  closed: ClosedTerminal[]
  onNewShell: () => void
  onNewMenu: (anchor: DOMRect) => void
  onReopen: (paneId: string) => void
  t: T
}): ReactElement {
  const last = closed[0]
  return (
    <div className="kun-terminal-empty">
      <span className="kun-terminal-empty-icon"><TerminalSquare className="h-5 w-5" strokeWidth={1.8} /></span>
      <div style={{ fontSize: 13.5 }}>{t('termDockEmpty')}</div>
      <div className="kun-terminal-empty-actions">
        <button type="button" className="kun-terminal-button" data-tone="primary" onClick={onNewShell}>
          {t('termDockNewShell')} <span className="kun-terminal-mono" style={{ opacity: 0.7, fontSize: 11 }}>{dockShortcut('T')}</span>
        </button>
        <button type="button" className="kun-terminal-button" onClick={(event) => onNewMenu(event.currentTarget.getBoundingClientRect())}>{t('termDockEmptyMore')}</button>
      </div>
      {last ? (
        <small>
          <History className="mr-1 inline h-3 w-3" strokeWidth={1.9} />
          {t('termDockLastClosed', { title: last.title })}{' '}
          <button type="button" className="kun-terminal-link-button" onClick={() => onReopen(last.pane.id)}>{t('termDockReopen')}</button>
        </small>
      ) : null}
    </div>
  )
}
