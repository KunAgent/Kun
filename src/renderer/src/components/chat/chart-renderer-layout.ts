import type { RendererChartSeries, RendererChartSpec } from '../../agent/chart-spec-adapter'
import {
  formatChartValue,
  numericChartValue,
  seriesColor,
  seriesCurrency,
  seriesFormat,
  sliceColor
} from './chart-renderer-format'

export const CHART_DEFAULT_WIDTH = 720
export const CHART_DEFAULT_HEIGHT = 320
export const HORIZONTAL_BAR_MIN_CATEGORY_COUNT = 8
export const HORIZONTAL_BAR_MIN_LABEL_LENGTH = 14

export type ChartPadding = { top: number; right: number; bottom: number; left: number }
export type ChartStackColumn = { key: string; seriesIndexes: number[] }
export type ChartLegendItem = { field: string; label: string; color: string }
export type ChartTooltipItem = { label: string; value: string; color: string }
export type ChartBarGeom = {
  x: number
  y: number
  width: number
  height: number
  color: string
  category: string
  seriesLabel: string
  formatted: string
  rowIndex: number
  seriesIndex: number
}
export type ChartLineGeom = {
  color: string
  seriesLabel: string
  field: string
  area: string
  path: string
  points: Array<{
    x: number
    y: number
    category: string
    formatted: string
    rowIndex: number
  }>
}
export type ChartCategoryBand = {
  x: number
  y: number
  width: number
  height: number
  category: string
  label: string
  truncated: string
  rowIndex: number
  items: ChartTooltipItem[]
}
export type ChartAxisTick = { value: number; label: string; x: number; y: number }

export function shouldUseHorizontalBar(spec: RendererChartSpec): boolean {
  if (spec.type !== 'bar') return false
  const field = spec.x?.field
  if (!field) return false
  const labels = spec.data.map((row) => String(row[field] ?? ''))
  if (labels.length >= HORIZONTAL_BAR_MIN_CATEGORY_COUNT) return true
  return labels.some((label) => label.length >= HORIZONTAL_BAR_MIN_LABEL_LENGTH)
}

export function usesStackedBars(spec: RendererChartSpec): boolean {
  if (spec.type !== 'bar' || !spec.series.some((series) => series.stack)) return false
  return spec.series.every((series) => spec.data.every((row) => {
    const value = numericChartValue(row[series.field])
    return value === null || value >= 0
  }))
}

export function barColumns(spec: RendererChartSpec, stacked: boolean): ChartStackColumn[] {
  if (!stacked) {
    return spec.series.map((series, index) => ({ key: series.field, seriesIndexes: [index] }))
  }
  const columns: ChartStackColumn[] = []
  const indexByKey = new Map<string, number>()
  spec.series.forEach((series, index) => {
    const key = series.stack?.trim() || `__solo_${series.field}`
    const existing = indexByKey.get(key)
    if (existing === undefined) {
      indexByKey.set(key, columns.length)
      columns.push({ key, seriesIndexes: [index] })
      return
    }
    columns[existing]!.seriesIndexes.push(index)
  })
  return columns
}

export function chartLegendItems(spec: RendererChartSpec): ChartLegendItem[] {
  if (spec.type === 'pie' || spec.type === 'donut') {
    const categoryField = spec.x?.field
    if (!categoryField) return []
    return spec.data.map((row, index) => ({
      field: `${categoryField}-${index}`,
      label: String(row[categoryField] ?? index + 1),
      color: sliceColor(index)
    }))
  }
  if (spec.series.length <= 1) return []
  return spec.series.map((series, index) => ({
    field: series.field,
    label: series.label ?? series.field,
    color: seriesColor(series, index)
  }))
}

export function ellipsizeLabel(label: string, maxChars: number): string {
  const text = label.trim()
  if (text.length <= maxChars) return text
  return `${text.slice(0, Math.max(1, maxChars - 1))}…`
}

export function shouldRotateCategoryLabels(input: {
  horizontal: boolean
  labels: string[]
  plotWidth: number
}): boolean {
  if (input.horizontal || input.labels.length === 0) return false
  const slot = input.plotWidth / input.labels.length
  const longest = Math.max(...input.labels.map((label) => label.length))
  return longest * 7.2 > slot
}

export function chartPadding(input: { horizontal: boolean; rotateLabels: boolean }): ChartPadding {
  return {
    top: 16,
    right: 16,
    bottom: input.horizontal ? 28 : input.rotateLabels ? 76 : 48,
    left: input.horizontal ? 112 : 56
  }
}

