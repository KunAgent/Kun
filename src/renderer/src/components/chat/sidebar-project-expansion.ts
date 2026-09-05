export const SIDEBAR_PROJECT_THREAD_BATCH_SIZE = 5

/**
 * Absolute visible-row cap per project workspace. The sidebar never renders
 * more than this many root threads at once, so locally cached pages and
 * freshly merged remote pages both expand through the same bounded window
 * instead of dumping an entire fetched page at once.
 */
export type SidebarProjectExpansionStage = number

/** Collapse always returns to the initial newest batch. */
export function resetSidebarProjectExpansionStage(): SidebarProjectExpansionStage {
  return SIDEBAR_PROJECT_THREAD_BATCH_SIZE
}

/** The initial stage already allows the first batch. */
export function initialSidebarProjectExpansionStage(): SidebarProjectExpansionStage {
  return SIDEBAR_PROJECT_THREAD_BATCH_SIZE
}

export function sidebarProjectVisibleThreadCount(
  threadCount: number,
  stage: SidebarProjectExpansionStage
): number {
  const normalizedThreadCount = Math.max(0, threadCount)
  const stageCap = Math.max(SIDEBAR_PROJECT_THREAD_BATCH_SIZE, Math.floor(stage))
  return Math.min(normalizedThreadCount, stageCap)
}

export function sidebarProjectHasVisibleThreadOverflow(
  threadCount: number,
  stage: SidebarProjectExpansionStage
): boolean {
  return sidebarProjectVisibleThreadCount(threadCount, stage) < Math.max(0, threadCount)
}

export function sidebarProjectVisibleItems<T>(
  items: readonly T[],
  visibleCount: number,
  forceVisible: (item: T) => boolean
): { items: T[]; hiddenCount: number } {
  const visible = items.filter((item, index) => index < visibleCount || forceVisible(item))
  return {
    items: visible,
    hiddenCount: Math.max(0, items.length - visible.length)
  }
}

/**
 * Advance the cap by one batch, landing exactly on the loaded count when the
 * remaining local tail is smaller than a full batch. Pinning the cap to the
 * loaded count keeps a later remote page from rendering through leftover
 * allowance before its own "load more" click.
 */
export function nextSidebarProjectExpansionStage(
  threadCount: number,
  stage: SidebarProjectExpansionStage
): SidebarProjectExpansionStage {
  const loadedCount = Math.max(0, Math.floor(threadCount))
  const currentCap = sidebarProjectVisibleThreadCount(loadedCount, stage)
  if (!sidebarProjectHasVisibleThreadOverflow(loadedCount, stage)) return currentCap
  const remaining = loadedCount - currentCap
  const batch = Math.min(SIDEBAR_PROJECT_THREAD_BATCH_SIZE, remaining)
  return currentCap + batch
}

/**
 * Rows that one more local expansion would add, accounting for forced-visible
 * items. This is the label count for "show next N", never the total hidden
 * backlog of the locally cached page.
 */
export function sidebarProjectNextBatchCount<T>(
  items: readonly T[],
  stage: SidebarProjectExpansionStage,
  forceVisible: (item: T) => boolean
): number {
  const currentSelection = sidebarProjectVisibleItems(items, sidebarProjectVisibleThreadCount(items.length, stage), forceVisible)
  const nextStage = nextSidebarProjectExpansionStage(items.length, stage)
  if (nextStage === sidebarProjectVisibleThreadCount(items.length, stage)) return 0
  const nextSelection = sidebarProjectVisibleItems(
    items,
    sidebarProjectVisibleThreadCount(items.length, nextStage),
    forceVisible
  )
  return nextSelection.items.length - currentSelection.items.length
}
