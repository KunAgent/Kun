export type TerminalSessionInfo = {
  id: string
  cwd: string
  shell: string
}

export type TerminalCreateOptions = {
  cwd: string
  cols?: number
  rows?: number
}

export type TerminalCreateResult =
  | { ok: true; session: TerminalSessionInfo }
  | { ok: false; message: string }

export type TerminalInputPayload = {
  sessionId: string
  data: string
}

export type TerminalResizePayload = {
  sessionId: string
  cols: number
  rows: number
}

export type TerminalLifecyclePayload = {
  sessionId: string
}

export type TerminalDataPayload = {
  sessionId: string
  data: string
}

export type TerminalExitPayload = {
  sessionId: string
  exitCode: number
  signal?: number
}
