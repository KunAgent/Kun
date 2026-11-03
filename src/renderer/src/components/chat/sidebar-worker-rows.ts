import type { ActivityRow } from '@shared/activity-row'
import { displayBucket } from '@shared/activity-display'
import type { SidebarThreadActivity } from './sidebar-project-selectors'

/** One dispatched worker listed under the conversation that started it. */
export type SidebarWorkerRow = {
  unitId: string
  threadId: string
  turnId?: string
  title: string
  harnessId: string
  activity: SidebarThreadActivity
  /** Latest progress note or tool, shown at the row's end while it runs. */
  detail: string
}

function workerActivity(row: ActivityRow, now: number): SidebarThreadActivity | null {
  const bucket = displayBucket(row, now)
  if (bucket === 'working') return 'running'
  if (bucket === 'needs-you') return row.state === 'failed' ? 'failed' : 'awaiting-input'
  if (bucket === 'review' || bucket === 'done') return 'read'
  return null
}

/**
 * Dispatch workers are side threads the sidebar thread list never loads, so
 * their rows come from the activity feed instead, grouped by parent thread in
 * start order.
 */
export function selectSidebarWorkerRows(
  rows: Readonly<Record<string, ActivityRow>>,
  now: number = Date.now()
): Map<string, SidebarWorkerRow[]> {
  const byParent = new Map<string, ActivityRow[]>()
  for (const row of Object.values(rows)) {
    const parentId = row.parentThreadId?.trim()
    if (row.kind !== 'worker' || row.visibility === 'archived' || !parentId || !row.threadId || parentId === row.threadId) continue
    // Fast Context retrieval runs stay out of the sidebar task list: they are
    // shown by their evidence card in the conversation, and counting them here
    // would add task groups and badges for read-only searching. Rows without a
    // launcher are kept, so older records are never mis-hidden.
    if (row.childLauncher === 'fast_context') continue
    const siblings = byParent.get(parentId)
    if (siblings) siblings.push(row)
    else byParent.set(parentId, [row])
  }
  const result = new Map<string, SidebarWorkerRow[]>()
  for (const [parentId, siblings] of byParent) {
    siblings.sort((left, right) => left.stateSince.localeCompare(right.stateSince) || left.unitId.localeCompare(right.unitId))
    const listed: SidebarWorkerRow[] = []
    for (const row of siblings) {
      const activity = workerActivity(row, now)
      if (!activity) continue
      listed.push({
        unitId: row.unitId,
        threadId: row.threadId,
        ...(row.turnId ? { turnId: row.turnId } : {}),
        title: row.title.trim() || row.unitId,
        harnessId: row.harnessId,
        activity,
        detail: (row.progressNote ?? row.currentTool ?? '').trim()
      })
    }
    if (listed.length) result.set(parentId, listed)
  }
  return result
}