export function chartPlotHeight(spec: RendererChartSpec, horizontal: boolean): number {
  if (!horizontal) return CHART_DEFAULT_HEIGHT
  return Math.max(CHART_DEFAULT_HEIGHT, spec.data.length * 28 + 48)
}

function valueDomain(
  spec: RendererChartSpec,
  stacked: boolean,
  columns: ChartStackColumn[]
): { min: number; max: number } {
  if (stacked) {
    const totals = spec.data.flatMap((row) => columns.map((column) => column.seriesIndexes.reduce((sum, index) => {
      const series = spec.series[index]
      return sum + Math.max(0, numericChartValue(row[series!.field]) ?? 0)
    }, 0)))
    return { min: 0, max: Math.max(1, ...totals) }
  }
  const values = spec.series.flatMap((series) => spec.data
    .map((row) => numericChartValue(row[series.field]))
    .filter((value): value is number => value !== null))
  return { min: Math.min(0, ...values), max: Math.max(1, ...values) }
}

function tooltipItems(spec: RendererChartSpec, rowIndex: number): ChartTooltipItem[] {
  return spec.series.flatMap((series, seriesIndex) => {
    const value = numericChartValue(spec.data[rowIndex]?.[series.field])
    if (value === null) return []
    return [{
      label: series.label ?? series.field,
      value: formatChartValue(value, seriesFormat(spec, series), seriesCurrency(spec, series)),
      color: seriesColor(series, seriesIndex)
    }]
  })
}

function categoryLabels(spec: RendererChartSpec): string[] {
  const field = spec.x?.field ?? Object.keys(spec.data[0] ?? {})[0]
  return spec.data.map((row, index) => String(row[field] ?? index + 1))
}

