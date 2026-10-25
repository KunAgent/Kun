import { asNumber, asRecord, asString, resolveTokenColor, splitColorAlpha, stripRichText, type PptdRect } from './pptd-deck.js'
import { round } from './pptd-preview-geometry.js'
import { escapeXml, fontFamilyCss } from './pptd-preview-text.js'

/**
 * Lightweight chart drawing for review previews. It covers the series types
 * decks use most (bar, line, area, pie); other types render a labelled frame
 * so the reviewer still sees where the native chart will sit.
 */

const FALLBACK_SERIES_COLORS = ['#3B6FD8', '#F2A541', '#2E9B5F', '#D64545', '#7B61FF', '#14A3B8']
const LABEL_COLOR = '#5F6672'
const GRID_COLOR = '#E3E6EB'

type Series = {
  type: string
  name: string
  encode: Record<string, unknown>
  fill?: unknown
  lineColor?: unknown
  innerRadius?: number
  startAngle?: number
}

function seriesPalette(colors: Record<string, unknown>): string[] {
  const entries = Object.entries(colors)
    .map(([key, value]) => [key, typeof value === 'string' ? splitColorAlpha(value).color : ''] as const)
    .filter(([, value]) => /^#[0-9A-F]{6}$/i.test(value))
  const preferred = entries.filter(([key]) => /chart|accent|primary|secondary|highlight|brand/i.test(key))
  const usable = (preferred.length >= 2 ? preferred : entries)
    .map(([, value]) => value)
    .filter((value) => !/^#(FFFFFF|000000)$/i.test(value))
  return usable.length >= 2 ? usable : FALLBACK_SERIES_COLORS
}

function firstFillColor(raw: unknown): string | undefined {
  if (typeof raw === 'string') return raw
  const stops = asRecord(raw)?.stops
  return Array.isArray(stops) ? asString(asRecord(stops[0])?.color) : undefined
}

function seriesColor(series: Series, index: number, palette: string[], colors: Record<string, unknown>): string {
  const candidate = firstFillColor(series.fill ?? series.lineColor)
  const resolved = candidate ? splitColorAlpha(resolveTokenColor(candidate, colors) ?? '').color : ''
  return /^#[0-9A-F]{6}$/i.test(resolved) ? resolved : palette[index % palette.length]
}

function numeric(value: unknown): number {
  if (typeof value === 'number' && Number.isFinite(value)) return value
  if (typeof value === 'string') {
    const parsed = Number(value.replace(/[,%\s]/g, ''))
    return Number.isFinite(parsed) ? parsed : 0
  }
  return 0
}

function formatValue(value: number): string {
  const abs = Math.abs(value)
  if (abs >= 1e9) return `${round(value / 1e9)}B`
  if (abs >= 1e6) return `${round(value / 1e6)}M`
  if (abs >= 1e4) return `${round(value / 1e3)}k`
  return String(round(value))
}

function text(x: number, y: number, value: string, options: { size?: number; anchor?: string; color?: string; weight?: number; font: string }): string {
  return `<text x="${round(x)}" y="${round(y)}" font-size="${options.size ?? 11}" font-family="${escapeXml(options.font)}" fill="${options.color ?? LABEL_COLOR}" text-anchor="${options.anchor ?? 'start'}"${options.weight ? ` font-weight="${options.weight}"` : ''}>${escapeXml(value)}</text>`
}

function truncate(value: string, max: number): string {
  return value.length > max ? `${value.slice(0, Math.max(max - 1, 1))}…` : value
}

function chartTitle(element: Record<string, unknown>): string {
  const title = element.title
  return stripRichText(typeof title === 'string' ? title : asRecord(title)?.text)
}

function placeholder(rect: PptdRect, label: string, font: string): string {
  return [
    `<rect x="${round(rect.x)}" y="${round(rect.y)}" width="${round(rect.width)}" height="${round(rect.height)}" rx="8" fill="#F4F6F9" stroke="#D9DDE3" stroke-dasharray="6 4"/>`,
    text(rect.x + rect.width / 2, rect.y + rect.height / 2 + 4, label, { size: 13, anchor: 'middle', font })
  ].join('')
}

function legend(rect: PptdRect, series: Series[], palette: string[], colors: Record<string, unknown>, font: string): string {
  if (series.length < 2) return ''
  const parts: string[] = []
  let x = rect.x
  const y = rect.y + rect.height - 6
  for (const [index, item] of series.entries()) {
    parts.push(`<rect x="${round(x)}" y="${round(y - 8)}" width="10" height="10" rx="2" fill="${seriesColor(item, index, palette, colors)}"/>`)
    parts.push(text(x + 14, y + 1, truncate(item.name, 12), { size: 10, font }))
    x += 24 + Math.min(item.name.length, 12) * 10
  }
  return parts.join('')
}

function renderCartesian(rect: PptdRect, rows: unknown[][], cols: string[], series: Series[], horizontal: boolean, palette: string[], colors: Record<string, unknown>, font: string): string {
  const categoryKey = horizontal ? 'y' : 'x'
  const valueKey = horizontal ? 'x' : 'y'
  const categoryColumn = cols.indexOf(asString(series[0].encode[categoryKey]) ?? '')
  const categories = rows.map((row, index) => categoryColumn >= 0 ? String(row[categoryColumn] ?? '') : String(index + 1))
  const valuesBySeries = series.map((item) => {
    const column = cols.indexOf(asString(item.encode[valueKey]) ?? '')
    return rows.map((row) => column >= 0 ? numeric(row[column]) : 0)
  })
  const all = valuesBySeries.flat()
  const max = Math.max(0, ...all)
  const min = Math.min(0, ...all)
  const span = max - min || 1
  const legendSpace = series.length > 1 ? 18 : 0
  const plot = {
    x: rect.x + (horizontal ? 64 : 40),
    y: rect.y + 8,
    width: rect.width - (horizontal ? 72 : 48),
    height: rect.height - 30 - legendSpace
  }
  if (plot.width <= 8 || plot.height <= 8 || categories.length === 0) return ''
  const parts: string[] = []
  for (let step = 0; step <= 4; step += 1) {
    const value = min + (span * step) / 4
    if (horizontal) {
      const x = plot.x + (plot.width * step) / 4
      parts.push(`<line x1="${round(x)}" y1="${round(plot.y)}" x2="${round(x)}" y2="${round(plot.y + plot.height)}" stroke="${GRID_COLOR}"/>`)
      parts.push(text(x, plot.y + plot.height + 14, formatValue(value), { size: 10, anchor: 'middle', font }))
    } else {
      const y = plot.y + plot.height - (plot.height * step) / 4
      parts.push(`<line x1="${round(plot.x)}" y1="${round(y)}" x2="${round(plot.x + plot.width)}" y2="${round(y)}" stroke="${GRID_COLOR}"/>`)
      parts.push(text(plot.x - 6, y + 3, formatValue(value), { size: 10, anchor: 'end', font }))
    }
  }
  const slot = (horizontal ? plot.height : plot.width) / categories.length
  const bars = series.map((item, index) => ({ item, index })).filter(({ item }) => item.type === 'bar')
  const barWidth = bars.length > 0 ? (slot * 0.64) / bars.length : 0
  const scale = (value: number) => ((value - min) / span) * (horizontal ? plot.width : plot.height)
  const zero = scale(0)
  for (const [position, { item, index }] of bars.entries()) {
    const color = seriesColor(item, index, palette, colors)
    for (const [row, value] of valuesBySeries[index].entries()) {
      const offset = slot * row + slot * 0.18 + barWidth * position
      const length = Math.abs(scale(value) - zero)
      parts.push(horizontal
        ? `<rect x="${round(plot.x + Math.min(scale(value), zero))}" y="${round(plot.y + offset)}" width="${round(length)}" height="${round(barWidth)}" fill="${color}"/>`
        : `<rect x="${round(plot.x + offset)}" y="${round(plot.y + plot.height - Math.max(scale(value), zero))}" width="${round(barWidth)}" height="${round(length)}" fill="${color}"/>`)
    }
  }
  for (const [index, item] of series.entries()) {
    if (item.type !== 'line' && item.type !== 'area') continue
    const color = seriesColor(item, index, palette, colors)
    const points = valuesBySeries[index].map((value, row) => horizontal
      ? [plot.x + scale(value), plot.y + slot * row + slot / 2]
      : [plot.x + slot * row + slot / 2, plot.y + plot.height - scale(value)])
    const pointList = points.map(([x, y]) => `${round(x)},${round(y)}`).join(' ')
    if (item.type === 'area' && points.length > 0 && !horizontal) {
      const base = plot.y + plot.height - zero
      parts.push(`<polygon points="${round(points[0][0])},${round(base)} ${pointList} ${round(points[points.length - 1][0])},${round(base)}" fill="${color}" fill-opacity="0.22"/>`)
    }
    parts.push(`<polyline points="${pointList}" fill="none" stroke="${color}" stroke-width="2.5" stroke-linejoin="round" stroke-linecap="round"/>`)
    for (const [x, y] of points) parts.push(`<circle cx="${round(x)}" cy="${round(y)}" r="3" fill="${color}"/>`)
  }
  for (const [row, category] of categories.entries()) {
    const label = truncate(category, Math.max(Math.floor(slot / 12), 2))
    parts.push(horizontal
      ? text(plot.x - 6, plot.y + slot * row + slot / 2 + 4, label, { size: 10, anchor: 'end', font })
      : text(plot.x + slot * row + slot / 2, plot.y + plot.height + 14, label, { size: 10, anchor: 'middle', font }))
  }
  parts.push(legend(rect, series, palette, colors, font))
  return parts.join('')
}

function renderPie(rect: PptdRect, rows: unknown[][], cols: string[], series: Series, palette: string[], colors: Record<string, unknown>, font: string): string {
  const categoryColumn = cols.indexOf(asString(series.encode.category) ?? '')
  const valueColumn = cols.indexOf(asString(series.encode.value) ?? '')
  const values = rows.map((row) => Math.max(valueColumn >= 0 ? numeric(row[valueColumn]) : 0, 0))
  const total = values.reduce((sum, value) => sum + value, 0)
  if (total <= 0) return ''
  const legendWidth = Math.min(rect.width * 0.38, 180)
  const radius = Math.max(Math.min(rect.width - legendWidth, rect.height) / 2 - 8, 4)
  const cx = rect.x + radius + 8
  const cy = rect.y + rect.height / 2
  const inner = Math.min(Math.max(series.innerRadius ?? 0, 0), 0.95) * radius
  const fills = Array.isArray(series.fill) ? series.fill : undefined
  let angle = ((series.startAngle ?? 0) * Math.PI) / 180
  const parts: string[] = []
  for (const [index, value] of values.entries()) {
    const sweep = (value / total) * Math.PI * 2
    const sliceColor = fills
      ? seriesColor({ ...series, fill: fills[index % fills.length] }, index, palette, colors)
      : palette[index % palette.length]
    const point = (theta: number, r: number) => [cx + Math.sin(theta) * r, cy - Math.cos(theta) * r]
    const [x1, y1] = point(angle, radius)
    const [x2, y2] = point(angle + sweep, radius)
    const large = sweep > Math.PI ? 1 : 0
    if (sweep >= Math.PI * 2 - 1e-6) {
      parts.push(`<circle cx="${round(cx)}" cy="${round(cy)}" r="${round(radius)}" fill="${sliceColor}"/>`)
    } else {
      parts.push(`<path d="M${round(cx)} ${round(cy)} L${round(x1)} ${round(y1)} A${round(radius)} ${round(radius)} 0 ${large} 1 ${round(x2)} ${round(y2)} Z" fill="${sliceColor}" stroke="#FFFFFF" stroke-width="1"/>`)
    }
    const label = categoryColumn >= 0 ? String(rows[index][categoryColumn] ?? '') : String(index + 1)
    const ly = rect.y + 12 + index * 18
    if (ly < rect.y + rect.height) {
      parts.push(`<rect x="${round(rect.x + rect.width - legendWidth)}" y="${round(ly - 9)}" width="10" height="10" rx="2" fill="${sliceColor}"/>`)
      parts.push(text(rect.x + rect.width - legendWidth + 14, ly, `${truncate(label, 10)} ${Math.round((value / total) * 100)}%`, { size: 10, font }))
    }
    angle += sweep
  }
  if (inner > 0) parts.push(`<circle cx="${round(cx)}" cy="${round(cy)}" r="${round(inner)}" fill="#FFFFFF"/>`)
  return parts.join('')
}

export function renderPptdChart(element: Record<string, unknown>, rect: PptdRect, colors: Record<string, unknown>): string {
  const font = fontFamilyCss(element.fontFamily)
  const data = asRecord(element.data)
  const cols = Array.isArray(data?.cols) ? data.cols.map((col) => String(col)) : []
  const rows = Array.isArray(data?.rows) ? data.rows.filter((row): row is unknown[] => Array.isArray(row)) : []
  const series: Series[] = (Array.isArray(element.series) ? element.series : [])
    .map((value) => asRecord(value))
    .filter((value): value is Record<string, unknown> => value !== undefined)
    .map((value) => ({
      type: asString(value.type) ?? 'bar',
      name: asString(value.name) ?? asString(asRecord(value.encode)?.y) ?? '',
      encode: asRecord(value.encode) ?? {},
      fill: value.fill,
      lineColor: value.lineColor,
      innerRadius: asNumber(value.innerRadius),
      startAngle: asNumber(value.startAngle)
    }))
  const title = chartTitle(element)
  const titleSpace = title ? 24 : 0
  const body = { x: rect.x + 4, y: rect.y + titleSpace, width: rect.width - 8, height: rect.height - titleSpace - 4 }
  const palette = seriesPalette(colors)
  const parts: string[] = []
  if (title) parts.push(text(rect.x + 4, rect.y + 16, truncate(title, 40), { size: 13, color: '#1F2328', weight: 600, font }))
  let drawn = ''
  if (series.length > 0 && rows.length > 0 && cols.length > 0) {
    if (series[0].type === 'pie') {
      drawn = renderPie(body, rows, cols, series[0], palette, colors, font)
    } else if (series.every((item) => item.type === 'bar' || item.type === 'line' || item.type === 'area')) {
      const yAxis = asRecord(Array.isArray(element.yAxis) ? element.yAxis[0] : element.yAxis)
      const firstY = cols.indexOf(asString(series[0].encode.y) ?? '')
      const horizontal = asString(yAxis?.type) === 'category' ||
        (firstY >= 0 && rows.some((row) => typeof row[firstY] === 'string' && !Number.isFinite(Number(row[firstY]))))
      drawn = renderCartesian(body, rows, cols, series, horizontal, palette, colors, font)
    }
  }
  parts.push(drawn || placeholder(body, `${series.map((item) => item.type).join(' + ') || 'chart'} 图表`, font))
  return parts.join('')
}
