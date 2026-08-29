import { useEffect, useId, useMemo, useRef, useState, type ReactElement } from 'react'
import { Download, Expand, Table2, X } from 'lucide-react'
import { chartSpecToCsv } from '@kun/extension-api'
import type { RendererChartFormat, RendererChartSeries, RendererChartSpec } from '../../agent/chart-spec-adapter'

const WIDTH = 720
const HEIGHT = 320
const ACTION_CLASS = 'inline-flex min-h-9 items-center gap-1.5 rounded-md px-2.5 text-xs font-medium text-ds-muted transition-colors hover:bg-ds-hover hover:text-ds-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ds-focus'
const PAD = { top: 20, right: 20, bottom: 52, left: 56 }
const COLORS = ['var(--ds-accent)', 'var(--ds-success)', 'var(--ds-danger)', 'var(--ds-warning, #c58b20)', 'var(--ds-text-muted)']
const COLOR_BY_NAME: Record<string, string> = {
  accent: 'var(--ds-accent)', success: 'var(--ds-success)', danger: 'var(--ds-danger)',
  warning: 'var(--ds-warning, #c58b20)', neutral: 'var(--ds-text-muted)', severity: 'var(--ds-danger)'
}

function number(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null
}

function format(value: unknown, format?: RendererChartFormat, currency = 'USD'): string {
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
  if (format === 'currency') return new Intl.NumberFormat(undefined, { style: 'currency', currency, maximumFractionDigits: 2 }).format(value)
  if (format === 'integer') return new Intl.NumberFormat(undefined, { maximumFractionDigits: 0 }).format(value)
  return new Intl.NumberFormat(undefined, { maximumFractionDigits: 2 }).format(value)
}

type DisplayField = RendererChartSeries & { format?: RendererChartFormat; currency?: string }

function columns(spec: RendererChartSpec): DisplayField[] {
  if (spec.columns?.length) return spec.columns
  const declared = [spec.x, ...spec.series].filter((item): item is RendererChartSeries => Boolean(item))
  if (declared.length) return declared
  return Object.keys(spec.data[0] ?? {}).map((field) => ({ field, label: field }))
}

function seriesFormat(spec: RendererChartSpec, series: RendererChartSeries): RendererChartFormat | undefined {
  return series.format ?? (spec.y?.field === series.field ? spec.y.format : undefined)
}

function seriesCurrency(spec: RendererChartSpec, series: RendererChartSeries): string | undefined {
  return series.currency ?? (spec.y?.field === series.field ? spec.y.currency : undefined)
}

export function chartCsv(spec: RendererChartSpec): string {
  return chartSpecToCsv(spec)
}

function downloadBlob(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob)
  const anchor = document.createElement('a')
  anchor.href = url
  anchor.download = filename
  anchor.click()
  URL.revokeObjectURL(url)
}

function slug(title: string): string {
  return title.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 60) || 'chart'
}

function DataTable({ spec }: { spec: RendererChartSpec }): ReactElement {
  const fields = columns(spec)
  return (
    <div className="max-h-72 overflow-auto rounded-lg border border-ds-border-muted">
      <table className="w-full border-collapse text-left text-xs">
        <caption className="sr-only">Data for {spec.title}</caption>
        <thead className="sticky top-0 bg-ds-surface-elevated text-ds-muted">
          <tr>{fields.map((item) => <th key={item.field} scope="col" className="border-b border-ds-border-muted px-3 py-2 font-medium">{item.label ?? item.field}</th>)}</tr>
        </thead>
        <tbody>{spec.data.map((row, index) => (
          <tr key={index} className="border-b border-ds-border-muted last:border-0">
            {fields.map((item) => <td key={item.field} className="whitespace-nowrap px-3 py-2 tabular-nums text-ds-ink">{format(row[item.field], item.format, item.currency)}</td>)}
          </tr>
        ))}</tbody>
      </table>
    </div>
  )
}

