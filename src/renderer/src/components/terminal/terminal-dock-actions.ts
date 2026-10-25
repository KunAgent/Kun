import type { RemoteSshHost } from '@shared/remote-ssh'
import { profileCommandLine } from '@shared/app-settings-terminal-dock'
import { attachTerminalOutput, selectRelevantLines } from '../../lib/terminal-output-attachment'
import { terminalSessionIdForWorkspace } from './terminal-session'
import { freshPane, displayDirectory, basename, TERMINAL_SNAPSHOT_LINES, type TerminalPane, type ClosedTerminal } from './terminal-dock-model'
import {
  addTerminalTab,
  dismissKunProcess,
  readSessionStatus,
  removeTerminalPane,
  splitTerminalTab,
  takeClosedTerminal
} from './terminal-dock-store'
import {
  disposeTerminal,
  snapshotTerminal,
  terminalInstance,
  writeToTerminal
} from './terminal-instance-registry'
import { saveTerminalSnapshots } from './terminal-restore'
import type { TerminalAgentEntry } from './terminal-agent-catalog'
import { scriptCommandLine, type PackageManager } from './terminal-workspace-scripts'
import { readBufferLines } from './terminal-shell-commands'

/** Where a new pane goes: its own tab, or beside an existing one. */
export type PanePlacement = { kind: 'tab' } | { kind: 'split'; tabId: string }

export type DockScope = {
  workspaceRoot: string
  workspaceKey: string
}

export function ptySessionIdFor(workspaceRoot: string, pane: TerminalPane): string {
  return terminalSessionIdForWorkspace(workspaceRoot, pane.id, pane.target)
}

function place(scope: DockScope, pane: TerminalPane, placement: PanePlacement = { kind: 'tab' }): boolean {
  if (placement.kind === 'split') return splitTerminalTab(scope.workspaceKey, placement.tabId, pane)
  return addTerminalTab(scope.workspaceKey, pane)
}

export function openLocalShell(scope: DockScope, placement?: PanePlacement, options: { cwd?: string; shell?: string } = {}): boolean {
  return place(scope, freshPane({
    kind: 'local',
    ...(options.cwd ? { cwd: options.cwd } : {}),
    ...(options.shell ? { shell: options.shell } : {})
  }), placement)
}

export function openSshShell(scope: DockScope, host: RemoteSshHost, placement?: PanePlacement): boolean {
  return place(scope, freshPane({ kind: 'ssh', hostId: host.id, hostName: host.label }, { title: host.label }), placement)
}

export function openScript(scope: DockScope, manager: PackageManager, script: string, placement?: PanePlacement): boolean {
  const command = scriptCommandLine(manager, script)
  return place(scope, freshPane({ kind: 'local' }, { title: command, initialCommand: command }), placement)
}

/**
 * Start an agent: harness CLIs go through Kun's admission (they can report
 * back); profiles type their command into a fresh local shell.
 */
export function openAgent(
  scope: DockScope,
  entry: TerminalAgentEntry,
  options: { task: string; report: boolean; cwd?: string },
  placement?: PanePlacement
): boolean {
  const task = options.task.trim()
  if (entry.kind === 'harness') {
    return place(scope, freshPane({
      kind: 'agent',
      harnessId: entry.id,
      title: entry.name,
      ...(task ? { task } : {}),
      ...(options.cwd ? { cwd: options.cwd } : {}),
      ...(options.report ? {} : { report: false })
    }, { title: entry.name }), placement)
  }
  const profile = entry.profile
  if (!profile) return false
  const cwd = profile.cwd || options.cwd
  return place(scope, freshPane({ kind: 'local', ...(cwd ? { cwd } : {}) }, {
    title: profile.name,
    initialCommand: profileCommandLine(profile, task)
  }), placement)
}

/** Login command of a harness typed into a new shell for the user to run. */
export function openAgentLogin(scope: DockScope, entry: TerminalAgentEntry): boolean {
  if (!entry.loginCommand) return false
  return place(scope, freshPane({ kind: 'local' }, { title: entry.name, prefill: entry.loginCommand, probeHarnessId: entry.id }))
}

