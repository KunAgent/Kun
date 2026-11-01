import type { NormalizedThread } from '../../agent/types'
import { readBrowserStorageItem, writeBrowserStorageItem } from '../../lib/browser-storage'
import type { SidebarThreadActivity } from './sidebar-project-selectors'

export type SidebarTaskThreadSplit = {
  /** Threads the project lists render as their own rows. */
  rest: NormalizedThread[]
  /** Task sessions nested under a parent row, in card order. */
  childrenByParent: Map<string, NormalizedThread[]>
}

/**
 * Task sessions whose parent conversation is listed nest under it; while the
 * user searches, every match stays a flat row so it can be found.
 */
export function splitSidebarTaskThreads(threads: readonly NormalizedThread[], options: { searching: boolean }): SidebarTaskThreadSplit {
  const childrenByParent = new Map<string, NormalizedThread[]>()
  if (options.searching) return { rest: [...threads], childrenByParent }
  const ids = new Set(threads.map((thread) => thread.id))
  const rest: NormalizedThread[] = []
  for (const thread of threads) {
    const parentId = thread.relation === 'task' ? thread.parentThreadId : undefined
    if (!parentId || parentId === thread.id || !ids.has(parentId)) { rest.push(thread); continue }
    const siblings = childrenByParent.get(parentId) ?? []
    siblings.push(thread)
    childrenByParent.set(parentId, siblings)
  }
  for (const siblings of childrenByParent.values()) {
    siblings.sort((left, right) => (left.taskOrigin?.index ?? 99) - (right.taskOrigin?.index ?? 99) ||
      left.updatedAt.localeCompare(right.updatedAt))
  }
  return { rest, childrenByParent }
}

const SEVERITY: Record<SidebarThreadActivity, number> = {
  failed: 5, 'awaiting-input': 4, running: 3, unread: 2, scheduled: 1, read: 0
}

/** The most urgent child activity; a collapsed parent shows it on its count chip. */
export function strongestTaskActivity(activities: readonly SidebarThreadActivity[]): SidebarThreadActivity {
  return activities.reduce<SidebarThreadActivity>((best, next) => SEVERITY[next] > SEVERITY[best] ? next : best, 'read')
}

/** Only settled groups default closed; an error must not hide a still-running sibling. */
export function taskGroupIsFinished(activities: readonly SidebarThreadActivity[]): boolean {
  return activities.length > 0 && activities.every((activity) =>
    activity === 'read' || activity === 'unread' || activity === 'failed')
}

/** Started / suggested counts for the parent chip. */
export function taskGroupCounts(children: readonly NormalizedThread[]): { started: number; total: number } {
  const total = Math.max(children.length, ...children.map((child) => child.taskOrigin?.total ?? 0))
  return { started: children.length, total }
}

const COLLAPSE_KEY = 'kun.sidebar.taskGroupsCollapsed.v1'
const MAX_REMEMBERED = 200

export function loadCollapsedTaskGroups(): Set<string> {
  try {
    const parsed = JSON.parse(readBrowserStorageItem(COLLAPSE_KEY) ?? '[]') as unknown
    return new Set(Array.isArray(parsed) ? parsed.filter((entry): entry is string => typeof entry === 'string') : [])
  } catch { return new Set() }
}

export function saveCollapsedTaskGroups(ids: ReadonlySet<string>): void {
  try { writeBrowserStorageItem(COLLAPSE_KEY, JSON.stringify([...ids].slice(-MAX_REMEMBERED))) } catch { /* ignore */ }
}
