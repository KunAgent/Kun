export type WriteDocumentSha256Request = {
  workspaceRoot: string
  filePath: string
}

export type WriteDocumentSha256Result =
  | {
      ok: true
      sha256: string
    }
  | {
      ok: false
      message: string
    }
