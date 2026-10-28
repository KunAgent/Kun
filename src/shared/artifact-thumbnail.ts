/** What the main process renders into a cached thumbnail image. */
export type ArtifactThumbnailSource = 'design-html' | 'office'

export type ArtifactThumbnailRequest = {
  workspaceRoot: string
  /** Workspace-relative file: a design screen's HTML or an Office document. */
  path: string
  source: ArtifactThumbnailSource
}

export type ArtifactThumbnailResult =
  | { ok: true; dataUrl: string; width: number; height: number }
  | { ok: false; message: string }

export type KunGuiArtifactThumbnailApi = {
  renderArtifactThumbnail: (request: ArtifactThumbnailRequest) => Promise<ArtifactThumbnailResult>
}
