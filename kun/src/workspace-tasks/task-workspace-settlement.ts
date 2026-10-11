import type { TaskWorkspaceRecord } from '../contracts/task-workspace.js'

/** The subset of TaskWorkspaceService needed to observe store settlement. */
export type TaskWorkspaceSettlementSource = {
  get(workspaceId: string): TaskWorkspaceRecord | undefined
  onChange(listener: (record: TaskWorkspaceRecord) => void): () => void
}

/**
 * Resolve once a newly created workspace leaves its transient states.
 * `create` returns a provisional record whose `path` still names the
 * source root; only the settled record carries the real checkout path —
 * the ADE worker security snapshot must be minted from that final path.
 */
export async function waitForTaskWorkspaceSettlement(
  source: TaskWorkspaceSettlementSource,
  workspaceId: string,
  signal?: AbortSignal
): Promise<TaskWorkspaceRecord | undefined> {
  const settled = (r: TaskWorkspaceRecord | undefined): r is TaskWorkspaceRecord =>
    r !== undefined && r.state !== 'creating' && r.state !== 'setting-up'
  const current = source.get(workspaceId)
  if (settled(current)) return current
  return new Promise((resolve) => {
    const finish = () => {
      off()
      signal?.removeEventListener('abort', finish)
      resolve(source.get(workspaceId))
    }
    const off = source.onChange((r) => {
      if (r.workspaceId === workspaceId && settled(r)) finish()
    })
    if (signal?.aborted) finish()
    else signal?.addEventListener('abort', finish, { once: true })
  })
}
