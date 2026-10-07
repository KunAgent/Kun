/**
 * Wiring failures carry a stable code (and the config file when one is to
 * blame) so the GUI can explain them in the user's language; the English
 * message stays for the CLI and logs.
 */
export type AgentWiringErrorCode =
  | 'unknown_agent'
  | 'not_connected'
  | 'invalid_profile'
  | 'invalid_target'
  /** The file could not be parsed. */
  | 'config_unreadable'
  /** The file parses but uses a shape Kun will not rewrite (YAML anchors, several documents, a non-object root). */
  | 'config_unsupported'
  /** The agent reads this file only as strict JSON, and it has comments or trailing commas. */
  | 'strict_json_required'

export class AgentWiringError extends Error {
  constructor(message: string, readonly code: AgentWiringErrorCode, readonly file?: string) {
    super(message)
    this.name = 'AgentWiringError'
  }
}

/** Thrown by an editor for a file shape it refuses to rewrite rather than risk damaging. */
export class WiringUnsupportedError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'WiringUnsupportedError'
  }
}

/** Tags any failure while editing or restoring one file with that file. */
export class WiringFileError extends Error {
  constructor(readonly file: string, readonly reason: unknown) {
    super(reason instanceof Error ? reason.message : String(reason))
    this.name = 'WiringFileError'
  }
}

/** A wiring failure for `agent`, with the code and file the cause allows. */
export function wiringFailure(agent: string, action: string, cause: unknown): AgentWiringError {
  if (cause instanceof AgentWiringError) return cause
  const file = cause instanceof WiringFileError ? cause.file : undefined
  const reason = cause instanceof WiringFileError ? cause.reason : cause
  const message = reason instanceof Error ? reason.message : String(reason)
  return new AgentWiringError(`Could not ${action} ${agent}'s config${file ? ` (${file})` : ''}: ${message}`,
    reason instanceof WiringUnsupportedError ? 'config_unsupported' : 'config_unreadable', file)
}

/** Whether text that is present parses as strict JSON (no comments, no trailing commas). */
export function strictJson(text: string): boolean {
  if (!text.trim()) return true
  try { JSON.parse(text); return true } catch { return false }
}
