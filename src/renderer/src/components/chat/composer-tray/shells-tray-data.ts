import {
  KUN_BACKGROUND_SHELLS_PATH,
  kunBackgroundShellStopPath
} from '@shared/kun-endpoints'
import { rendererRuntimeClient } from '../../../agent/runtime-client'

/*
 * Background shell sessions (Kun's detached `bash` commands) for the composer
 * tray: the runtime request helpers, ANSI cleanup and the pure rules that
 * decide which commands the tray shows. No React here.
 */

export type BackgroundShellStatus = 'running' | 'completed' | 'stopped' | 'failed'

/** Mirrors kun/src/contracts/background-shell.ts (BackgroundShellRecord). */
export type BackgroundShellSession = {
  id: string
  threadId: string
  turnId: string
  command: string
  cwd: string
  shell: string
  status: BackgroundShellStatus
  startedAt: string
  finishedAt?: string
  exitCode: number | null
  output: string
  outputTruncated?: boolean
  outputFilePath?: string
  error?: string
  detached: boolean
}

export type BackgroundShellListResponse = {
  sessions: BackgroundShellSession[]
  running: number
}

const ESC = String.fromCharCode(27)
const BEL = String.fromCharCode(7)
// OSC (title / cwd / hyperlink marks, ended by BEL or ESC \), CSI (colors,
// cursor moves) and the two-character escapes.
const ANSI_ESCAPE_SEQUENCE = new RegExp(
  `${ESC}\\][^${BEL}${ESC}]*(?:${BEL}|${ESC}\\\\)|${ESC}(?:[@-Z\\\\-_]|\\[[0-?]*[ -/]*[@-~])`,
  'g'
)

export function stripAnsiSequences(value: string): string {
  return value.replace(ANSI_ESCAPE_SEQUENCE, '')
}

const EMPTY_LIST: BackgroundShellListResponse = { sessions: [], running: 0 }

/**
 * Lists the thread's background shells. A 404 reads as "no shells" (the
 * runtime does not offer the route). Any other failed request or an
 * unreadable body is transient and returns null: the caller keeps what it
 * shows and the next poll retries, so one 5xx or a briefly refusing runtime
 * never empties the tray or closes an open sheet.
 */
export async function fetchBackgroundShells(threadId: string): Promise<BackgroundShellListResponse | null> {
  const query = `?thread_id=${encodeURIComponent(threadId)}`
  const result = await rendererRuntimeClient.runtimeRequest(`${KUN_BACKGROUND_SHELLS_PATH}${query}`)
  if (!result.ok) return result.status === 404 ? EMPTY_LIST : null
  try {
    const parsed = JSON.parse(result.body) as Partial<BackgroundShellListResponse> | null
    return Array.isArray(parsed?.sessions)
      ? { sessions: parsed.sessions, running: typeof parsed.running === 'number' ? parsed.running : 0 }
      : null
  } catch {
    return null
  }
}

export async function stopBackgroundShell(sessionId: string): Promise<void> {
  await rendererRuntimeClient.runtimeRequest(kunBackgroundShellStopPath(sessionId), 'POST')
}

/**
 * - running: still alive
 * - failed: runtime failure, a spawn error, a non-zero exit, or an exit by a
 *   signal nobody requested (no exit code)
 * - succeeded: exited 0 without an error
 * - stopped: stopped on request (its signal exit code is not a failure)
 */
export type BackgroundShellOutcome = 'running' | 'failed' | 'succeeded' | 'stopped'

/**
 * Ended without an exit code although nobody asked it to stop: a crash, an
 * OOM kill or `kill -9` from elsewhere. Kun runs `bash -lc`, which execs the
 * last command, so the child's signal reaches the runtime as code null;
 * requested stops are recorded as 'stopped' instead.
 */
export function backgroundShellEndedBySignal(session: BackgroundShellSession): boolean {
  return session.status === 'completed' && session.exitCode === null
}

