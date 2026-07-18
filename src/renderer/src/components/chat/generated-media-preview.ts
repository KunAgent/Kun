import type { WorkspaceFileTarget, WorkspaceImageReadResult } from '@shared/workspace-file'

const DEFAULT_WORKSPACE_IMAGE_RETRY_DELAYS_MS = [0, 120, 300, 700, 1_400] as const

type WorkspaceImageReader = (target: WorkspaceFileTarget) => Promise<WorkspaceImageReadResult>

/**
 * Generated-file metadata can reach the timeline just before a renderer-owned
 * export finishes writing its image. Retry that short race so a transient
 * "file not found" does not permanently downgrade the conversation preview to
 * a generic file card.
 */
export async function readGeneratedWorkspaceImagePreview(options: {
  path: string
  workspaceRoot?: string
  readImage: WorkspaceImageReader
  retryDelaysMs?: readonly number[]
  wait?: (delayMs: number) => Promise<void>
}): Promise<string | null> {
  const delays = options.retryDelaysMs ?? DEFAULT_WORKSPACE_IMAGE_RETRY_DELAYS_MS
  const wait = options.wait ?? ((delayMs: number) => new Promise<void>((resolve) => {
    window.setTimeout(resolve, delayMs)
  }))

  for (const delayMs of delays) {
    if (delayMs > 0) await wait(delayMs)
    const result = await options.readImage({
      path: options.path,
      ...(options.workspaceRoot ? { workspaceRoot: options.workspaceRoot } : {})
    })
    if (result.ok) return result.dataUrl
  }
  return null
}
