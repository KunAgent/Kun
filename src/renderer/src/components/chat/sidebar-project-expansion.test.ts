import { describe, expect, it } from 'vitest'
import {
  initialSidebarProjectExpansionStage,
  nextSidebarProjectExpansionStage,
  resetSidebarProjectExpansionStage,
  sidebarProjectHasVisibleThreadOverflow,
  sidebarProjectNextBatchCount,
  sidebarProjectVisibleItems,
  sidebarProjectVisibleThreadCount,
  SIDEBAR_PROJECT_THREAD_BATCH_SIZE,
  type SidebarProjectExpansionStage
} from './sidebar-project-expansion'

const INITIAL_STAGE = initialSidebarProjectExpansionStage()

function expansionCycle(threadCount: number, clicks: number): SidebarProjectExpansionStage[] {
  const stages: SidebarProjectExpansionStage[] = [INITIAL_STAGE]
  for (let index = 0; index < clicks; index += 1) {
    stages.push(nextSidebarProjectExpansionStage(threadCount, stages.at(-1) ?? INITIAL_STAGE))
  }
  return stages
}

describe('sidebar project expansion', () => {
  it('keeps expanding a 22-thread project one five-row batch at a time', () => {
    const stages = expansionCycle(22, 5)

    expect(stages).toEqual([5, 10, 15, 20, 22, 22])
    expect(stages.map((stage) => sidebarProjectVisibleThreadCount(22, stage))).toEqual([
      5, 10, 15, 20, 22, 22
    ])
    expect(stages.at(-1)).toBeLessThan(22 + SIDEBAR_PROJECT_THREAD_BATCH_SIZE)
  })

  it('advances a six-thread project by exactly one batch before collapsing', () => {
    const stages = expansionCycle(6, 2)

    expect(stages.map((stage) => sidebarProjectVisibleThreadCount(6, stage))).toEqual([5, 6, 6])
    expect(nextSidebarProjectExpansionStage(6, 6)).toBe(6)
  })

  it.each([
    [3, [3, 3]],
    [8, [5, 8, 8]],
    [12, [5, 10, 12, 12]],
    [20, [5, 10, 15, 20, 20]]
  ])('expands a %i-thread project without exceeding its thread count', (threadCount, visibleCounts) => {
    const stages = expansionCycle(threadCount, visibleCounts.length - 1)

    expect(stages.map((stage) => sidebarProjectVisibleThreadCount(threadCount, stage))).toEqual(visibleCounts)
    expect(stages.every((stage) => sidebarProjectVisibleThreadCount(threadCount, stage) <= threadCount)).toBe(true)
  })

  it('keeps forced running items visible without changing the expansion stage', () => {
    const threads = ['one', 'two', 'three', 'four', 'five', 'running', 'hidden']
    const visibleCount = sidebarProjectVisibleThreadCount(threads.length, INITIAL_STAGE)

    expect(sidebarProjectVisibleItems(
      threads,
      visibleCount,
      (thread) => thread === 'running'
    )).toEqual({
      items: ['one', 'two', 'three', 'four', 'five', 'running'],
      hiddenCount: 1
    })
    expect(sidebarProjectVisibleItems(threads, visibleCount, () => false)).toEqual({
      items: ['one', 'two', 'three', 'four', 'five'],
      hiddenCount: 2
    })
  })

  it('labels the next batch with the real added rows instead of the cached backlog', () => {
    const threads = Array.from({ length: 22 }, (_, index) => `thread-${index + 1}`)
    const forceVisible = () => false

    expect(sidebarProjectNextBatchCount(threads, INITIAL_STAGE, forceVisible)).toBe(5)
    expect(sidebarProjectNextBatchCount(threads, 10, forceVisible)).toBe(5)
    expect(sidebarProjectNextBatchCount(threads, 15, forceVisible)).toBe(5)
    expect(sidebarProjectNextBatchCount(threads, 20, forceVisible)).toBe(2)
    expect(sidebarProjectNextBatchCount(threads, 22, forceVisible)).toBe(0)
  })

  it('does not inflate the next-batch count for already visible forced rows', () => {
    const threads = Array.from({ length: 15 }, (_, index) => `thread-${index + 1}`)
    const forced = (thread: string) => thread === 'thread-13'

    // thread-13 is forced visible past the cap, but it is already shown, so
    // the label stays at the real number of newly revealed rows.
    expect(sidebarProjectNextBatchCount(threads, INITIAL_STAGE, forced)).toBe(5)
    expect(sidebarProjectNextBatchCount(threads, 10, forced)).toBe(4)
  })

  it('reports remaining threads only until all loaded threads are visible', () => {
    expect(sidebarProjectHasVisibleThreadOverflow(20, INITIAL_STAGE)).toBe(true)
    expect(sidebarProjectHasVisibleThreadOverflow(20, 10)).toBe(true)
    expect(sidebarProjectHasVisibleThreadOverflow(20, 15)).toBe(true)
    expect(sidebarProjectHasVisibleThreadOverflow(20, 20)).toBe(false)
    expect(sidebarProjectHasVisibleThreadOverflow(12, 12)).toBe(false)
  })

  it('resets collapsed projects to the initial batch cap', () => {
    expect(resetSidebarProjectExpansionStage()).toBe(SIDEBAR_PROJECT_THREAD_BATCH_SIZE)
    expect(sidebarProjectVisibleThreadCount(50, resetSidebarProjectExpansionStage())).toBe(5)
  })
})