export function backgroundShellOutcome(session: BackgroundShellSession): BackgroundShellOutcome {
  if (session.status === 'running') return 'running'
  if (session.status === 'stopped') return 'stopped'
  if (session.status === 'failed') return 'failed'
  if (session.exitCode !== 0) return 'failed'
  return session.error?.trim() ? 'failed' : 'succeeded'
}

/** Field-by-field equality, so an unchanged poll keeps the previous array. */
export function sameBackgroundShellSessions(
  left: readonly BackgroundShellSession[],
  right: readonly BackgroundShellSession[]
): boolean {
  if (left === right) return true
  if (left.length !== right.length) return false
  return left.every((session, index) => {
    const other = right[index]
    return other !== undefined &&
      session.id === other.id &&
      session.status === other.status &&
      session.exitCode === other.exitCode &&
      session.command === other.command &&
      session.cwd === other.cwd &&
      session.startedAt === other.startedAt &&
      session.finishedAt === other.finishedAt &&
      session.output === other.output &&
      session.outputTruncated === other.outputTruncated &&
      session.outputFilePath === other.outputFilePath &&
      session.error === other.error
  })
}

function epochMs(value: string | undefined): number | null {
  if (!value) return null
  const ms = Date.parse(value)
  return Number.isFinite(ms) ? ms : null
}

/** When the command ended (falls back to its start when the runtime gave no end). */
export function backgroundShellSettledAtMs(session: BackgroundShellSession): number | null {
  return epochMs(session.finishedAt) ?? epochMs(session.startedAt)
}

/**
 * Start of this app session. Failures and finished commands older than this
 * (from an earlier run of the app) are never surfaced.
 */
export const SHELLS_APP_SESSION_STARTED_AT_MS = Date.now()

export const SHELLS_FINISHED_ROW_LIMIT = 5

export type BackgroundShellSummary = {
  /** Live commands, longest-running first. */
  running: BackgroundShellSession[]
  /** Undismissed failures from this app session, newest first. */
  failed: BackgroundShellSession[]
  /** Undismissed successful / stopped commands from this app session, newest first, capped. */
  finished: BackgroundShellSession[]
  /** Something keeps the segment visible: a live command or an undismissed failure. */
  active: boolean
}

export function summarizeBackgroundShells(
  sessions: readonly BackgroundShellSession[],
  {
    dismissed,
    sinceMs = SHELLS_APP_SESSION_STARTED_AT_MS,
    finishedLimit = SHELLS_FINISHED_ROW_LIMIT
  }: {
    dismissed: ReadonlySet<string>
    sinceMs?: number
    finishedLimit?: number
  }
): BackgroundShellSummary {
  const running: BackgroundShellSession[] = []
  const failed: BackgroundShellSession[] = []
  const finished: BackgroundShellSession[] = []
  for (const session of sessions) {
    const outcome = backgroundShellOutcome(session)
    if (outcome === 'running') {
      running.push(session)
      continue
    }
    if (dismissed.has(session.id)) continue
    const settledAt = backgroundShellSettledAtMs(session)
    if (settledAt === null || settledAt < sinceMs) continue
    if (outcome === 'failed') failed.push(session)
    else finished.push(session)
  }
  const startedAt = (session: BackgroundShellSession): number => epochMs(session.startedAt) ?? 0
  const settledAt = (session: BackgroundShellSession): number => backgroundShellSettledAtMs(session) ?? 0
  running.sort((left, right) => startedAt(left) - startedAt(right))
  failed.sort((left, right) => settledAt(right) - settledAt(left))
  finished.sort((left, right) => settledAt(right) - settledAt(left))
  return {
    running,
    failed,
    finished: finished.slice(0, Math.max(0, finishedLimit)),
    active: running.length > 0 || failed.length > 0
  }
}

/**
 * Output as display lines: ANSI stripped, CRLF normalized, carriage-return
 * redraws (progress bars) collapsed to their final text, blank lines at
 * either end dropped, and only the last `maxLines` kept.
 */
