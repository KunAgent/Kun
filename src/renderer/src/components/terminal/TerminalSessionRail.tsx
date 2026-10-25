import { useMemo, useState, type ReactElement } from 'react'
import { History, Plus, Search } from 'lucide-react'
import { statusDot, type ClosedTerminal, type TerminalSessionStatus, type TerminalTab, type WorkspaceTerminals } from './terminal-dock-model'
import { ptySessionIdFor, type DockScope } from './terminal-dock-actions'
import { tabDot, tabTitle } from './TerminalDockHeader'
import { KunMark, TerminalTargetIcon } from './TerminalIcon'
import { formatTerminalDuration } from './TerminalPaneChrome'

type T = (key: string, options?: Record<string, unknown>) => string

type RailGroup = 'shell' | 'agent' | 'kun-process' | 'ssh'
const GROUP_ORDER: RailGroup[] = ['shell', 'agent', 'kun-process', 'ssh']
const GROUP_LABEL: Record<RailGroup, string> = {
  shell: 'termDockGroupShell',
  agent: 'termDockGroupAgent',
  'kun-process': 'termDockGroupKun',
  ssh: 'termDockGroupSsh'
}

function groupOf(tab: TerminalTab): RailGroup {
  const kind = tab.panes[0]!.target.kind
  return kind === 'local' ? 'shell' : kind
}

/** Short status text on the right of a rail row. */
function rowMeta(scope: DockScope, tab: TerminalTab, status: Record<string, TerminalSessionStatus>, t: T): { text: string; tone?: 'warn' | 'ok' | 'danger' } {
  const pane = tab.panes[0]!
  const session = status[ptySessionIdFor(scope.workspaceRoot, pane)]
  const dot = tabDot(scope, tab, status)
  if (dot === 'waiting') return { text: t('termDockWaitingShort'), tone: 'warn' }
  if (dot === 'failed') return { text: t('termDockExitCode', { code: session?.exitCode ?? '!' }), tone: 'danger' }
  if (dot === 'done') return { text: t('termDockDoneShort'), tone: 'ok' }
  if (session?.phase === 'exited') return { text: t('termDockExitedShort') }
  if (dot === 'running') return { text: t('termDockRunningShort') }
  return { text: '' }
}

export function TerminalSessionRail({
  scope,
  workspace,
  status,
  onSelect,
  onNew,
  onReopen,
  t
}: {
  scope: DockScope
  workspace: WorkspaceTerminals
  status: Record<string, TerminalSessionStatus>
  onSelect: (tabId: string) => void
  onNew: (anchor: DOMRect) => void
  onReopen: (paneId: string) => void
  t: T
}): ReactElement {
  const [query, setQuery] = useState('')
  const [showClosed, setShowClosed] = useState(false)
  const groups = useMemo(() => {
    const needle = query.trim().toLowerCase()
    const byGroup = new Map<RailGroup, TerminalTab[]>()
    for (const tab of workspace.tabs) {
      if (needle && !tabTitle(scope, tab, status, t).toLowerCase().includes(needle)) continue
      const group = groupOf(tab)
      byGroup.set(group, [...(byGroup.get(group) ?? []), tab])
    }
    return GROUP_ORDER.flatMap((group) => byGroup.get(group)?.length ? [{ group, tabs: byGroup.get(group)! }] : [])
  }, [query, scope, status, t, workspace.tabs])

  return (
    <nav className="kun-terminal-rail" aria-label={t('termDockSessions')}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
        <label className="kun-terminal-rail-search" style={{ flex: 1 }}>
          <Search className="h-3.5 w-3.5 shrink-0" strokeWidth={1.8} aria-hidden="true" />
          <input value={query} aria-label={t('termDockFilterSessions')} placeholder={t('termDockFilterPlaceholder', { n: workspace.tabs.length })} onChange={(event) => setQuery(event.target.value)} />
        </label>
        <button type="button" className="kun-terminal-icon-button" aria-label={t('termDockNewMenu')} title={t('termDockNewMenu')} onClick={(event) => onNew(event.currentTarget.getBoundingClientRect())}>
          <Plus className="h-4 w-4" strokeWidth={1.8} />
        </button>
      </div>
      {groups.map(({ group, tabs }) => (
        <div key={group}>
          <div className="kun-terminal-rail-heading">
            {group === 'kun-process' ? <KunMark size={9} /> : null}
            {t(GROUP_LABEL[group])}
            <span style={{ color: 'var(--ds-text-faint)' }}>{tabs.length}</span>
          </div>
          {tabs.map((tab) => {
            const meta = rowMeta(scope, tab, status, t)
            const pane = tab.panes[0]!
            const session = status[ptySessionIdFor(scope.workspaceRoot, pane)]
            return (
              <button
                key={tab.id}
                type="button"
                className="kun-terminal-rail-row"
                data-active={tab.id === workspace.activeTabId ? 'true' : undefined}
                aria-current={tab.id === workspace.activeTabId ? 'true' : undefined}
                title={session?.cwd ?? undefined}
                onClick={() => onSelect(tab.id)}
              >
                <TerminalTargetIcon target={pane.target} dot={statusDot(session) ?? tabDot(scope, tab, status)} />
                <span className={`kun-terminal-rail-title ${pane.target.kind === 'kun-process' ? 'kun-terminal-mono' : ''}`}>{tabTitle(scope, tab, status, t)}</span>
                {meta.text ? <small data-tone={meta.tone}>{meta.text}</small> : null}
              </button>
            )
          })}
        </div>
      ))}
      <span className="kun-terminal-spacer" />
      {workspace.closed.length ? (
        <>
          <button type="button" className="kun-terminal-rail-row" style={{ color: 'var(--ds-text-muted)' }} aria-expanded={showClosed} onClick={() => setShowClosed((value) => !value)}>
            <History className="h-3.5 w-3.5 shrink-0" strokeWidth={1.8} />
            <span className="kun-terminal-rail-title">{t('termDockRecentlyClosed')}</span>
            <small>{workspace.closed.length}</small>
          </button>
          {showClosed ? workspace.closed.map((entry: ClosedTerminal) => (
            <button key={entry.pane.id} type="button" className="kun-terminal-rail-row" style={{ paddingLeft: 28 }} onClick={() => onReopen(entry.pane.id)}>
              <span className="kun-terminal-rail-title">{entry.title}</span>
              <small>{formatTerminalDuration(Date.now() - entry.closedAt, t)}</small>
            </button>
          )) : null}
        </>
      ) : null}
    </nav>
  )
}
