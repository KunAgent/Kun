import type { TerminalTarget } from './terminal-backend'

/**
 * Terminal dock data model. A tab holds one pane, or two side by side after a
 * split. Each pane owns one session: a local/SSH PTY, an Agent CLI PTY, or a
 * read-only view of one of Kun's background shells.
 */
export type TerminalPane = {
  /** Stable id; part of the PTY session id so a pane re-attaches to its shell. */
  id: string
  target: TerminalTarget
  /** Title given by whatever launched the pane (profile, script, agent). */
  title?: string
  /** Rename from the tab menu; always wins. */
  userTitle?: string
  /** Written into the PTY once without Enter (setup commands to review). */
  prefill?: string
  /** Harness re-probed when this PTY exits (install/login setup tabs). */
  probeHarnessId?: string
  /** Run once, with Enter, when a fresh shell is ready (profiles, scripts). */
  initialCommand?: string
  /** PTY session id whose saved output is shown above the new shell. */
  restoredFrom?: string
  /** Created in this app session; never restored from a snapshot. Not persisted. */
  fresh?: boolean
}

export type TerminalTab = {
  id: string
  panes: TerminalPane[]
  focusedPaneId: string
}

export type ClosedTerminal = {
  pane: TerminalPane
  ptySessionId: string
  title: string
  closedAt: number
}

export type WorkspaceTerminals = {
  tabs: TerminalTab[]
  activeTabId: string | null
  closed: ClosedTerminal[]
}

export type TerminalDockPosition = 'bottom' | 'right'

export type TerminalDockLayout = {
  maximized: boolean
  position: TerminalDockPosition
  railOpen: boolean
  rightWidth: number
}

export type TerminalActivity = 'idle' | 'running' | 'waiting' | 'done'

export type TerminalLastFailure = {
  recordId: number
  command: string
  exitCode: number
  durationMs: number
}

export type TerminalSessionStatus = {
  phase: 'starting' | 'ready' | 'error' | 'exited'
  error?: string
  exitCode?: number | null
  /** Shell integration reported at least one prompt. */
  integrated: boolean
  commandRunning: boolean
  /** Running command, or the last one that ran. */
  command?: string
  cwd?: string
  activity: TerminalActivity
  /** Something happened (finished, asked) while the pane was not visible. */
  unseen: boolean
  lastFailure?: TerminalLastFailure
  /** Execution unit of an Agent CLI pane. */
  unitId?: string
}

export type TerminalStatusDot = 'running' | 'waiting' | 'done' | 'failed' | null

export const TERMINAL_MAX_TABS = 12
export const TERMINAL_MAX_CLOSED = 5
export const TERMINAL_RIGHT_WIDTH = { default: 520, min: 360, max: 900 } as const

export function emptyWorkspaceTerminals(): WorkspaceTerminals {
  return { tabs: [], activeTabId: null, closed: [] }
}

export function defaultDockLayout(): TerminalDockLayout {
  return { maximized: false, position: 'bottom', railOpen: false, rightWidth: TERMINAL_RIGHT_WIDTH.default }
}

let idSequence = 0
export function newTerminalId(prefix: 'tab' | 'pane'): string {
  idSequence += 1
  return `${prefix}-${Date.now().toString(36)}-${idSequence.toString(36)}`
}

export function freshPane(target: TerminalPane['target'], extra: Partial<TerminalPane> = {}): TerminalPane {
  return { id: newTerminalId('pane'), target, fresh: true, ...extra }
}

export function makeTab(pane: TerminalPane): TerminalTab {
  return { id: newTerminalId('tab'), panes: [pane], focusedPaneId: pane.id }
}

export function initialStatus(): TerminalSessionStatus {
  return { phase: 'starting', integrated: false, commandRunning: false, activity: 'idle', unseen: false }
}

/** Which dot a session shows; failures win, then questions, then news. */
export function statusDot(status: TerminalSessionStatus | undefined): TerminalStatusDot {
  if (!status) return null
  if (status.phase === 'error') return 'failed'
  if (status.phase === 'exited' && typeof status.exitCode === 'number' && status.exitCode !== 0) return 'failed'
  if (status.activity === 'waiting') return 'waiting'
  if (status.unseen && status.activity === 'done') return 'done'
  if (status.activity === 'running' || status.commandRunning) return 'running'
  return null
}

const DOT_PRIORITY: Record<Exclude<TerminalStatusDot, null>, number> = { waiting: 4, failed: 3, done: 2, running: 1 }

/** The most urgent dot among several sessions (tab with two panes, top bar). */
export function strongestDot(dots: Iterable<TerminalStatusDot>): TerminalStatusDot {
  let best: TerminalStatusDot = null
  for (const dot of dots) {
    if (dot && (!best || DOT_PRIORITY[dot] > DOT_PRIORITY[best])) best = dot
  }
  return best
}

const INTERPRETERS = new Set(['node', 'nodejs', 'python', 'python3', 'ruby', 'bun', 'deno', 'tsx', 'sh', 'bash', 'zsh'])

/** Short, readable title for a running command line. */
export function humanizeCommand(command: string): string {
  const tokens = command.trim().replace(/\s+/g, ' ').split(' ').filter(Boolean)
  while (tokens.length > 1 && /^[A-Za-z_][A-Za-z0-9_]*=/.test(tokens[0]!)) tokens.shift()
  if (tokens[0] === 'env') tokens.shift()
  if (tokens.length > 1 && INTERPRETERS.has(basename(tokens[0]!)) && !tokens[1]!.startsWith('-')) tokens.shift()
  if (tokens[0]) tokens[0] = basename(tokens[0])
  const text = tokens.join(' ')
  return text.length > 40 ? `${text.slice(0, 39)}…` : text
}

export function basename(path: string): string {
  const trimmed = path.replace(/[\\/]+$/, '')
  return trimmed.split(/[\\/]/).pop() || trimmed
}

/** Directory label for tab titles and tooltips: home becomes `~`. */
export function displayDirectory(path: string | undefined, home?: string): string {
  if (!path) return ''
  if (home && (path === home || path.startsWith(`${home}/`))) return `~${path.slice(home.length)}`
  return path
}

/**
 * Title shown on a tab: a rename wins, then (for shells) the running command,
 * then the launch title, then the shell's directory, then the fallback.
 */
export function paneTitle(
  pane: TerminalPane,
  status: TerminalSessionStatus | undefined,
  fallback: string
): string {
  if (pane.userTitle?.trim()) return pane.userTitle.trim()
  const shell = pane.target.kind === 'local'
  if (shell && status?.commandRunning && status.command) return humanizeCommand(status.command)
  if (pane.title?.trim()) return pane.title.trim()
  if (shell && status?.cwd) return basename(status.cwd)
  if (pane.target.kind === 'local' && pane.target.cwd) return basename(pane.target.cwd)
  return fallback
}

/** Lines kept when a pane's output is saved for restore. */
export const TERMINAL_SNAPSHOT_LINES = 500
