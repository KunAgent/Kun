import type { WorkspaceFileTarget } from '@shared/workspace-file'
import { workspaceFileTargetKey } from '../../lib/workspace-file-target-key'

/** Which preview tabs a bulk close removes, relative to the right-clicked one. */
export type FilePreviewCloseScope = 'others' | 'right' | 'all'

/** The tabs a bulk close keeps. Pinned tabs always stay. */
export function keepFilePreviewTargets(
  targets: WorkspaceFileTarget[],
  anchor: WorkspaceFileTarget,
  pinnedTargetKeys: ReadonlySet<string>,
  scope: FilePreviewCloseScope
): WorkspaceFileTarget[] {
  const anchorKey = workspaceFileTargetKey(anchor)
  const anchorIndex = targets.findIndex((target) => workspaceFileTargetKey(target) === anchorKey)
  return targets.filter((target, index) => {
    const key = workspaceFileTargetKey(target)
    if (pinnedTargetKeys.has(key)) return true
    if (scope === 'all') return false
    if (scope === 'right') return anchorIndex < 0 || index <= anchorIndex
    return key === anchorKey
  })
}
