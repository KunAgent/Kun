import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it, vi } from 'vitest'
import { ChartRenderer } from './ChartRenderer'

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
})
