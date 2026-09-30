/**
 * ADE sidebar grouping (00 §4): status buckets extended with 待审查 / 已完成,
 * an optional by-project grouping, and worker threads nested under their
 * manager. Kept pure so the ordering rules stay unit-testable.
 */
import type { NormalizedThread } from '../../agent/types'
import {
  displayBucket,
  type ActivityDisplayBucket
} from '@shared/activity-display'
import type { ActivityRow } from '@shared/activity-row'
import type { SidebarThreadActivity } from '../chat/sidebar-project-selectors'

export type AdeStatusGroup = 'attention' | 'review' | 'running' | 'done' | 'idle'

/** Ordered per 00 §4: 待你处理 / 待审查 / 进行中 / 已完成 / 会话. */
export const ADE_STATUS_GROUP_ORDER: readonly AdeStatusGroup[] = [
  'attention',
  'review',
  'running',
  'done',
  'idle'
]

/** Display buckets a thread's own activity rows currently sit in. */
export function threadDisplayBuckets(
  rows: Record<string, ActivityRow>,
  threadId: string,
  now = Date.now()
): Set<ActivityDisplayBucket> {
  const out = new Set<ActivityDisplayBucket>()
  for (const row of Object.values(rows)) {
    if (row.parentThreadId !== threadId || row.visibility === 'archived') continue
    out.add(displayBucket(row, now))
  }
  return out
}

/** Priority: attention > review > running > done > idle. */
export function adeStatusGroup(
  thread: NormalizedThread,
  activity: SidebarThreadActivity,
  buckets: Set<ActivityDisplayBucket>
): AdeStatusGroup {
  if (
    activity === 'awaiting-input' ||
    activity === 'failed' ||
    activity === 'unread' ||
    buckets.has('needs-you')
  ) {
    return 'attention'
  }
  if (buckets.has('review')) return 'review'
  if (activity === 'running' || activity === 'scheduled' || buckets.has('working')) {
    return 'running'
  }
  if (buckets.has('done')) return 'done'
  return 'idle'
}

/** Split worker threads out by parent; parents not in the list stay roots. */
export function indexAdeThreads(threads: readonly NormalizedThread[]): {
  roots: NormalizedThread[]
  childrenByParent: Map<string, NormalizedThread[]>
} {
  const ids = new Set(threads.map((t) => t.id))
  const roots: NormalizedThread[] = []
  const childrenByParent = new Map<string, NormalizedThread[]>()
  for (const thread of threads) {
    const parentId = thread.parentThreadId
    if (parentId && ids.has(parentId)) {
      const list = childrenByParent.get(parentId) ?? []
      list.push(thread)
      childrenByParent.set(parentId, list)
    } else {
      roots.push(thread)
    }
  }
  return { roots, childrenByParent }
}

/** Short project label for the by-project grouping toggle. */
export function projectLabel(thread: NormalizedThread): string {
  const ws = (thread.workspace ?? '').replace(/[/\\]+$/, '')
  if (!ws) return '(no workspace)'
  return ws.split(/[/\\]/).pop() || ws
}

export function groupByProject(
  roots: readonly NormalizedThread[]
): Array<{ key: string; label: string; items: NormalizedThread[] }> {
  const byProject = new Map<string, NormalizedThread[]>()
  for (const thread of roots) {
    const label = projectLabel(thread)
    const list = byProject.get(label) ?? []
    list.push(thread)
    byProject.set(label, list)
  }
  return [...byProject.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([label, items]) => ({ key: `project:${label}`, label, items }))
}
