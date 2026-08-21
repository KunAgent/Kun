import { describe, expect, it } from 'vitest'
import {
  nextSidebarProjectExpansionStage,
  sidebarProjectHasVisibleThreadOverflow,
  sidebarProjectVisibleItems,
  sidebarProjectVisibleThreadCount,
  type SidebarProjectExpansionStage
} from './sidebar-project-expansion'

function expansionCycle(threadCount: number, clicks: number): SidebarProjectExpansionStage[] {
  const stages: SidebarProjectExpansionStage[] = [0]
  for (let index = 0; index < clicks; index += 1) {
    stages.push(nextSidebarProjectExpansionStage(threadCount, stages.at(-1) ?? 0))
  }
  return stages
}

describe('sidebar project expansion', () => {
  it('shows two additional batches before expanding a large project completely', () => {
    const stages = expansionCycle(20, 4)

    expect(stages).toEqual([0, 1, 2, 3, 0])
    expect(stages.map((stage) => sidebarProjectVisibleThreadCount(20, stage))).toEqual([
      5, 10, 15, 20, 5
    ])
  })

  it('advances a six-thread project to its complete local batch before collapsing', () => {
    const stages = expansionCycle(6, 2)

    expect(stages).toEqual([0, 1, 0])
    expect(stages.map((stage) => sidebarProjectVisibleThreadCount(6, stage))).toEqual([5, 6, 5])
  })

  it.each([
    [8, [5, 8, 5]],
    [12, [5, 10, 12, 5]]
  ])('expands a %i-thread project without exceeding its thread count', (threadCount, visibleCounts) => {
    const stages = expansionCycle(threadCount, visibleCounts.length - 1)

    expect(stages.map((stage) => sidebarProjectVisibleThreadCount(threadCount, stage))).toEqual(visibleCounts)
    expect(stages.every((stage) => sidebarProjectVisibleThreadCount(threadCount, stage) <= threadCount)).toBe(true)
  })

  it('keeps forced running items visible without changing the expansion stage', () => {
    const threads = ['one', 'two', 'three', 'four', 'five', 'running', 'hidden']
    const visibleCount = sidebarProjectVisibleThreadCount(threads.length, 0)

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

  it('reports remaining threads only until all threads are visible', () => {
    expect(sidebarProjectHasVisibleThreadOverflow(20, 0)).toBe(true)
    expect(sidebarProjectHasVisibleThreadOverflow(20, 1)).toBe(true)
    expect(sidebarProjectHasVisibleThreadOverflow(20, 2)).toBe(true)
    expect(sidebarProjectHasVisibleThreadOverflow(20, 3)).toBe(false)
    expect(sidebarProjectHasVisibleThreadOverflow(12, 2)).toBe(false)
  })
})
