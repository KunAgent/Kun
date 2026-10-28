import { parseArtifactMeta } from '../design/design-artifact-persistence'
import type { DesignArtifact } from '../design/design-types'
import type { LibraryArtifact } from './artifact-types'

export type DesignScreen = Pick<DesignArtifact, 'id' | 'title' | 'relativePath' | 'versions'>

/** HTML screens of a design draft, in canvas reading order (top to bottom, left to right). */
export async function loadDesignScreens(artifact: LibraryArtifact): Promise<DesignScreen[]> {
  const api = window.kunGui
  if (!api?.listWorkspaceDirectory || !api.readWorkspaceFile) return []
  const listing = await api.listWorkspaceDirectory({ workspaceRoot: artifact.workspaceRoot, path: artifact.path })
  if (!listing.ok) return []
  const metas = await Promise.all(listing.entries.filter((entry) => entry.type === 'directory').map(async (entry) => {
    const dir = `${artifact.path}/${entry.name}`
    const read = await api.readWorkspaceFile({ workspaceRoot: artifact.workspaceRoot, path: `${dir}/meta.json` }).catch(() => null)
    return read?.ok ? parseArtifactMeta(read.content, entry.name, dir) : null
  }))
  return metas
    .filter((meta): meta is DesignArtifact => Boolean(meta && meta.kind === 'html' && meta.relativePath))
    .sort((left, right) => (left.node?.y ?? 0) - (right.node?.y ?? 0) || (left.node?.x ?? 0) - (right.node?.x ?? 0) || left.createdAt.localeCompare(right.createdAt))
}
