/** Client-only evidence for a delegated tool; never used to authorize execution. */
export type DelegatedToolPresentation = {
  version: 1
  kind: string
  title?: string
  name?: string
  filePath?: string
  line?: number
  command?: string
  cwd?: string
  query?: string
  input?: unknown
  output?: unknown
  text?: string
  fileContent?: string
  diffs?: Array<{ path: string; oldText: string | null; newText: string }>
  terminals?: DelegatedTerminalPresentation[]
  truncated?: boolean
}

export type DelegatedTerminalPresentation = {
  terminalId: string
  command: string
  cwd: string
  output: string
  truncated: boolean
  exitCode?: number | null
  signal?: string | null
}
