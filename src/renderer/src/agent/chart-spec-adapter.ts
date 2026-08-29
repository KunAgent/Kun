import {
  ChartSpecV1Schema,
  MAX_CHART_SPEC_BYTES,
  type ChartAxisSpecV1,
  type ChartSeriesSpecV1,
  type ChartSpecV1,
  type ChartValue
} from '@kun/extension-api'

export type RendererChartFormat = NonNullable<ChartAxisSpecV1['format']>
export type RendererChartSeries = ChartSeriesSpecV1 & Pick<ChartAxisSpecV1, 'format' | 'currency'>
export type RendererChartSpec = Omit<ChartSpecV1, 'series' | 'actions'> & {
  series: RendererChartSeries[]
  actions: NonNullable<ChartSpecV1['actions']>
}

function record(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value)
}

function candidate(value: unknown): unknown {
  let resolved = value
  if (typeof resolved === 'string') {
    if (new TextEncoder().encode(resolved).byteLength > MAX_CHART_SPEC_BYTES) return null
    try { resolved = JSON.parse(resolved) } catch { return null }
  }
  if (!record(resolved)) return resolved
  for (const key of ['chart', 'spec', 'chartSpec']) {
    const nested = resolved[key]
    if (record(nested)) return nested
  }
  return resolved
}

/** Second trust-boundary validation for durable tool output and Markdown fences. */
export function parseRendererChartSpec(value: unknown): RendererChartSpec | null {
  const parsed = ChartSpecV1Schema.safeParse(candidate(value))
  if (!parsed.success) return null
  const spec = parsed.data
  const ySeries = spec.y ? [{
    field: spec.y.field,
    ...(spec.y.label ? { label: spec.y.label } : {}),
    ...(spec.y.format ? { format: spec.y.format } : {}),
    ...(spec.y.currency ? { currency: spec.y.currency } : {})
  }] : []
  return {
    ...spec,
    series: spec.series?.map((series) => ({
      ...series,
      ...(spec.y?.field === series.field && spec.y.format ? { format: spec.y.format } : {}),
      ...(spec.y?.field === series.field && spec.y.currency ? { currency: spec.y.currency } : {})
    })) ?? ySeries,
    actions: spec.actions ?? ['expand']
  }
}

export function canonicalChartToolName(value: string | undefined): string {
  const name = value ?? ''
  const marker = name.lastIndexOf('__')
  return marker >= 0 ? name.slice(marker + 2) : name
}

export function chartSpecFromToolItem(item: {
  kind?: string
  status?: string
  isError?: boolean
  toolName?: string
  arguments?: Record<string, unknown>
  output?: unknown
}): RendererChartSpec | null {
  if (
    item.kind !== 'tool_result' ||
    item.status !== 'completed' ||
    item.isError === true ||
    canonicalChartToolName(item.toolName) !== 'render_chart'
  ) return null
  return parseRendererChartSpec(item.output)
}

export function displayChartValue(value: ChartValue): string {
  return value === null ? '—' : typeof value === 'boolean' ? (value ? 'Yes' : 'No') : String(value)
}
