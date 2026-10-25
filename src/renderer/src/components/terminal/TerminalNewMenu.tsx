import { useEffect, useMemo, useState, type ReactElement } from 'react'
import { ChevronRight, Play, Plus, Server, SlidersHorizontal, TerminalSquare } from 'lucide-react'
import type { RemoteSshHost } from '@shared/remote-ssh'
import type { TerminalShellOption } from '@shared/terminal'
import type { TerminalSettingsV1 } from '@shared/app-settings'
import { loadHarnesses, useHarnessStore } from '../../store/harness-store'
import { terminalAgentEntries, type TerminalAgentEntry } from './terminal-agent-catalog'
import { readWorkspaceScripts, type WorkspaceScripts } from './terminal-workspace-scripts'
import { processesInWorkspace, runningScriptProcess, useKunProcessStore } from './terminal-kun-processes'
import { TerminalAgentEntryIcon } from './TerminalIcon'
import { TerminalAgentLauncher } from './TerminalAgentLauncher'
import type { KunBackgroundProcess } from './terminal-kun-processes'
import { dockShortcut } from './terminal-shortcuts'

type T = (key: string, options?: Record<string, unknown>) => string

export type TerminalNewMenuActions = {
  onLocal: () => void
  onShell: (shellPath: string) => void
  onSsh: (host: RemoteSshHost) => void
  onAgent: (entry: TerminalAgentEntry, options: { task: string; report: boolean }) => void
  onAgentLogin: (entry: TerminalAgentEntry) => void
  onScript: (scripts: WorkspaceScripts, name: string) => void
  onShowProcess: (process: KunBackgroundProcess) => void
  onManageAgents: () => void
  onTerminalSettings: () => void
  onAddSsh: () => void
}

const MENU_WIDTH = 312

