import { useEffect, useMemo, useRef, useState, type ReactElement, type RefObject } from 'react'
import { Download, Expand, Table2, X } from 'lucide-react'
import { chartSpecToCsv } from '@kun/extension-api'
import type { RendererChartSpec } from '../../agent/chart-spec-adapter'
import {
  CHART_ACTION_CLASS,
  chartDisplayColumns,
  formatChartValue,
  slugChartTitle
} from './chart-renderer-format'
import {
  CHART_DEFAULT_WIDTH,
  chartLegendItems,
  shouldUseHorizontalBar,
  usesStackedBars
} from './chart-renderer-layout'
import { ChartSvg } from './chart-renderer-plot'
import { ChartLegend } from './chart-renderer-tooltip'

export function chartCsv(spec: RendererChartSpec): string {
  return chartSpecToCsv(spec)
}

export function ChartSkeleton({ title }: { title?: string }): ReactElement {
  return (
    <figure
      data-chart-skeleton
      aria-busy="true"
      aria-label={title?.trim() || 'Preparing chart'}
      className="my-3 min-w-0 rounded-xl border border-ds-border bg-ds-surface-card p-4"
    >
      <div className="h-4 w-40 max-w-full rounded bg-ds-subtle" />
      <div className="mt-2 h-3 w-64 max-w-full rounded bg-ds-subtle/80" />
      <div className="mt-3 h-52 rounded-lg bg-ds-subtle/70" />
    </figure>
  )
}

function useChartWidth(ref: RefObject<HTMLElement | null>): number {
  const [width, setWidth] = useState(CHART_DEFAULT_WIDTH)
  useEffect(() => {
    const node = ref.current
    if (!node || typeof ResizeObserver === 'undefined') return
    const observer = new ResizeObserver((entries) => {
      const next = Math.round(entries[0]?.contentRect.width ?? 0)
      if (next >= 280) setWidth(next)
    })
    observer.observe(node)
    return () => observer.disconnect()
  }, [ref])
  return width
}

function DataTable({ spec }: { spec: RendererChartSpec }): ReactElement {
  const fields = chartDisplayColumns(spec)
  return (
    <div className="max-h-72 overflow-auto rounded-lg border border-ds-border-muted">
      <table className="w-full border-collapse text-left text-xs">
        <caption className="sr-only">Data for {spec.title}</caption>
        <thead className="sticky top-0 bg-ds-surface-elevated text-ds-muted">
          <tr>{fields.map((item) => <th key={item.field} scope="col" className="border-b border-ds-border-muted px-3 py-2 font-medium">{item.label ?? item.field}</th>)}</tr>
        </thead>
        <tbody>{spec.data.map((row, index) => (
          <tr key={index} className="border-b border-ds-border-muted last:border-0">
            {fields.map((item) => (
              <td key={item.field} className="whitespace-nowrap px-3 py-2 tabular-nums text-ds-ink">
                {formatChartValue(row[item.field], item.format, item.currency)}
              </td>
            ))}
          </tr>
        ))}</tbody>
      </table>
    </div>
  )
}

function downloadBlob(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob)
  const anchor = document.createElement('a')
  anchor.href = url
  anchor.download = filename
  anchor.click()
  URL.revokeObjectURL(url)
}

function exportChartPng(source: SVGSVGElement, filename: string): void {
  const clone = source.cloneNode(true) as SVGSVGElement
  const sourceNodes = [source, ...source.querySelectorAll('*')]
  const cloneNodes = [clone, ...clone.querySelectorAll('*')]
  sourceNodes.forEach((node, index) => {
    const style = getComputedStyle(node)
    cloneNodes[index]?.setAttribute('style', `fill:${style.fill};stroke:${style.stroke};font:${style.font};opacity:${style.opacity}`)
  })
  const box = source.viewBox.baseVal
  const width = box.width || CHART_DEFAULT_WIDTH
  const height = box.height || CHART_DEFAULT_WIDTH * 0.44
  const blob = new Blob([new XMLSerializer().serializeToString(clone)], { type: 'image/svg+xml' })
  const image = new Image()
  const objectUrl = URL.createObjectURL(blob)
  image.onload = () => {
    const canvas = document.createElement('canvas')
    canvas.width = width * 2
    canvas.height = height * 2
    const context = canvas.getContext('2d')
    if (!context) { URL.revokeObjectURL(objectUrl); return }
    context.scale(2, 2)
    context.drawImage(image, 0, 0, width, height)
    canvas.toBlob((png) => {
      URL.revokeObjectURL(objectUrl)
      if (png) downloadBlob(png, filename)
    }, 'image/png')
  }
  image.onerror = () => URL.revokeObjectURL(objectUrl)
  image.src = objectUrl
}