function CartesianChart({ spec }: { spec: RendererChartSpec }): ReactElement {
  const xField = spec.x?.field ?? Object.keys(spec.data[0] ?? {})[0]
  const values = spec.series.flatMap((series) => spec.data.map((row) => number(row[series.field])).filter((v): v is number => v !== null))
  const min = Math.min(0, ...values)
  const max = Math.max(1, ...values)
  const plotW = WIDTH - PAD.left - PAD.right
  const plotH = HEIGHT - PAD.top - PAD.bottom
  const y = (value: number): number => PAD.top + ((max - value) / (max - min || 1)) * plotH
  const x = (index: number): number => spec.type === 'bar'
    ? PAD.left + ((index + 0.5) / spec.data.length) * plotW
    : PAD.left + (spec.data.length === 1 ? plotW / 2 : index * plotW / (spec.data.length - 1))
  const barWidth = Math.max(3, plotW / Math.max(spec.data.length * Math.max(spec.series.length, 1), 1) * 0.68)
  return (
    <>
      {[0, 0.5, 1].map((step) => {
        const value = max - (max - min) * step
        const py = PAD.top + plotH * step
        return <g key={step}><line x1={PAD.left} x2={WIDTH - PAD.right} y1={py} y2={py} stroke="var(--ds-border-muted)" /><text x={PAD.left - 10} y={py + 4} textAnchor="end" fill="var(--ds-text-muted)" fontSize="11">{format(value, spec.y?.format)}</text></g>
      })}
      {spec.series.map((series, seriesIndex) => {
        const points = spec.data.map((row, rowIndex) => {
          const value = number(row[series.field])
          return value === null ? null : { x: x(rowIndex), y: y(value), value, rowIndex }
        })
        const present = points.filter((point): point is NonNullable<typeof point> => point !== null)
        const color = series.color ? COLOR_BY_NAME[series.color] : COLORS[seriesIndex % COLORS.length]
        if (spec.type === 'bar') return <g key={series.field}>{present.map((point) => <rect key={point.rowIndex} x={point.x - (spec.series.length * barWidth) / 2 + seriesIndex * barWidth} y={Math.min(point.y, y(0))} width={barWidth - 1} height={Math.abs(y(0) - point.y)} rx="2" fill={color}><title>{`${spec.data[point.rowIndex]?.[xField] ?? point.rowIndex + 1}: ${series.label ?? series.field} ${format(point.value, seriesFormat(spec, series), seriesCurrency(spec, series))}`}</title></rect>)}</g>
        const segments: NonNullable<(typeof points)[number]>[][] = []
        for (const point of points) {
          if (!point) continue
          const previous = points[point.rowIndex - 1]
          if (!previous) segments.push([])
          segments.at(-1)!.push(point)
        }
        return <g key={series.field}>{segments.map((segment, segmentIndex) => {
          const path = segment.map((point, index) => `${index ? 'L' : 'M'}${point.x},${point.y}`).join(' ')
          const area = segment.length ? `${path} L${segment.at(-1)?.x},${y(0)} L${segment[0].x},${y(0)} Z` : ''
          return <g key={segmentIndex}>{spec.type === 'area' ? <path d={area} fill={color} opacity="0.16" /> : null}<path d={path} fill="none" stroke={color} strokeWidth="2.5" strokeLinejoin="round" strokeLinecap="round" />{segment.map((point) => <circle key={point.rowIndex} cx={point.x} cy={point.y} r="3.5" fill="var(--ds-surface-card)" stroke={color} strokeWidth="2"><title>{`${spec.data[point.rowIndex]?.[xField] ?? point.rowIndex + 1}, ${series.label ?? series.field}: ${format(point.value, seriesFormat(spec, series), seriesCurrency(spec, series))}`}</title></circle>)}</g>
        })}</g>
      })}
      {spec.data.map((row, index) => <text key={index} x={x(index)} y={HEIGHT - 22} textAnchor="middle" fill="var(--ds-text-muted)" fontSize="11">{String(row[xField] ?? '').slice(0, 12)}</text>)}
    </>
  )
}

function RadialChart({ spec }: { spec: RendererChartSpec }): ReactElement {
  const field = spec.series[0]
  const values = spec.data.map((row) => Math.max(0, number(row[field.field]) ?? 0))
  const total = values.reduce((sum, value) => sum + value, 0) || 1
  let offset = 0
  const radius = 92
  const circumference = 2 * Math.PI * radius
  return <g transform={`rotate(-90 ${WIDTH / 2} ${HEIGHT / 2})`}>{values.map((value, index) => {
    const length = value / total * circumference
    const node = <circle key={index} cx={WIDTH / 2} cy={HEIGHT / 2} r={radius} fill="none" stroke={COLORS[index % COLORS.length]} strokeWidth={spec.type === 'donut' ? 42 : 92} strokeDasharray={`${length} ${circumference - length}`} strokeDashoffset={-offset}><title>{`${spec.data[index]?.[spec.x?.field ?? 'label'] ?? index + 1}: ${format(value, seriesFormat(spec, field), seriesCurrency(spec, field))}`}</title></circle>
    offset += length
    return node
  })}</g>
}

function ChartSvg({ spec, svgRef }: { spec: RendererChartSpec; svgRef?: React.RefObject<SVGSVGElement | null> }): ReactElement {
  const titleId = useId()
  const descId = useId()
  return (
    <svg ref={svgRef} viewBox={`0 0 ${WIDTH} ${HEIGHT}`} className="block h-auto w-full" role="img" aria-labelledby={`${titleId} ${descId}`}>
      <title id={titleId}>{spec.title}</title><desc id={descId}>{spec.description ?? `${spec.type} chart with ${spec.data.length} data rows.`}</desc>
      {spec.type === 'pie' || spec.type === 'donut' ? <RadialChart spec={spec} /> : <CartesianChart spec={spec} />}
    </svg>
  )
}