export function TerminalNewMenu({
  anchor,
  workspaceRoot,
  settings,
  actions,
  onClose,
  t
}: {
  anchor: DOMRect
  workspaceRoot: string
  settings: TerminalSettingsV1
  actions: TerminalNewMenuActions
  onClose: () => void
  t: T
}): ReactElement {
  const harnessRows = useHarnessStore((state) => state.rows)
  const processes = useKunProcessStore((state) => state.processes)
  const [hosts, setHosts] = useState<RemoteSshHost[]>([])
  const [shells, setShells] = useState<TerminalShellOption[]>([])
  const [scripts, setScripts] = useState<WorkspaceScripts | null>(null)
  const [launching, setLaunching] = useState<{ entry: TerminalAgentEntry; top: number } | null>(null)

  useEffect(() => {
    // Opening the menu refreshes agent detection so CLIs do not sit on "unknown".
    void loadHarnesses(true, { waitMs: 3_000 })
    void window.kunGui.listRemoteSshHosts().then(setHosts).catch(() => setHosts([]))
    void window.kunGui.listTerminalShells?.().then((list) => setShells(list ?? [])).catch(() => setShells([]))
    void readWorkspaceScripts(workspaceRoot).then(setScripts)
  }, [workspaceRoot])

  const agents = useMemo(
    () => terminalAgentEntries(harnessRows, settings).filter((entry) => !entry.hidden),
    [harnessRows, settings]
  )
  const workspaceProcesses = useMemo(() => processesInWorkspace(processes, workspaceRoot), [processes, workspaceRoot])
  const defaultShell = settings.behavior.shell || shells[0]?.path
  const otherShells = shells.filter((shell) => shell.path !== defaultShell && shell.supportsIntegration)
  const defaultShellName = (defaultShell ?? '').split('/').pop() || t('termDockShell')

  const left = Math.min(Math.max(8, anchor.left), window.innerWidth - MENU_WIDTH - 8)
  const opensDown = anchor.top < window.innerHeight / 2
  const style = opensDown ? { left, top: anchor.bottom + 6 } : { left, bottom: window.innerHeight - anchor.top + 6 }
  const run = (action: () => void) => () => {
    action()
    onClose()
  }

  return (
    <>
      <div className="kun-terminal-popover kun-terminal-menu" role="menu" aria-label={t('termDockNewMenu')} style={{ ...style, width: MENU_WIDTH }} onPointerDown={(event) => event.stopPropagation()}>
        <div className="kun-terminal-menu-heading">{t('termDockMenuShell')}</div>
        <button type="button" role="menuitem" className="kun-terminal-menu-item" onClick={run(actions.onLocal)}>
          <TerminalSquare className="h-4 w-4 shrink-0" strokeWidth={1.8} />
          <span className="kun-terminal-menu-label">{t('termDockNewShellNamed', { shell: defaultShellName })}</span>
          <span className="kun-terminal-kbd">{dockShortcut('T')}</span>
        </button>
        {otherShells.slice(0, 4).map((shell) => (
          <button key={shell.path} type="button" role="menuitem" className="kun-terminal-menu-item" onClick={run(() => actions.onShell(shell.path))}>
            <span style={{ width: 16 }} />
            <span className="kun-terminal-menu-label">{shell.name}</span>
            <small className="kun-terminal-mono">{shell.path}</small>
          </button>
        ))}

        <div className="kun-terminal-menu-heading">{t('termDockMenuRemote')}</div>
        {hosts.map((host) => (
          <button key={host.id} type="button" role="menuitem" className="kun-terminal-menu-item" onClick={run(() => actions.onSsh(host))}>
            <Server className="h-4 w-4 shrink-0" strokeWidth={1.8} />
            <span className="kun-terminal-menu-label">{host.label}</span>
            <small className="kun-terminal-mono">{host.username}@{host.hostname}</small>
          </button>
        ))}
        <button type="button" role="menuitem" className="kun-terminal-menu-item" onClick={run(actions.onAddSsh)}>
          <Plus className="h-4 w-4 shrink-0" strokeWidth={1.8} />
          <span className="kun-terminal-menu-label" style={{ color: 'var(--ds-text-muted)' }}>{hosts.length ? t('termDockAddSsh') : t('termDockNoSsh')}</span>
        </button>

        {agents.length ? <div className="kun-terminal-menu-heading">{t('termDockMenuAgents')}</div> : null}
        {agents.map((entry) => (
          <button
            key={entry.id}
            type="button"
            role="menuitem"
            aria-haspopup="dialog"
            className="kun-terminal-menu-item"
            data-active={launching?.entry.id === entry.id ? 'true' : undefined}
            onClick={(event) => {
              if (entry.needsLogin) {
                run(() => actions.onAgentLogin(entry))()
              } else if (!entry.takesTask) {
                run(() => actions.onAgent(entry, { task: '', report: false }))()
              } else {
                setLaunching({ entry, top: event.currentTarget.getBoundingClientRect().top })
              }
            }}
          >
            <TerminalAgentEntryIcon icon={entry.icon} />
            <span className="kun-terminal-menu-label">{entry.name}</span>
            {entry.needsLogin
              ? <span className="kun-terminal-pill" data-tone="warn">{t('termDockNeedsLogin')}</span>
              : <small className={entry.kind === 'profile' ? 'kun-terminal-mono' : undefined}>{entry.detail}</small>}
            {entry.takesTask && !entry.needsLogin ? <ChevronRight className="h-3.5 w-3.5 shrink-0 text-ds-muted" strokeWidth={1.8} /> : null}
          </button>
        ))}

        {scripts ? (
          <>
            <div className="kun-terminal-menu-heading">{t('termDockMenuScripts')}</div>
            {scripts.scripts.map((script) => {
              const running = runningScriptProcess(workspaceProcesses, script.name)
              return (
                <button key={script.name} type="button" role="menuitem" className="kun-terminal-menu-item" title={script.command} onClick={run(() => running ? actions.onShowProcess(running) : actions.onScript(scripts, script.name))}>
                  <Play className="h-3.5 w-3.5 shrink-0" strokeWidth={1.8} />
                  <span className="kun-terminal-menu-label kun-terminal-mono">{script.name}</span>
                  {running
                    ? <small style={{ color: 'var(--kun-term-accent-ink)' }}><span className="kun-terminal-status-dot" data-dot="running" /> {t('termDockScriptRunningByKun')}</small>
                    : <small className="kun-terminal-mono" style={{ maxWidth: 130, overflow: 'hidden', textOverflow: 'ellipsis' }}>{script.command}</small>}
                </button>
              )
            })}
          </>
        ) : null}

        <div className="kun-terminal-menu-separator" />
        <div style={{ display: 'flex', gap: 2 }}>
          <button type="button" role="menuitem" className="kun-terminal-menu-item" style={{ color: 'var(--ds-text-muted)', width: 'auto', flex: 1, minWidth: 0 }} onClick={run(actions.onManageAgents)}>
            <SlidersHorizontal className="h-3.5 w-3.5 shrink-0" strokeWidth={1.8} />
            <span className="kun-terminal-menu-label">{t('termDockManageAgents')}</span>
          </button>
          <button type="button" role="menuitem" className="kun-terminal-menu-item" style={{ color: 'var(--ds-text-muted)', width: 'auto', flexShrink: 0 }} onClick={run(actions.onTerminalSettings)}>
            {t('termDockSettings')}
          </button>
        </div>
      </div>
      {launching ? (
        <TerminalAgentLauncher
          entry={launching.entry}
          workspaceRoot={workspaceRoot}
          position={{
            left: Math.min(left + MENU_WIDTH + 8, window.innerWidth - 408),
            top: Math.max(8, Math.min(launching.top - 80, window.innerHeight - 440))
          }}
          onCancel={() => setLaunching(null)}
          onLaunch={(options) => {
            actions.onAgent(launching.entry, options)
            onClose()
          }}
          t={t}
        />
      ) : null}
    </>
  )
}
