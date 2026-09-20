import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it, vi } from 'vitest'
import { ChartRenderer, ChartSkeleton } from './ChartRenderer'

vi.mock('lucide-react', () => ({
  Download: () => null, Expand: () => null, Table2: () => null, X: () => null
}))

const spec = {
  version: 1 as const,
  type: 'bar' as const,
  title: 'Build duration',
  description: 'Minutes by stage',
  data: [{ stage: 'Test', minutes: 8 }, { stage: 'Build', minutes: 12 }],
  x: { field: 'stage', label: 'Stage' },
  y: { field: 'minutes', label: 'Minutes' },
  series: [{ field: 'minutes', label: 'Duration', color: 'accent' as const }],
  actions: ['expand', 'download-csv', 'download-png'] as const
}

describe('ChartRenderer', () => {
  it('provides an SVG graphic, accessible summary, and governed actions', () => {
    const html = renderToStaticMarkup(createElement(ChartRenderer, { spec: { ...spec, actions: [...spec.actions] } }))
    expect(html).toContain('role="img"')
    expect(html).toContain('Build duration')
    expect(html).toContain('Download CSV')
    expect(html).toContain('Download PNG')
    expect(html).toContain('Show data table')
    expect(html).toContain('Test: Duration 8')
  })

  it('renders a legend, stacked marks, and horizontal ranking layout', () => {
    const stacked = renderToStaticMarkup(createElement(ChartRenderer, {
      spec: {
        ...spec,
        data: [{ stage: 'Test', a: 2, b: 3 }, { stage: 'Build', a: 4, b: 1 }],
        series: [
          { field: 'a', label: 'Compile', stack: 'total' },
          { field: 'b', label: 'Link', stack: 'total' }
        ],
        actions: [...spec.actions]
      }
    }))
    expect(stacked).toContain('data-chart-stacked="true"')
    expect(stacked).toContain('data-chart-legend')
    expect(stacked).toContain('Compile')
    expect(stacked).toContain('Link')

    const horizontal = renderToStaticMarkup(createElement(ChartRenderer, {
      spec: {
        ...spec,
        data: [{ stage: 'Very long integration stage name', minutes: 8 }],
        actions: [...spec.actions]
      }
    }))
    expect(horizontal).toContain('data-chart-orientation="horizontal"')
  })

  it('renders a pending chart skeleton without pretending the graphic is ready', () => {
    const html = renderToStaticMarkup(createElement(ChartSkeleton, { title: 'Latency trend' }))
    expect(html).toContain('data-chart-skeleton')
    expect(html).toContain('aria-busy="true"')
    expect(html).toContain('Latency trend')
  })
})
