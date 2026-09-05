import type { NormalizedThread } from '../../agent/types'
import { sidebarThreadActivity, type SidebarThreadActivityContext } from './sidebar-project-selectors'
import {
  initialSidebarProjectExpansionStage,
  nextSidebarProjectExpansionStage,
  resetSidebarProjectExpansionStage,
  sidebarProjectNextBatchCount,
  sidebarProjectVisibleItems,
  sidebarProjectVisibleThreadCount,
  type SidebarProjectExpansionStage
} from './sidebar-project-expansion'

/**
 * Per-workspace expansion window operations shared by the sidebar project
 * content. Keeping them here co-locates the batch bookkeeping that used to
 * live inline in the large content component.
 */
export function expansionStageFor(
  expandedWorkspaces: Record<string, SidebarProjectExpansionStage>,
  workspacePath: string
): SidebarProjectExpansionStage {
  return expandedWorkspaces[workspacePath] ?? initialSidebarProjectExpansionStage()
}

export function showMoreStageFor(
  current: Record<string, SidebarProjectExpansionStage>,
  workspacePath: string,
  rootThreadCount: number
): SidebarProjectExpansionStage {
  return nextSidebarProjectExpansionStage(
    rootThreadCount,
    expansionStageFor(current, workspacePath)
  )
}

/**
 * Reserve exactly one next batch for an in-flight remote page so a merged
 * page can only reveal its first five rows, regardless of how many rows the
 * page actually contributed. Repeated retries reuse the same reservation
 * because it is a max against the loaded count plus one batch.
 */
export function reserveLoadMoreStageFor(
  current: Record<string, SidebarProjectExpansionStage>,
  workspacePath: string,
  rootThreadCount: number
): Record<string, SidebarProjectExpansionStage> {
  const currentStage = expansionStageFor(current, workspacePath)
  const reserved = Math.max(currentStage, rootThreadCount + initialSidebarProjectExpansionStage())
  if (reserved === currentStage) return current
  return { ...current, [workspacePath]: reserved }
}

/** Everything the content component needs to render one project's window. */
export type SidebarExpansionWindowSelection<T> = {
  stage: SidebarProjectExpansionStage
  visibleThreads: T[]
  hiddenCount: number
  nextBatchCount: number
}

export function sidebarExpansionWindowFor<T>(
  items: readonly T[],
  expandedWorkspaces: Record<string, SidebarProjectExpansionStage>,
  workspacePath: string,
  forceVisible: (item: T) => boolean
): SidebarExpansionWindowSelection<T> {
  const stage = expansionStageFor(expandedWorkspaces, workspacePath)
  const visibleCount = sidebarProjectVisibleThreadCount(items.length, stage)
  const selection = sidebarProjectVisibleItems(items, visibleCount, forceVisible)
  return {
    stage,
    visibleThreads: selection.items,
    hiddenCount: selection.hiddenCount,
    nextBatchCount: sidebarProjectNextBatchCount(items, stage, forceVisible)
  }
}

export function resetExpansionStageFor(
  current: Record<string, SidebarProjectExpansionStage>,
  workspacePath: string
): Record<string, SidebarProjectExpansionStage> {
  if (current[workspacePath] === undefined) return current
  return { ...current, [workspacePath]: resetSidebarProjectExpansionStage() }
}

export function isForceVisibleSidebarThread(
  thread: NormalizedThread,
  activeThreadId: string | null,
  context: SidebarThreadActivityContext
): boolean {
  return thread.id === activeThreadId
    || sidebarThreadActivity(thread, context) === 'running'
}