export function ChartRenderer({ spec }: { spec: RendererChartSpec }): ReactElement {
  const [table, setTable] = useState(spec.type === 'table')
  const [expanded, setExpanded] = useState(false)
  const frameRef = useRef<HTMLDivElement>(null)
  const svgRef = useRef<SVGSVGElement>(null)
  const expandButtonRef = useRef<HTMLButtonElement>(null)
  const width = useChartWidth(frameRef)
  const legend = useMemo(() => chartLegendItems(spec), [spec])
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
  const graphic = spec.type === 'metric' ? (
    <div className="py-8 text-center text-4xl font-semibold tabular-nums text-ds-ink">
      {formatChartValue(
        spec.data[0]?.[spec.series[0]?.field ?? spec.y?.field ?? 'value'],
        spec.series[0]?.format ?? spec.y?.format,
        spec.series[0]?.currency ?? spec.y?.currency
      )}
    </div>
  ) : <ChartSvg spec={spec} width={width} svgRef={svgRef} />
  const body = table ? <DataTable spec={spec} /> : graphic
  return (
    <figure
      data-chart-renderer
      data-chart-type={spec.type}
      data-chart-orientation={shouldUseHorizontalBar(spec) ? 'horizontal' : 'vertical'}
      data-chart-stacked={usesStackedBars(spec) ? 'true' : 'false'}
      className="my-3 min-w-0 rounded-xl border border-ds-border bg-ds-surface-card p-4 text-ds-ink"
    >
      <figcaption>
        <h3 className="text-sm font-semibold">{spec.title}</h3>
        {spec.description ? <p className="mt-1 text-xs text-ds-muted">{spec.description}</p> : null}
      </figcaption>
      <div ref={frameRef} className="mt-3 min-w-0">{body}</div>
      {!table ? <ChartLegend items={legend} /> : null}
      <div className="mt-3 flex flex-wrap justify-end gap-1">
        {spec.type !== 'metric' ? (
          <button type="button" aria-label={table ? 'Show chart' : 'Show data table'} aria-pressed={table} onClick={() => setTable((value) => !value)} className={CHART_ACTION_CLASS}>
            <Table2 className="h-3.5 w-3.5" />{table ? 'Chart' : 'Data table'}
          </button>
        ) : null}
        {can('download-csv') ? (
          <button type="button" aria-label="Download CSV" onClick={() => downloadBlob(new Blob([chartCsv(spec)], { type: 'text/csv;charset=utf-8' }), `${slugChartTitle(spec.title)}.csv`)} className={CHART_ACTION_CLASS}>
            <Download className="h-3.5 w-3.5" />CSV
          </button>
        ) : null}
        {can('download-png') && spec.type !== 'table' && spec.type !== 'metric' ? (
          <button type="button" aria-label="Download PNG" onClick={() => { if (svgRef.current) exportChartPng(svgRef.current, `${slugChartTitle(spec.title)}.png`) }} className={CHART_ACTION_CLASS}>
            <Download className="h-3.5 w-3.5" />PNG
          </button>
        ) : null}
        {can('expand') ? (
          <button ref={expandButtonRef} type="button" onClick={() => setExpanded(true)} className={CHART_ACTION_CLASS}>
            <Expand className="h-3.5 w-3.5" />Expand
          </button>
        ) : null}
      </div>
      {expanded ? (
        <div role="dialog" aria-modal="true" aria-label={spec.title} className="fixed inset-0 z-50 grid place-items-center bg-black/50 p-4" onClick={() => setExpanded(false)}>
          <div className="max-h-[90vh] w-full max-w-5xl overflow-auto rounded-2xl border border-ds-border bg-ds-surface-card p-5 shadow-xl" onClick={(event) => event.stopPropagation()}>
            <button type="button" autoFocus aria-label="Close expanded chart" onClick={() => setExpanded(false)} className={`${CHART_ACTION_CLASS} ml-auto`}>
              <X className="h-4 w-4" />Close
            </button>
            <div className="mt-3"><ChartSvg spec={spec} width={Math.max(width, 720)} /></div>
            <ChartLegend items={legend} />
            <div className="mt-4"><DataTable spec={spec} /></div>
          </div>
        </div>
      ) : null}
    </figure>
  )
}
