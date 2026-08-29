import { z } from 'zod'

export const CHART_SPEC_VERSION = 1 as const
export const CHART_MAX_ENCODED_BYTES = 64 * 1024
export const CHART_MAX_ROWS = 500
export const CHART_MAX_COLUMNS = 24
export const CHART_MAX_SERIES = 8
export const MAX_CHART_SPEC_BYTES = CHART_MAX_ENCODED_BYTES
export const MAX_CHART_ROWS = CHART_MAX_ROWS
export const MAX_CHART_COLUMNS = CHART_MAX_COLUMNS
export const MAX_CHART_SERIES = CHART_MAX_SERIES

export const ChartValueSchema = z.union([
  z.string().max(500),
  z.number().finite(),
  z.boolean(),
  z.null()
])
export type ChartValue = z.infer<typeof ChartValueSchema>

export const ChartFormatSchema = z.enum([
  'plain', 'integer', 'decimal', 'percent', 'currency', 'date', 'datetime'
])
export const ChartAxisSpecV1Schema = z.strictObject({
  field: z.string().trim().min(1).max(80),
  label: z.string().trim().min(1).max(120).optional(),
  format: ChartFormatSchema.optional(),
  currency: z.string().regex(/^[A-Z]{3}$/).optional()
}).superRefine((axis, context) => {
  if (axis.currency && axis.format !== 'currency') {
    context.addIssue({ code: 'custom', path: ['currency'], message: 'currency requires currency format' })
  }
})
export type ChartAxisSpecV1 = z.infer<typeof ChartAxisSpecV1Schema>

export const ChartSeriesSpecV1Schema = z.strictObject({
  field: z.string().trim().min(1).max(80),
  label: z.string().trim().min(1).max(120).optional(),
  color: z.enum(['neutral', 'accent', 'success', 'warning', 'danger', 'severity']).optional(),
  stack: z.string().trim().min(1).max(40).optional()
})
export type ChartSeriesSpecV1 = z.infer<typeof ChartSeriesSpecV1Schema>

const ChartRowSchema = z.record(z.string().trim().min(1).max(80), ChartValueSchema)

export const ChartSpecV1Schema = z.strictObject({
  version: z.literal(CHART_SPEC_VERSION),
  type: z.enum(['metric', 'bar', 'line', 'area', 'pie', 'donut', 'table']),
  title: z.string().trim().min(1).max(120),
  description: z.string().trim().min(1).max(400).optional(),
  data: z.array(ChartRowSchema).min(1).max(MAX_CHART_ROWS),
  x: ChartAxisSpecV1Schema.optional(),
  y: ChartAxisSpecV1Schema.optional(),
  series: z.array(ChartSeriesSpecV1Schema).min(1).max(MAX_CHART_SERIES).optional(),
  columns: z.array(ChartAxisSpecV1Schema).min(1).max(MAX_CHART_COLUMNS).optional(),
  actions: z.array(z.enum(['expand', 'download-png', 'download-csv'])).max(3).optional()
}).superRefine((spec, context) => {
  const columns = new Set(spec.data.flatMap((row) => Object.keys(row)))
  if (columns.size > MAX_CHART_COLUMNS) {
    context.addIssue({ code: 'custom', path: ['data'], message: `chart exceeds ${MAX_CHART_COLUMNS} columns` })
  }
  const referenced = [
    ['x', spec.x?.field], ['y', spec.y?.field],
    ...(spec.series ?? []).map((series, index) => [`series.${index}`, series.field] as const),
    ...(spec.columns ?? []).map((column, index) => [`columns.${index}`, column.field] as const)
  ] as Array<readonly [string, string | undefined]>
  for (const [name, field] of referenced) {
    if (field && !columns.has(field)) {
      context.addIssue({ code: 'custom', path: [name], message: `unknown data field: ${field}` })
    }
  }
  const numeric = (field: string | undefined): boolean => Boolean(field) && spec.data.some((row) => typeof row[field!] === 'number')
  if (spec.type === 'table') {
    if (spec.x || spec.y || spec.series) {
      context.addIssue({ code: 'custom', message: 'table does not accept chart axes or series' })
    }
  } else if (spec.type === 'metric') {
    if (!spec.series?.length || spec.series.length !== 1 || !numeric(spec.series[0]?.field)) {
      context.addIssue({ code: 'custom', message: 'metric requires one numeric series' })
    }
  } else if (spec.type === 'pie' || spec.type === 'donut') {
    if (!spec.x || !spec.series?.length || spec.series.length !== 1 || !numeric(spec.series[0]?.field)) {
      context.addIssue({ code: 'custom', message: `${spec.type} requires a category x field and one numeric series` })
    }
  } else {
    if (!spec.x || !spec.series?.length || spec.series.some((series) => !numeric(series.field))) {
      context.addIssue({ code: 'custom', message: `${spec.type} requires x and numeric series` })
    }
  }
  if (new Set(spec.actions).size !== (spec.actions?.length ?? 0)) {
    context.addIssue({ code: 'custom', path: ['actions'], message: 'duplicate action' })
  }
  if (utf8Bytes(spec) > MAX_CHART_SPEC_BYTES) {
    context.addIssue({ code: 'custom', message: `chart exceeds ${MAX_CHART_SPEC_BYTES} bytes` })
  }
})
export const ChartSpecSchema = ChartSpecV1Schema
export type ChartSpecV1 = z.infer<typeof ChartSpecV1Schema>
export type ChartSpec = ChartSpecV1

export function safeParseChartSpec(value: unknown): ReturnType<typeof ChartSpecV1Schema.safeParse> {
  return ChartSpecV1Schema.safeParse(value)
}

export function parseChartSpec(value: unknown): ChartSpecV1 {
  return ChartSpecV1Schema.parse(value)
}

export function chartSpecTextSummary(spec: ChartSpecV1): string {
  const columns = chartColumns(spec)
  return `${spec.title}\n${spec.description ? `${spec.description}\n` : ''}${spec.data.length} rows · ${columns.length} columns`
}

export function chartSpecToCsv(spec: ChartSpecV1): string {
  const columns = chartColumns(spec)
  const rows = [columns, ...spec.data.map((row) => columns.map((column) => row[column] ?? ''))]
  return `\uFEFF${rows.map((row) => row.map(csvCell).join(',')).join('\r\n')}`
}

export function chartColumns(spec: ChartSpecV1): string[] {
  const columns: string[] = []
  const seen = new Set<string>()
  for (const row of spec.data) for (const key of Object.keys(row)) {
    if (!seen.has(key)) { seen.add(key); columns.push(key) }
  }
  return columns
}

function csvCell(value: ChartValue): string {
  let text = value === null ? '' : String(value)
  if (/^[=+\-@]/.test(text)) text = `'${text}`
  return `"${text.replaceAll('"', '""')}"`
}

function utf8Bytes(value: unknown): number {
  return new TextEncoder().encode(JSON.stringify(value)).byteLength
}
