import { lazy, Suspense, type ReactElement } from 'react'
import { MessageCircle, Minimize2 } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import './terminal-dock.css'
import { setDockLayout, useTerminalDockStore } from './terminal-dock-store'
import type { DockPlacement } from './TerminalDockHeader'
import { dockShortcut } from './terminal-shortcuts'

const TerminalDock = lazy(() =>
  import('./TerminalDock').then((module) => ({ default: module.TerminalDock }))
)

/**
 * Terminal dock host shared by the Code chat stage and the ADE Mission
 * Control surface: install/login setup actions need a terminal on the agent
 * home too, not only inside a conversation. The dock drains any pending
 * terminal-open request itself (terminal-open.ts).
 */
export function TerminalDrawer({
  workspaceRoot,
  height,
  onBeginResize,
  onCollapse,
  placement = 'bottom'
}: {
  workspaceRoot: string
  height: number
  onBeginResize: React.PointerEventHandler<HTMLDivElement>
  onCollapse: () => void
  placement?: DockPlacement
}): ReactElement {
  const maximized = useTerminalDockStore((state) => state.layout.maximized) && placement !== 'right'
  return (
    <div
      className={`ds-no-drag relative z-[3] flex shrink-0 flex-col ${placement === 'right' ? 'min-h-0 self-stretch' : 'w-full'} ${maximized ? 'min-h-0 flex-1' : ''}`}
    >
      <Suspense fallback={<div className="ds-surface-strong h-full w-full" style={placement === 'right' ? undefined : { height }} />}>
        <TerminalDock
          workspaceRoot={workspaceRoot}
          placement={placement}
          height={height}
          onBeginResize={onBeginResize}
          onCollapse={onCollapse}
        />
      </Suspense>
    </div>
  )
}

/** Shown in place of the conversation while the dock is maximized. */
export function TerminalChatCollapsedStrip({ busy, label }: { busy: boolean; label?: string }): ReactElement {
  const { t } = useTranslation('common')
  return (
    <div className="kun-terminal-collapsed-strip ds-no-drag">
      <MessageCircle className="h-3.5 w-3.5 text-ds-muted" strokeWidth={1.8} aria-hidden="true" />
      <span>{t('termDockChatCollapsed')}</span>
      {busy ? <><span className="kun-terminal-status-dot" data-dot="running" /><span style={{ color: 'var(--ds-text)' }}>{label ?? t('termDockKunWorking')}</span></> : null}
      <span className="kun-terminal-spacer" />
      <button type="button" className="kun-terminal-chip-button" onClick={() => setDockLayout({ maximized: false })}>
        <Minimize2 className="h-3.5 w-3.5" strokeWidth={1.9} />{t('termDockRestoreChat')}
        <span className="kun-terminal-mono" style={{ color: 'var(--ds-text-muted)', fontSize: 11 }}>{dockShortcut('M', { shift: true })}</span>
      </button>
    </div>
  )
}
