/** Display evidence only: these fields never authorize execution or network access. */
export type ToolPresentationState = 'pending' | 'running' | 'completed' | 'failed' | 'canceled'
export type ToolPresentationLocation = { path: string; line?: number; endLine?: number }
export type ToolPresentationDiff = { path: string; oldText: string | null; newText: string }
export type ToolPresentationTerminal = {
  terminalId: string
  command?: string
  cwd?: string
  output: string
  exitCode?: number | null
  signal?: string | null
  truncated?: boolean
}
export type ToolPresentationSearchResult = {
  path?: string
  line?: number
  text?: string
  url?: string
  title?: string
}
export type ToolPresentationContent = {
  type: string
  text?: string
  data?: string
  mimeType?: string
  uri?: string
  name?: string
  resource?: { uri?: string; mimeType?: string; text?: string; blob?: string }
  raw?: unknown
  omitted?: boolean
  originalBytes?: number
}
export type ToolPresentation = {
  version: 1
  kind: string
  state: ToolPresentationState
  /** True only while an individually cancellable runtime handle is registered. */
  canCancel: boolean
  source?: 'native' | 'acp' | 'legacy'
  title?: string
  name?: string
  server?: string
  input?: unknown
  output?: unknown
  error?: string
  text?: string
  filePath?: string
  line?: number
  fileContent?: string
  /** A provider-supplied unified patch when before/after full text is unavailable. */
  patch?: string
  command?: string
  cwd?: string
  query?: string
  url?: string
  statusCode?: number
  offset?: number
  limit?: number
  locations?: ToolPresentationLocation[]
  diffs?: ToolPresentationDiff[]
  terminals?: ToolPresentationTerminal[]
  results?: ToolPresentationSearchResult[]
  content?: ToolPresentationContent[]
  truncated?: boolean
  startedAt?: string
  finishedAt?: string
  durationMs?: number
}
