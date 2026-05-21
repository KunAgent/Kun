export type WorkspaceFileTarget = {
  path: string
  workspaceRoot?: string
  line?: number
  column?: number
}

export type WorkspaceFileReadResult =
  | {
      ok: true
      path: string
      content: string
      size: number
      truncated: boolean
      line?: number
      column?: number
    }
  | { ok: false; message: string }

export type WorkspaceFileResolveResult =
  | {
      ok: true
      path: string
    }
  | { ok: false; message: string }
