import {
  attachTerminalOutput,
  selectRelevantLines,
  type TerminalOutputDraft
} from '../../../lib/terminal-output-attachment'
import {
  backgroundShellOutputLines,
  backgroundShellOutputText,
  backgroundShellRelativeDirectory,
  type BackgroundShellSession
} from './shells-tray-data'

/** Copies the command's output (ANSI stripped). False when there is nothing to copy or the clipboard refused. */
export async function copyBackgroundShellOutput(session: BackgroundShellSession): Promise<boolean> {
  const text = backgroundShellOutputText(session)
  if (!text || typeof navigator === 'undefined' || !navigator.clipboard) return false
  try {
    await navigator.clipboard.writeText(text)
    return true
  } catch {
    return false
  }
}

/**
 * The same draft the terminal dock sends for a finished command: command
 * line, exit code, duration, a relative directory label (never absolute) and
 * the failure-relevant output lines.
 */
export function backgroundShellOutputDraft(
  session: BackgroundShellSession,
  home: string | undefined
): TerminalOutputDraft {
  const lines = backgroundShellOutputLines(session.output, Number.MAX_SAFE_INTEGER)
  const error = session.error?.trim()
  if (error && !lines.some((line) => line.includes(error))) lines.push(error)
  const started = Date.parse(session.startedAt)
  const finished = session.finishedAt ? Date.parse(session.finishedAt) : Number.NaN
  const directory = backgroundShellRelativeDirectory(session.cwd, home)
  return {
    source: 'command',
    command: session.command,
    exitCode: session.exitCode,
    ...(Number.isFinite(started) && Number.isFinite(finished)
      ? { durationMs: Math.max(0, finished - started) }
      : {}),
    ...(directory ? { cwdLabel: directory } : {}),
    lines: selectRelevantLines(lines).lines
  }
}

/**
 * Attaches the command's output to the Code composer as terminal-output
 * context (the terminal dock's "send to Kun" path). False outside the main
 * Code conversation.
 */
export async function sendBackgroundShellToKun(session: BackgroundShellSession): Promise<boolean> {
  const home = typeof window !== 'undefined' ? window.kunGui?.homeDir : undefined
  try {
    return await attachTerminalOutput({
      workspaceRoot: '',
      draft: backgroundShellOutputDraft(session, home)
    })
  } catch {
    return false
  }
}

/** What "发给 Kun" ended up doing. */
export type BackgroundShellSendResult = 'attached' | 'copied' | 'unavailable'

/**
 * "发给 Kun": attach the output as composer context; when the composer
 * refuses it (attachment limit, another workspace, a rejected reference) the
 * output is copied instead so the click is never a silent no-op.
 */
export async function sendOrCopyBackgroundShell(session: BackgroundShellSession): Promise<BackgroundShellSendResult> {
  if (await sendBackgroundShellToKun(session)) return 'attached'
  return (await copyBackgroundShellOutput(session)) ? 'copied' : 'unavailable'
}
