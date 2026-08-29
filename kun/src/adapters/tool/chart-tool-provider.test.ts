import { describe, expect, it } from 'vitest'
import type { ToolHostContext } from '../../ports/tool-host.js'
import { CapabilityRegistry } from './capability-registry.js'
import { buildChartToolProvider, CHART_TOOL_NAME } from './chart-tool-provider.js'

const chart = {
  version: 1,
  type: 'bar',
  title: 'Incidents by service',
  data: [{ service: 'API', incidents: 8 }, { service: 'Worker', incidents: 3 }],
  x: { field: 'service', label: 'Service', format: 'plain' },
  y: { field: 'incidents', label: 'Incidents', format: 'integer' },
  series: [{ field: 'incidents', label: 'Incidents', color: 'danger' }],
  actions: ['expand', 'download-csv']
} as const

function context(clientSurface: ToolHostContext['clientSurface'] = 'gui'): ToolHostContext {
  return {
    threadId: 'thread-1',
    turnId: 'turn-1',
    workspace: '/workspace',
    clientSurface,
    threadMode: 'agent',
    approvalPolicy: 'auto',
    abortSignal: new AbortController().signal,
    awaitApproval: async () => 'allow'
  }
}

describe('render_chart provider', () => {
  it('is dynamically gated by Lab conversationVisualization and GUI surface', () => {
    let enabled = false
    const registry = new CapabilityRegistry(buildChartToolProvider(() => ({ enabled })))
    expect(registry.listTools(context())).toEqual([])
    enabled = true
    expect(registry.listTools(context()).map((tool) => tool.name)).toContain(CHART_TOOL_NAME)
    expect(registry.listTools(context('tui'))).toEqual([])
    expect(registry.listTools(context('api'))).toEqual([])
  })

  it('returns the validated ChartSpec as ordinary tool output', async () => {
    const tool = buildChartToolProvider(() => ({ enabled: true }))[0]!.tools[0]!
    await expect(tool.execute(chart, context())).resolves.toEqual({
      output: {
        status: 'completed',
        summary: 'Rendered chart: Incidents by service',
        chart
      }
    })
  })

  it('rejects invalid specs and direct execution outside the GUI gate', async () => {
    const tool = buildChartToolProvider(() => ({ enabled: true }))[0]!.tools[0]!
    await expect(tool.execute({ ...chart, html: '<script />' }, context())).resolves.toMatchObject({
      output: { status: 'failed' }, isError: true
    })
    await expect(tool.execute(chart, context('tui'))).resolves.toEqual({
      output: {
        status: 'failed',
        error: 'render_chart is available only in the GUI when Lab conversation visualization is enabled'
      },
      isError: true
    })
  })
})