export function backgroundShellOutputLines(output: string, maxLines = 200): string[] {
  const text = stripAnsiSequences(output).replace(/\r\n/g, '\n')
  const lines = text.split('\n').map((line) => {
    const redraw = line.lastIndexOf('\r')
    return redraw >= 0 ? line.slice(redraw + 1) : line
  })
  while (lines.length > 0 && lines[lines.length - 1]!.trim() === '') lines.pop()
  const tail = lines.slice(Math.max(0, lines.length - maxLines))
  const firstText = tail.findIndex((line) => line.trim() !== '')
  return firstText > 0 ? tail.slice(firstText) : tail
}

// Lines that name the cause beat summary lines that only say something failed.
const CAUSE_LINE_PATTERN =
  /error|cannot|can't|not found|no such|exception|traceback|panic|fatal|denied|refused|enoent|eaddrinuse/i
const FAILED_LINE_PATTERN = /fail|✗|×/i
const FAILURE_LINE_MAX_CHARS = 200

/** The line that best explains a failure: the runtime error, else the last cause-looking output line. */
export function backgroundShellFailureLine(session: BackgroundShellSession): string | null {
  const clip = (line: string): string => {
    const text = line.replace(/^Error:\s+/, '')
    return text.length > FAILURE_LINE_MAX_CHARS ? `${text.slice(0, FAILURE_LINE_MAX_CHARS)}…` : text
  }
  const error = session.error?.split('\n').map((line) => line.trim()).find(Boolean)
  if (error) return clip(error)
  const lines = backgroundShellOutputLines(session.output, 400).map((line) => line.trim()).filter(Boolean)
  for (const pattern of [CAUSE_LINE_PATTERN, FAILED_LINE_PATTERN]) {
    for (let index = lines.length - 1; index >= 0; index -= 1) {
      if (pattern.test(lines[index]!)) return clip(lines[index]!)
    }
  }
  const last = lines[lines.length - 1]
  return last ? clip(last) : null
}

// The shapes composer context refuses as absolute: a POSIX root, a UNC
// share, a drive path or a file: URL.
const ABSOLUTE_PATH_PATTERN = /^(?:file:|\/|\\\\|[A-Za-z]:[\\/])/i
const WINDOWS_PATH_PATTERN = /^(?:[A-Za-z]:|\\\\)/

export function isAbsoluteShellPath(path: string): boolean {
  return ABSOLUTE_PATH_PATTERN.test(path.trim())
}

/**
 * "~/code/kun" (or "~\code\kun") for paths under the home directory, the
 * path otherwise. Either separator counts, and drive / UNC paths compare
 * case-insensitively and separator-blind, like Windows does.
 */
export function backgroundShellDirectoryLabel(cwd: string, home: string | undefined): string {
  const path = cwd.trim()
  if (!path) return ''
  const root = home?.trim().replace(/[\\/]+$/, '')
  if (root) {
    const fold = WINDOWS_PATH_PATTERN.test(root)
      ? (value: string): string => value.toLowerCase().replace(/\\/g, '/')
      : (value: string): string => value
    const next = path.charAt(root.length)
    if (fold(path.slice(0, root.length)) === fold(root) && (next === '' || next === '/' || next === '\\')) {
      return `~${path.slice(root.length)}`
    }
  }
  return path
}

/**
 * A directory label that is never absolute (composer context refuses
 * absolute paths): "~/code/kun" under home, else the folder's own name.
 */
export function backgroundShellRelativeDirectory(cwd: string, home: string | undefined): string {
  const label = backgroundShellDirectoryLabel(cwd, home)
  if (!isAbsoluteShellPath(label)) return label
  const parts = label.split(/[\\/]/).filter(Boolean)
  const name = parts[parts.length - 1] ?? ''
  return isAbsoluteShellPath(name) ? '' : name
}

/** Plain text for the clipboard. */
export function backgroundShellOutputText(session: BackgroundShellSession): string {
  return backgroundShellOutputLines(session.output, Number.MAX_SAFE_INTEGER).join('\n')
}
