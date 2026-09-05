/**
 * Runtime-persistable reference to the document a Write turn is bound to.
 * Mirrors the Kun `WriteTurnContextSchema` so the renderer can forward it in
 * the turn request body without importing the runtime package.
 */
export type WriteTurnContext = {
  workspaceRoot: string
  documentPath: string | null
  documentEpoch?: number
  contentRevision?: number
  whiteboardId?: string
  whiteboardRevision?: number
  expectedSha256?: string
}
