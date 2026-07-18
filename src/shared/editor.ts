export type EditorKind = 'editor' | 'viewer' | 'terminal'

export type EditorInfo = {
  id: string
  label: string
  kind: EditorKind
  available: boolean
  supportsLine: boolean
  detail?: string
  iconDataUrl?: string
}

export type EditorListResult = {
  editors: EditorInfo[]
  defaultEditorId: string
}

export type OpenEditorPathOptions = {
  path: string
  workspaceRoot?: string
  editorId?: string
  line?: number
  column?: number
  /** Main-owned validation policy for generated artifact actions. */
  openPolicy?: 'presentation-artifact'
  /** Trusted write-time digest required before system-opening a Kun HTML deck. */
  expectedSha256?: string
}

export type EditorOpenResult =
  | { ok: true; path: string; editorId: string }
  | { ok: false; message: string }