/** True when closing would stop something the user may care about. */
export async function paneIsBusy(workspaceRoot: string, pane: TerminalPane): Promise<boolean> {
  const id = ptySessionIdFor(workspaceRoot, pane)
  const status = readSessionStatus(id)
  if (!status || status.phase === 'exited' || status.phase === 'error') return false
  if (pane.target.kind === 'kun-process') return false
  if (pane.target.kind === 'agent') return true
  if (status.commandRunning) return true
  if (pane.target.kind !== 'local') return false
  try {
    return (await window.kunGui.getTerminalProcessInfo(id))?.busy === true
  } catch {
    return false
  }
}

/** Close a pane now: end its process (Kun processes keep running) and remember it. */
export function closePane(scope: DockScope, tabId: string, pane: TerminalPane, title: string): void {
  const id = ptySessionIdFor(scope.workspaceRoot, pane)
  let closed: ClosedTerminal | undefined
  if (pane.target.kind === 'kun-process') {
    dismissKunProcess(pane.target.processId)
    disposeTerminal(id, { killPty: false })
  } else {
    const snapshot = snapshotTerminal(id, TERMINAL_SNAPSHOT_LINES)
    if (snapshot?.length) saveTerminalSnapshots({ [id]: snapshot }, TERMINAL_SNAPSHOT_LINES)
    disposeTerminal(id, { killPty: true })
    const { prefill: _prefill, initialCommand: _initialCommand, fresh: _fresh, restoredFrom: _restoredFrom, ...rest } = pane
    closed = { pane: rest, ptySessionId: id, title, closedAt: Date.now() }
  }
  removeTerminalPane(scope.workspaceKey, tabId, pane.id, closed)
}

/** Reopen a closed pane in a new tab: a new shell below its saved output. */
export function reopenClosedPane(scope: DockScope, paneId: string): boolean {
  const entry = takeClosedTerminal(scope.workspaceKey, paneId)
  if (!entry) return false
  return addTerminalTab(scope.workspaceKey, freshPane(entry.pane.target, {
    ...(entry.pane.title ? { title: entry.pane.title } : {}),
    ...(entry.pane.userTitle ? { userTitle: entry.pane.userTitle } : {}),
    restoredFrom: entry.ptySessionId
  }))
}

function cwdLabel(cwd: string | undefined): string | undefined {
  if (!cwd) return undefined
  const label = displayDirectory(cwd, window.kunGui?.homeDir)
  return label.startsWith('/') ? basename(cwd) : label
}

/** Send one finished command (command line, exit code, output) to the composer. */
export async function sendCommandToKun(scope: DockScope, pane: TerminalPane, recordId: number, onlyRelevant = true): Promise<boolean> {
  const id = ptySessionIdFor(scope.workspaceRoot, pane)
  const instance = terminalInstance(id)
  const record = instance?.commands?.find(recordId)
  if (!instance?.commands || !record) return false
  const output = instance.commands.output(record)
  return attachTerminalOutput({
    workspaceRoot: scope.workspaceRoot,
    draft: {
      source: 'command',
      command: record.command,
      exitCode: record.exitCode ?? null,
      ...(record.finishedAt ? { durationMs: record.finishedAt - record.startedAt } : {}),
      cwdLabel: cwdLabel(record.cwd ?? readSessionStatus(id)?.cwd),
      lines: onlyRelevant ? selectRelevantLines(output).lines : output
    }
  })
}

export async function sendSelectionToKun(scope: DockScope, pane: TerminalPane, text: string): Promise<boolean> {
  const lines = text.replace(/\r\n?/g, '\n').split('\n')
  return attachTerminalOutput({
    workspaceRoot: scope.workspaceRoot,
    draft: { source: 'selection', cwdLabel: cwdLabel(readSessionStatus(ptySessionIdFor(scope.workspaceRoot, pane))?.cwd), lines }
  })
}

/** Send the visible screen when no command marks exist (agents, SSH). */
export async function sendScreenToKun(scope: DockScope, pane: TerminalPane): Promise<boolean> {
  const instance = terminalInstance(ptySessionIdFor(scope.workspaceRoot, pane))
  if (!instance) return false
  const buffer = instance.term.buffer.active
  const lines = readBufferLines(instance.term, buffer.viewportY, buffer.viewportY + instance.term.rows)
  return sendSelectionToKun(scope, pane, lines.join('\n'))
}

export function rerunCommand(scope: DockScope, pane: TerminalPane, command: string): void {
  if (!command.trim()) return
  writeToTerminal(ptySessionIdFor(scope.workspaceRoot, pane), `${command}\r`)
}
