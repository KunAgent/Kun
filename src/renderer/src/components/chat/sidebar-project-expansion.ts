export const SIDEBAR_PROJECT_THREAD_BATCH_SIZE = 5
export const SIDEBAR_PROJECT_THREAD_PARTIAL_EXPANSION_STEPS = 2

export type SidebarProjectExpansionStage =
  | 0
  | 1
  | 2
  | 3

export function sidebarProjectVisibleThreadCount(
  threadCount: number,
  stage: SidebarProjectExpansionStage
): number {
  const normalizedThreadCount = Math.max(0, threadCount)
  if (stage === 3) return normalizedThreadCount
  return Math.min(
    normalizedThreadCount,
    SIDEBAR_PROJECT_THREAD_BATCH_SIZE * (stage + 1)
  )
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

export function nextSidebarProjectExpansionStage(
  threadCount: number,
  stage: SidebarProjectExpansionStage
): SidebarProjectExpansionStage {
  if (!sidebarProjectHasVisibleThreadOverflow(threadCount, stage)) return 0
  return Math.min(
    stage + 1,
    SIDEBAR_PROJECT_THREAD_PARTIAL_EXPANSION_STEPS + 1
  ) as SidebarProjectExpansionStage
}
