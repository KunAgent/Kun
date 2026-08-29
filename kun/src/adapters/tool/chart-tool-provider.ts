import { ChartSpecV1Schema, type ChartSpecV1 } from '@kun/extension-api'
import { z } from 'zod'
import type { CapabilityToolProvider } from './capability-registry.js'
import { LocalToolHost } from './local-tool-host.js'

export const CHART_TOOL_NAME = 'render_chart' as const
export const CHART_PROVIDER_ID = 'chart' as const

export type ChartToolConfig = {
  enabled?: boolean
}

const inputSchema = z.toJSONSchema(ChartSpecV1Schema, {
  io: 'input',
  target: 'draft-07',
  reused: 'inline'
}) as Record<string, unknown>
delete inputSchema.$schema

const description = [
  'Render one governed data chart in the current GUI conversation from structured data and semantic presentation intent.',
  'Use it for trustworthy trends, rankings, comparisons, proportions, key metrics, or exact lookup tables when a chart is materially clearer than prose.',
  'State the conclusion in text before the chart. Do not use it for decoration or when the user requested prose-only or table-only output.',
  'Kun owns rendering, theme, layout, accessibility, and export; provide no HTML, CSS, JavaScript, URLs, or chart-library options.'
].join(' ')

export function buildChartToolProvider(
  config: () => ChartToolConfig | undefined
): CapabilityToolProvider[] {
  const enabled = (): boolean => config()?.enabled === true
  return [{
    id: CHART_PROVIDER_ID,
    kind: 'gui',
    enabled: true,
    available: true,
    effects: {
      network: false,
      externalWrite: false,
      processExecution: false,
      guiAutomation: false
    },
    tools: [LocalToolHost.defineTool({
      name: CHART_TOOL_NAME,
      description,
      inputSchema,
      toolKind: 'tool_call',
      policy: 'auto',
      sideEffect: 'read-only',
      shouldAdvertise: (context) => enabled() && context.clientSurface === 'gui',
      execute: async (args, context) => {
        if (!enabled() || context.clientSurface !== 'gui') {
          return failed('render_chart is available only in the GUI when Lab conversation visualization is enabled')
        }
        const parsed = ChartSpecV1Schema.safeParse(args)
        if (!parsed.success) return failed(z.prettifyError(parsed.error))
        return { output: chartOutput(parsed.data) }
      }
    })]
  }]
}

function chartOutput(chart: ChartSpecV1): {
  status: 'completed'
  summary: string
  chart: ChartSpecV1
} {
  return {
    status: 'completed',
    summary: `Rendered chart: ${chart.title}`,
    chart
  }
}

function failed(error: string): { output: { status: 'failed'; error: string }; isError: true } {
  return { output: { status: 'failed', error }, isError: true }
}
