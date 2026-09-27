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

/** ADE terminal-agent launch request bundled onto `terminal:create` (05 §6.1). */
export type TerminalAgentCreate = {
  harnessId: string
  title: string
  /** Initial task text injected through the harness's argv/taskFlag. */
  task?: string
  taskWorkspaceId?: string
  parentThreadId?: string
  workspaceKind?: 'worktree' | 'local' | 'directory'
}

export type TerminalCreatePayload = {
  /** 稳定的 PTY 会话标识,渲染端会按工作区和标签页生成命名空间。 */
  sessionId: string
  /** Working directory for the spawned shell. Defaults to the OS home dir. */
  cwd?: string
  cols?: number
  rows?: number
  agent?: TerminalAgentCreate
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

/**
 * Callback-channel appendix appended to a terminal agent's injected task
 * (05 §5.3): the `kun worker` commands are the shell-facing twin of the
 * worker callback tools. This text is turn input — it never enters any
 * system prompt or user-global agent config.
 */
export const TERMINAL_AGENT_CALLBACK_APPENDIX = [
  '',
  '---',
  'Reporting back to Kun (the `kun` CLI is on PATH; KUN_WORKER_* env vars are already set):',
  '- `kun worker progress "<summary>" [--phase investigating|implementing|verifying|blocked]` — report progress.',
  '- `kun worker ask "<question>" [--options a,b] [--timeout 600]` — ask the manager; blocks until answered.',
  '- `kun worker context [--query "<text>"] [--limit 10]` — read earlier manager-thread context.',
  '- `kun worker result --outcome <succeeded|partial|failed> --summary "<text>" [--files a,b] [--check name=status]` — submit the final report.',
  'Ask/result/context require a manager dispatch; standalone runs support `progress`.'
].join('\n')
