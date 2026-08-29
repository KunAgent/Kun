import { describe, expect, it } from 'vitest'
import { chartSpecFromToolItem, parseRendererChartSpec } from './chart-spec-adapter'
import { chatBlockFromItem, toolEventFromItem } from './kun-mapper-events'

const spec = {
  version: 1,
  type: 'line',
  title: 'Errors',
  data: [{ day: 'Mon', count: 2 }, { day: 'Tue', count: 5 }],
  x: { field: 'day', label: 'Day' },
  y: { field: 'count', label: 'Errors' },
  series: [{ field: 'count', label: 'Errors', color: 'danger' }],
  actions: ['expand', 'download-csv', 'download-png']
}

describe('renderer chart adapter', () => {
  it('parses the governed chart contract from JSON fences', () => {
    expect(parseRendererChartSpec(JSON.stringify(spec))).toMatchObject({
      type: 'line', title: 'Errors', series: [{ field: 'count', color: 'danger' }]
    })
  })

  it('extracts replay/live specs from render_chart items only', () => {
    expect(chartSpecFromToolItem({ kind: 'tool_result', status: 'completed', toolName: 'render_chart', output: { chart: spec } }))
      .toMatchObject({ title: 'Errors' })
    expect(chartSpecFromToolItem({ kind: 'tool_result', status: 'completed', toolName: 'bash', output: spec })).toBeNull()
  })

  it('maps replay items to ChartBlock and live items to chart metadata', () => {
    const item = {
      id: 'chart-1', turnId: 'turn-1', threadId: 'thread-1', role: 'tool' as const,
      status: 'completed' as const, createdAt: '2026-08-27T00:00:00Z',
      kind: 'tool_result', callId: 'call-1', toolName: 'render_chart', output: spec
    }
    expect(chatBlockFromItem(item)).toMatchObject({ kind: 'chart', id: 'tool_call-1', spec: { title: 'Errors' } })
    expect(toolEventFromItem(item).meta).toMatchObject({ chartSpec: { title: 'Errors' } })
  })

  it('accepts namespaced SDK chart tools', () => {
    expect(chartSpecFromToolItem({
      kind: 'tool_result',
      status: 'completed',
      toolName: 'mcp__kun_server__render_chart',
      output: JSON.stringify({ status: 'completed', chart: spec })
    })).toMatchObject({ title: 'Errors' })
  })

  it('does not render calls or failed results before runtime validation succeeds', () => {
    expect(chartSpecFromToolItem({
      kind: 'tool_call', status: 'running', toolName: 'render_chart', arguments: spec
    })).toBeNull()
    expect(chartSpecFromToolItem({
      kind: 'tool_result', status: 'failed', isError: true, toolName: 'render_chart', output: { chart: spec }
    })).toBeNull()
  })

  it('rejects untrusted and malformed values', () => {
    expect(parseRendererChartSpec({ ...spec, version: 2 })).toBeNull()
    expect(parseRendererChartSpec({ ...spec, data: [{ day: 'Mon', count: { html: '<script />' } }] })).toBeNull()
    expect(parseRendererChartSpec('{bad json')).toBeNull()
  })
})
