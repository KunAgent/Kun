import { describe, expect, it } from 'vitest'
import type { RendererChartSpec } from '../../agent/chart-spec-adapter'
import {
  buildCartesianLayout,
  chartLegendItems,
  shouldUseHorizontalBar,
  usesStackedBars
} from './chart-renderer-layout'

const grouped: RendererChartSpec = {
  version: 1,
  type: 'bar',
  title: 'Build duration',
  data: [{ stage: 'Test', minutes: 8 }, { stage: 'Build', minutes: 12 }],
  x: { field: 'stage' },
  y: { field: 'minutes' },
  series: [{ field: 'minutes', label: 'Duration', color: 'accent' }],
  actions: ['expand']
}

describe('chart renderer layout', () => {
  it('uses a horizontal bar for long category labels or many ranks', () => {
    expect(shouldUseHorizontalBar(grouped)).toBe(false)
    expect(shouldUseHorizontalBar({
      ...grouped,
      data: [{ stage: 'Very long integration stage name', minutes: 8 }]
    })).toBe(true)
    expect(shouldUseHorizontalBar({
      ...grouped,
      data: Array.from({ length: 8 }, (_, index) => ({ stage: `S${index}`, minutes: index }))
    })).toBe(true)
    expect(shouldUseHorizontalBar({ ...grouped, type: 'line' })).toBe(false)
    const horizontal = buildCartesianLayout({
      ...grouped,
      data: [{ stage: 'Very long integration stage name', minutes: 8 }]
    }, 720)
    expect(horizontal.horizontal).toBe(true)
    expect(horizontal.categoryLabels[0]?.text).toContain('…')
  })

  it('stacks bars that share a stack key with non-negative values', () => {
    const stacked: RendererChartSpec = {
      ...grouped,
      data: [{ stage: 'Test', a: 2, b: 3 }, { stage: 'Build', a: 4, b: 1 }],
      series: [
        { field: 'a', label: 'A', stack: 'total' },
        { field: 'b', label: 'B', stack: 'total' }
      ]
    }
    expect(usesStackedBars(stacked)).toBe(true)
    const layout = buildCartesianLayout(stacked, 720)
    expect(layout.stacked).toBe(true)
    expect(layout.bars).toHaveLength(4)
    expect(chartLegendItems(stacked).map((item) => item.label)).toEqual(['A', 'B'])
  })

  it('ellipsizes and rotates crowded vertical category labels', () => {
    const layout = buildCartesianLayout({
      ...grouped,
      data: [
        { stage: 'compile', minutes: 8 },
        { stage: 'typecheck', minutes: 12 },
        { stage: 'unit-tests', minutes: 9 },
        { stage: 'lint-fix', minutes: 4 },
        { stage: 'bundle', minutes: 7 },
        { stage: 'publish', minutes: 3 }
      ]
    }, 280)
    expect(layout.horizontal).toBe(false)
    expect(layout.rotateLabels).toBe(true)
    expect(layout.categoryLabels.every((label) => label.full.length >= label.text.length)).toBe(true)
  })
})
