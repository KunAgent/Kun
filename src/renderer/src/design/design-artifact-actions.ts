import type { DesignArtifact } from './design-types'

export type GroupedDesignArtifacts = {
  html: DesignArtifact[]
  canvas: DesignArtifact[]
}

export function groupDesignArtifacts(artifacts: readonly DesignArtifact[]): GroupedDesignArtifacts {
  return artifacts.reduce<GroupedDesignArtifacts>(
    (groups, artifact) => {
      if (artifact.kind === 'canvas') groups.canvas.push(artifact)
      else groups.html.push(artifact)
      return groups
    },
    { html: [], canvas: [] }
  )
}

export function canImplementDesignArtifact(
  artifact: DesignArtifact | null | undefined
): artifact is DesignArtifact & { kind: 'html' } {
  return artifact?.kind === 'html'
}
