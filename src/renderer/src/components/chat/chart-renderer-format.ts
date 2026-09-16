import type { RendererChartFormat, RendererChartSeries, RendererChartSpec } from '../../agent/chart-spec-adapter'

export const CHART_ACTION_CLASS = 'inline-flex min-h-9 items-center gap-1.5 rounded-md px-2.5 text-xs font-medium text-ds-muted transition-colors hover:bg-ds-hover hover:text-ds-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ds-focus'
export const CHART_COLORS = [
  'var(--ds-accent)',
  'var(--ds-success)',
  'var(--ds-danger)',
  'var(--ds-warning, #c58b20)',
  'var(--ds-text-muted)'
]
const COLOR_BY_NAME: Record<string, string> = {
  accent: 'var(--ds-accent)',
  success: 'var(--ds-success)',
  danger: 'var(--ds-danger)',
  warning: 'var(--ds-warning, #c58b20)',
  neutral: 'var(--ds-text-muted)',
  severity: 'var(--ds-danger)'
}

export type DisplayField = RendererChartSeries & { format?: RendererChartFormat; currency?: string }

export function numericChartValue(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null
}

export function formatChartValue(value: unknown, format?: RendererChartFormat, currency = 'USD'): string {
  if (value === null || value === undefined) return '—'
  if (typeof value !== 'number') {
    if (format === 'date' || format === 'datetime') {
      const date = new Date(String(value))
      if (!Number.isNaN(date.getTime())) {
        return new Intl.DateTimeFormat(undefined, format === 'date'
          ? { dateStyle: 'medium' }
          : { dateStyle: 'medium', timeStyle: 'short' }).format(date)
      }
    }
    return String(value)
  }
  if (format === 'percent') return `${new Intl.NumberFormat(undefined, { maximumFractionDigits: 2 }).format(value)}%`
  if (format === 'currency') {
    return new Intl.NumberFormat(undefined, { style: 'currency', currency, maximumFractionDigits: 2 }).format(value)
  }
  if (format === 'integer') return new Intl.NumberFormat(undefined, { maximumFractionDigits: 0 }).format(value)
  return new Intl.NumberFormat(undefined, { maximumFractionDigits: 2 }).format(value)
}

export function chartDisplayColumns(spec: RendererChartSpec): DisplayField[] {
  if (spec.columns?.length) return spec.columns
  const declared = [spec.x, ...spec.series].filter((item): item is RendererChartSeries => Boolean(item))
  if (declared.length) return declared
  return Object.keys(spec.data[0] ?? {}).map((field) => ({ field, label: field }))
}

export function seriesFormat(spec: RendererChartSpec, series: RendererChartSeries): RendererChartFormat | undefined {
  return series.format ?? (spec.y?.field === series.field ? spec.y.format : undefined)
}

export function seriesCurrency(spec: RendererChartSpec, series: RendererChartSeries): string | undefined {
  return series.currency ?? (spec.y?.field === series.field ? spec.y.currency : undefined)
}

export function seriesColor(series: RendererChartSeries, index: number): string {
  if (series.color && COLOR_BY_NAME[series.color]) return COLOR_BY_NAME[series.color]
  return CHART_COLORS[index % CHART_COLORS.length]
}

export function sliceColor(index: number): string {
  return CHART_COLORS[index % CHART_COLORS.length]
}

export function chartPointLabel(category: string, seriesLabel: string, formatted: string, punctuated = false): string {
  return punctuated ? `${category}, ${seriesLabel}: ${formatted}` : `${category}: ${seriesLabel} ${formatted}`
}

export function slugChartTitle(title: string): string {
  return title.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 60) || 'chart'
}