export function ChartRenderer({ spec }: { spec: RendererChartSpec }): ReactElement {
  const [table, setTable] = useState(spec.type === 'table')
  const [expanded, setExpanded] = useState(false)
  const svgRef = useRef<SVGSVGElement>(null)
  const expandButtonRef = useRef<HTMLButtonElement>(null)
  useEffect(() => {
    if (!expanded) return
    const close = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') setExpanded(false)
    }
    window.addEventListener('keydown', close)
    return () => window.removeEventListener('keydown', close)
  }, [expanded])
  useEffect(() => {
    if (!expanded) expandButtonRef.current?.focus()
  }, [expanded])
  const can = (action: string): boolean => spec.actions.includes(action as never)
  const exportPng = (): void => {
    const source = svgRef.current
    if (!source) return
    const clone = source.cloneNode(true) as SVGSVGElement
    const sourceNodes = [source, ...source.querySelectorAll('*')]
    const cloneNodes = [clone, ...clone.querySelectorAll('*')]
    sourceNodes.forEach((node, index) => {
      const style = getComputedStyle(node)
      cloneNodes[index]?.setAttribute('style', `fill:${style.fill};stroke:${style.stroke};font:${style.font};opacity:${style.opacity}`)
    })
    const blob = new Blob([new XMLSerializer().serializeToString(clone)], { type: 'image/svg+xml' })
    const image = new Image()
    const objectUrl = URL.createObjectURL(blob)
    image.onload = () => {
      const canvas = document.createElement('canvas')
      canvas.width = WIDTH * 2; canvas.height = HEIGHT * 2
      const context = canvas.getContext('2d')
      if (!context) { URL.revokeObjectURL(objectUrl); return }
      context.scale(2, 2); context.drawImage(image, 0, 0, WIDTH, HEIGHT)
      canvas.toBlob((png) => {
        URL.revokeObjectURL(objectUrl)
        if (png) downloadBlob(png, `${slug(spec.title)}.png`)
      }, 'image/png')
    }
    image.onerror = () => URL.revokeObjectURL(objectUrl)
    image.src = objectUrl
  }
  const body = useMemo(() => table ? <DataTable spec={spec} /> : spec.type === 'metric' ? (
    <div className="py-8 text-center text-4xl font-semibold tabular-nums text-ds-ink">{format(spec.data[0]?.[spec.series[0]?.field ?? spec.y?.field ?? 'value'], spec.series[0]?.format ?? spec.y?.format, spec.series[0]?.currency ?? spec.y?.currency)}</div>
  ) : <ChartSvg spec={spec} svgRef={svgRef} />, [spec, table])
  return (
    <figure className="my-3 min-w-0 rounded-xl border border-ds-border bg-ds-surface-card p-4 text-ds-ink">
      <figcaption><h3 className="text-sm font-semibold">{spec.title}</h3>{spec.description ? <p className="mt-1 text-xs text-ds-muted">{spec.description}</p> : null}</figcaption>
      <div className="mt-3 min-w-0">{body}</div>
      <div className="mt-3 flex flex-wrap justify-end gap-1">
        {spec.type !== 'metric' ? <button type="button" aria-label={table ? 'Show chart' : 'Show data table'} aria-pressed={table} onClick={() => setTable((value) => !value)} className={ACTION_CLASS}><Table2 className="h-3.5 w-3.5" />{table ? 'Chart' : 'Data table'}</button> : null}
        {can('download-csv') ? <button type="button" aria-label="Download CSV" onClick={() => downloadBlob(new Blob([chartCsv(spec)], { type: 'text/csv;charset=utf-8' }), `${slug(spec.title)}.csv`)} className={ACTION_CLASS}><Download className="h-3.5 w-3.5" />CSV</button> : null}
        {can('download-png') && spec.type !== 'table' && spec.type !== 'metric' ? <button type="button" aria-label="Download PNG" onClick={exportPng} className={ACTION_CLASS}><Download className="h-3.5 w-3.5" />PNG</button> : null}
        {can('expand') ? <button ref={expandButtonRef} type="button" onClick={() => setExpanded(true)} className={ACTION_CLASS}><Expand className="h-3.5 w-3.5" />Expand</button> : null}
      </div>
      {expanded ? <div role="dialog" aria-modal="true" aria-label={spec.title} className="fixed inset-0 z-50 grid place-items-center bg-black/50 p-4" onClick={() => setExpanded(false)}><div className="max-h-[90vh] w-full max-w-5xl overflow-auto rounded-2xl border border-ds-border bg-ds-surface-card p-5 shadow-xl" onClick={(event) => event.stopPropagation()}><button type="button" autoFocus aria-label="Close expanded chart" onClick={() => setExpanded(false)} className={`${ACTION_CLASS} ml-auto`}><X className="h-4 w-4" />Close</button><div className="mt-3"><ChartSvg spec={spec} /></div><div className="mt-4"><DataTable spec={spec} /></div></div></div> : null}
    </figure>
  )
}
