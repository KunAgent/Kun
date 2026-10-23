import type { DesignArtifact } from '../design-types'
import { embeddedArtifactOf, type CanvasShape } from './canvas-types'

export type EmbeddedArtifactFile = {
  artifact: DesignArtifact
  /** Workspace-relative file the board renders, honoring a pinned version. */
  path: string
}

/** The artifact and file an HTML/SVG board on the canvas renders. */
export function embeddedArtifactFile(
  shape: CanvasShape | undefined,
  artifacts: readonly DesignArtifact[]
): EmbeddedArtifactFile | null {
  const reference = shape ? embeddedArtifactOf(shape) : null
  if (!reference) return null
  const artifact = artifacts.find((item) => item.id === reference.id)
  if (!artifact) return null
  const version = reference.versionId
    ? artifact.versions.find((item) => item.id === reference.versionId)
    : undefined
  return { artifact, path: version?.relativePath ?? artifact.relativePath }
}
