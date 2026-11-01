import type { NormalizedThread } from '../../agent/types'

/**
 * Prefix the main process writes into every thread title it creates for a
 * scheduled run (scheduledThreadTitle in schedule-runtime-queue). It is the
 * only marker of a scheduled run that reaches the renderer, and renaming such a
 * thread drops it, so the sidebar only ever uses this for list grouping.
 */
const SCHEDULED_TASK_THREAD_TITLE_PREFIX = '[Scheduled task]'

export function isScheduledTaskThread(
  thread: Pick<NormalizedThread, 'title'>
): boolean {
  return thread.title.trimStart().startsWith(SCHEDULED_TASK_THREAD_TITLE_PREFIX)
}

/**
 * Scheduled run sessions belong to the Automation view. Hiding them here keeps
 * project lists and the mobile recent list free of repetitive run rows; an
 * explicit search still reveals them.
 */
export function withoutScheduledTaskThreads<T extends Pick<NormalizedThread, 'id' | 'title'>>(
  threads: readonly T[],
  options: { revealAll?: boolean; keepThreadId?: string | null } = {}
): T[] {
  if (options.revealAll) return [...threads]
  return threads.filter((thread) =>
    thread.id === options.keepThreadId || !isScheduledTaskThread(thread)
  )
}

/** How many scheduled-run sessions the sidebar is currently holding back. */
export function hiddenScheduledTaskThreadCount(
  threads: readonly Pick<NormalizedThread, 'id' | 'title' | 'archived'>[],
  options: { searching?: boolean; showArchived?: boolean; keepThreadId?: string | null } = {}
): number {
  if (options.searching) return 0
  return threads.filter((thread) =>
    isScheduledTaskThread(thread) &&
    thread.id !== options.keepThreadId &&
    (thread.archived === true) === Boolean(options.showArchived)
  ).length
}