export function buildCartesianLayout(spec: RendererChartSpec, width: number): {
  width: number
  height: number
  horizontal: boolean
  stacked: boolean
  pad: ChartPadding
  rotateLabels: boolean
  bars: ChartBarGeom[]
  lines: ChartLineGeom[]
  bands: ChartCategoryBand[]
  ticks: ChartAxisTick[]
  categoryLabels: Array<{ x: number; y: number; text: string; full: string; rotate: boolean }>
} {
  const horizontal = shouldUseHorizontalBar(spec)
  const stacked = usesStackedBars(spec)
  const columns = barColumns(spec, stacked)
  const labels = categoryLabels(spec)
  const height = chartPlotHeight(spec, horizontal)
  const probePad = chartPadding({ horizontal, rotateLabels: false })
  const probePlotW = width - probePad.left - probePad.right
  const rotateLabels = shouldRotateCategoryLabels({ horizontal, labels, plotWidth: probePlotW })
  const pad = chartPadding({ horizontal, rotateLabels })
  const plotW = width - pad.left - pad.right
  const plotH = height - pad.top - pad.bottom
  const { min, max } = valueDomain(spec, stacked, columns)
  const scale = (value: number): number => (value - min) / (max - min || 1)
  const valueY = (value: number): number => pad.top + (1 - scale(value)) * plotH
  const valueX = (value: number): number => pad.left + scale(value) * plotW
  const maxChars = horizontal ? 16 : rotateLabels ? 18 : Math.max(4, Math.min(16, Math.floor((plotW / Math.max(labels.length, 1)) / 7)))
  const ticks = [0, 0.5, 1].map((step) => {
    const value = max - (max - min) * step
    return {
      value,
      label: formatChartValue(value, spec.y?.format),
      x: horizontal ? valueX(value) : pad.left,
      y: horizontal ? height - pad.bottom : pad.top + plotH * step
    }
  })
  const bars: ChartBarGeom[] = []
  const bands: ChartCategoryBand[] = labels.map((category, rowIndex) => {
    const items = tooltipItems(spec, rowIndex)
    if (horizontal) {
      return {
        x: pad.left,
        y: pad.top + (rowIndex / labels.length) * plotH,
        width: plotW,
        height: plotH / labels.length,
        category,
        label: category,
        truncated: ellipsizeLabel(category, maxChars),
        rowIndex,
        items
      }
    }
    const band = plotW / labels.length
    return {
      x: pad.left + rowIndex * band,
      y: pad.top,
      width: band,
      height: plotH,
      category,
      label: category,
      truncated: ellipsizeLabel(category, maxChars),
      rowIndex,
      items
    }
  })

  if (spec.type === 'bar') {
    const groupCount = Math.max(columns.length, 1)
    labels.forEach((category, rowIndex) => {
      const row = spec.data[rowIndex] ?? {}
      if (horizontal) {
        const band = plotH / labels.length
        const inner = band * 0.72
        const barH = inner / groupCount
        const bandStart = pad.top + rowIndex * band + (band - inner) / 2
        columns.forEach((column, columnIndex) => {
          let acc = 0
          column.seriesIndexes.forEach((seriesIndex) => {
            const series = spec.series[seriesIndex]!
            const value = numericChartValue(row[series.field])
            if (value === null) return
            const start = stacked ? acc : 0
            const end = stacked ? acc + value : value
            const x0 = valueX(start)
            const x1 = valueX(end)
            bars.push({
              x: Math.min(x0, x1),
              y: bandStart + columnIndex * barH,
              width: Math.abs(x1 - x0),
              height: Math.max(barH - 1, 2),
              color: seriesColor(series, seriesIndex),
              category,
              seriesLabel: series.label ?? series.field,
              formatted: formatChartValue(value, seriesFormat(spec, series), seriesCurrency(spec, series)),
              rowIndex,
              seriesIndex
            })
            if (stacked) acc += value
          })
        })
        return
      }
      const band = plotW / labels.length
      const inner = band * 0.72
      const barW = inner / groupCount
      const bandStart = pad.left + rowIndex * band + (band - inner) / 2
      const zero = valueY(0)
      columns.forEach((column, columnIndex) => {
        let acc = 0
        column.seriesIndexes.forEach((seriesIndex) => {
          const series = spec.series[seriesIndex]!
          const value = numericChartValue(row[series.field])
          if (value === null) return
          const start = stacked ? acc : 0
          const end = stacked ? acc + value : value
          const y0 = stacked ? valueY(start) : zero
          const y1 = valueY(end)
          bars.push({
            x: bandStart + columnIndex * barW,
            y: Math.min(y0, y1),
            width: Math.max(barW - 1, 2),
            height: Math.abs(y1 - y0),
            color: seriesColor(series, seriesIndex),
            category,
            seriesLabel: series.label ?? series.field,
            formatted: formatChartValue(value, seriesFormat(spec, series), seriesCurrency(spec, series)),
            rowIndex,
            seriesIndex
          })
          if (stacked) acc += value
        })
      })
    })
  }

  const lines: ChartLineGeom[] = spec.type === 'bar' ? [] : spec.series.map((series, seriesIndex) => {
    const color = seriesColor(series, seriesIndex)
    const points = spec.data.flatMap((row, rowIndex) => {
      const value = numericChartValue(row[series.field])
      if (value === null) return []
      const x = labels.length === 1 ? pad.left + plotW / 2 : pad.left + rowIndex * plotW / Math.max(labels.length - 1, 1)
      return [{
        x,
        y: valueY(value),
        category: labels[rowIndex]!,
        formatted: formatChartValue(value, seriesFormat(spec, series), seriesCurrency(spec, series)),
        rowIndex
      }]
    })
    const path = points.map((point, index) => `${index ? 'L' : 'M'}${point.x},${point.y}`).join(' ')
    const area = points.length
      ? `${path} L${points.at(-1)?.x},${valueY(0)} L${points[0]?.x},${valueY(0)} Z`
      : ''
    return { color, seriesLabel: series.label ?? series.field, field: series.field, path, area, points }
  })

  const categoryLabelNodes = bands.map((band) => horizontal
    ? { x: pad.left - 8, y: band.y + band.height / 2 + 4, text: band.truncated, full: band.category, rotate: false }
    : { x: band.x + band.width / 2, y: height - (rotateLabels ? 28 : 22), text: band.truncated, full: band.category, rotate: rotateLabels })

  return {
    width,
    height,
    horizontal,
    stacked,
    pad,
    rotateLabels,
    bars,
    lines,
    bands,
    ticks,
    categoryLabels: categoryLabelNodes
  }
}

export function pieSliceItems(spec: RendererChartSpec): Array<{
  category: string
  value: number
  formatted: string
  color: string
  fraction: number
}> {
  const field = spec.series[0] as RendererChartSeries | undefined
  const categoryField = spec.x?.field
  if (!field || !categoryField) return []
  const values = spec.data.map((row) => Math.max(0, numericChartValue(row[field.field]) ?? 0))
  const total = values.reduce((sum, value) => sum + value, 0) || 1
  return values.map((value, index) => ({
    category: String(spec.data[index]?.[categoryField] ?? index + 1),
    value,
    formatted: formatChartValue(value, seriesFormat(spec, field), seriesCurrency(spec, field)),
    color: sliceColor(index),
    fraction: value / total
  }))
}
