/**
 * Shared types and constants for the built-in terminal.
 *
 * The terminal is a real pseudo-terminal spawned in the Electron main
 * process via node-pty. Output is streamed to the renderer over IPC and
 * rendered with xterm.js. These types live in `src/shared` so both the main
 * process (IPC handlers), the preload bridge, and the renderer all share one
 * contract — mirroring how the workspace/SSE types are structured.
 */

export const TERMINAL_MAX_SESSIONS = 8
export const TERMINAL_MAX_DATA_WRITE_BYTES = 1_000_000
export const TERMINAL_RING_BUFFER_BYTES = 64 * 1024
export const TERMINAL_MAX_SESSION_ID_LENGTH = 256
export const TERMINAL_MAX_CWD_LENGTH = 4_096
export const TERMINAL_DEFAULT_COLS = 80
export const TERMINAL_DEFAULT_ROWS = 24
export const TERMINAL_MAX_COLS = 500
export const TERMINAL_MAX_ROWS = 200
export const TERMINAL_MAIN_SESSION_ID = 'main'

export type TerminalCreatePayload = {
  /** Stable session identifier. The workbench uses a single `main` session. */
  sessionId: string
  /** Working directory for the spawned shell. Defaults to the OS home dir. */
  cwd?: string
  cols?: number
  rows?: number
}

export type TerminalWritePayload = {
  sessionId: string
  /** Raw bytes typed by the user (UTF-8 string). */
  data: string
}

export type TerminalResizePayload = {
  sessionId: string
  cols: number
  rows: number
}

/** Main → renderer output stream, one IPC message per PTY data chunk. */
export type TerminalDataPayload = {
  sessionId: string
  data: string
}

export type TerminalExitPayload = {
  sessionId: string
  /** Process exit code; null when the shell did not exit cleanly. */
  exitCode: number | null
}

export type TerminalCreateResult =
  | { ok: true; sessionId: string; replayed?: boolean }
  | { ok: false; message: string }
