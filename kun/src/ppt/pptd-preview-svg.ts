import {
  asBoolean,
  asNumber,
  asRecord,
  asString,
  loadPptdDeck,
  resolveBounds,
  resolvePptdManifest,
  stripRichText,
  type PptdDeck,
  type PptdPage,
  type PptdRect
} from './pptd-deck.js'
import { pptdShapeGeometry, round, type PptdShapeGeometry } from './pptd-preview-geometry.js'
import { renderPptdChart } from './pptd-preview-chart.js'
import {
  PptdPaintContext,
  colorAttributes,
  fillAttributes,
  imageMarkup,
  missingImageMarkup,
  strokeAttributes
} from './pptd-preview-paint.js'
import { escapeXml, mergePptdTextStyle, pptdRichTextToXhtml, pptdTextStyleCss } from './pptd-preview-text.js'

/**
 * Built-in PPTD page renderer for review previews and direction samples.
 *
 * It draws every page straight from the editable PPTD project into a
 * self-contained SVG (fonts from the system, project images inlined), so the
 * PPT workflow needs neither an image-generation model nor an external
 * editor to show what the exported deck will look like.
 */
export const PPTD_PREVIEW_RENDERER = 'kun-pptd-svg@1'

export type PptdPreviewPage = {
  index: number
  /** Manifest page path, e.g. pages/1_cover.page. */
  pageFile: string
  title: string
  svg: string
  /** Project-relative images embedded in this page. */
  images: string[]
  /** Each embedded image with its slot on the page, normalized to 0..1 of the page size. */
  imageSlots: Array<{ path: string; rect: PptdRect }>
}

export type PptdPreviewDeck = {
  manifestPath: string
  deckDir: string
  title: string
  width: number
  height: number
  pages: PptdPreviewPage[]
}

const H_ALIGN: Readonly<Record<string, string>> = { left: 'left', center: 'center', right: 'right', justify: 'justify', distributed: 'justify' }
const V_ALIGN: Readonly<Record<string, string>> = { top: 'flex-start', middle: 'center', bottom: 'flex-end' }

function alignment(value: unknown, fallback: [string, string]): [string, string] {
  if (Array.isArray(value)) return [asString(value[0]) ?? fallback[0], asString(value[1]) ?? fallback[1]]
  const record = asRecord(value)
  if (record) {
    return [
      asString(record.horizontal ?? record.h) ?? fallback[0],
      asString(record.vertical ?? record.v) ?? fallback[1]
    ]
  }
  return fallback
}

function transformAttribute(element: Record<string, unknown>, rect: PptdRect): string {
  const rotation = asNumber(element.rotation) ?? 0
  const flip = Array.isArray(element.flip) ? element.flip : []
  const cx = round(rect.x + rect.width / 2)
  const cy = round(rect.y + rect.height / 2)
  const transforms: string[] = []
  if (rotation) transforms.push(`rotate(${round(rotation)} ${cx} ${cy})`)
  if (flip[0] === true || flip[1] === true) {
    transforms.push(`translate(${cx} ${cy}) scale(${flip[0] === true ? -1 : 1} ${flip[1] === true ? -1 : 1}) translate(${-cx} ${-cy})`)
  }
  const opacity = asNumber(element.opacity)
  return `${transforms.length ? ` transform="${transforms.join(' ')}"` : ''}${opacity !== undefined && opacity < 1 ? ` opacity="${round(Math.max(opacity, 0))}"` : ''}`
}

function geometryMarkup(geometry: PptdShapeGeometry, rect: PptdRect, paint: string): string {
  if (geometry.kind === 'rect') {
    const radius = geometry.radius > 0 ? ` rx="${round(geometry.radius)}" ry="${round(geometry.radius)}"` : ''
    return `<rect x="${round(rect.x)}" y="${round(rect.y)}" width="${round(rect.width)}" height="${round(rect.height)}"${radius}${paint}/>`
  }
  if (geometry.kind === 'ellipse') {
    return `<ellipse cx="${round(rect.x + rect.width / 2)}" cy="${round(rect.y + rect.height / 2)}" rx="${round(rect.width / 2)}" ry="${round(rect.height / 2)}"${paint}/>`
  }
  if (geometry.kind === 'custom') {
    const [vw, vh] = geometry.viewBox
    return `<g transform="translate(${round(rect.x)} ${round(rect.y)}) scale(${round(rect.width / vw)} ${round(rect.height / vh)})"><path d="${escapeXml(geometry.d)}" vector-effect="non-scaling-stroke"${paint}/></g>`
  }
  return `<path d="${geometry.d}"${geometry.evenOdd ? ' fill-rule="evenodd"' : ''}${paint}/>`
}

async function imageFillMarkup(fill: Record<string, unknown>, geometry: PptdShapeGeometry, rect: PptdRect, context: PptdPaintContext): Promise<string> {
  const resolved = await context.image(asString(fill.src) ?? '', rect)
  if (!resolved.ok) return missingImageMarkup(rect, resolved.reason)
  const clipId = context.id('clip')
  context.defs.push(`<clipPath id="${clipId}">${geometryMarkup(geometry, rect, '')}</clipPath>`)
  return `<g clip-path="url(#${clipId})">${imageMarkup(resolved.image, rect, fill.fit, fill.crop, asNumber(fill.opacity))}</g>`
}

async function shapeMarkup(element: Record<string, unknown>, rect: PptdRect, context: PptdPaintContext): Promise<string> {
  const geometry = pptdShapeGeometry(
    asString(element.shapeName),
    rect,
    Array.isArray(element.adjustments) ? element.adjustments.filter((value): value is number => typeof value === 'number') : undefined,
    { viewBox: element.viewBox, path: element.path }
  )
  const fill = asRecord(element.fill)
  const stroke = strokeAttributes(element.border, context.colors)
  if (asString(fill?.type) === 'image' && fill) {
    const image = await imageFillMarkup(fill, geometry, rect, context)
    return stroke ? `${image}${geometryMarkup(geometry, rect, ` fill="none"${stroke}`)}` : image
  }
  return geometryMarkup(geometry, rect, `${fillAttributes(fill, context)}${stroke}`)
}

function textMarkup(element: Record<string, unknown>, rect: PptdRect, context: PptdPaintContext, textStyles: Record<string, unknown>): string {
  const content = asRecord(element.content) ?? {}
  const style = mergePptdTextStyle([content], textStyles)
  const [horizontal, vertical] = alignment(content.align, ['left', 'top'])
  const html = pptdRichTextToXhtml(content.text, context.colors)
  const background = asRecord(element.fill)
    ? geometryMarkup({ kind: 'rect', radius: 0 }, rect, `${fillAttributes(element.fill, context)}${strokeAttributes(element.border, context.colors)}`)
    : ''
  if (!html) return background
  const outer = [
    'box-sizing:border-box',
    `width:${round(rect.width)}px`,
    `height:${round(rect.height)}px`,
    'display:flex',
    'flex-direction:column',
    `justify-content:${V_ALIGN[vertical] ?? 'flex-start'}`,
    pptdTextStyleCss(style, context.colors),
    content.textDirection === 'vertical' ? 'writing-mode:vertical-rl' : ''
  ].filter(Boolean).join(';')
  const inner = [
    `text-align:${H_ALIGN[horizontal] ?? 'left'}`,
    content.wrap === false ? 'white-space:nowrap' : 'overflow-wrap:anywhere',
    style.marginTop ? `padding-top:${style.marginTop}px` : ''
  ].filter(Boolean).join(';')
  return `${background}<foreignObject x="${round(rect.x)}" y="${round(rect.y)}" width="${round(rect.width)}" height="${round(rect.height)}" overflow="visible"><div xmlns="http://www.w3.org/1999/xhtml" style="${escapeXml(outer)}"><div style="${escapeXml(inner)}">${html}</div></div></foreignObject>`
}

function lineMarkup(element: Record<string, unknown>, rect: PptdRect, context: PptdPaintContext): string {
  const stroke = strokeAttributes(element.border ?? element.stroke ?? { color: '#000000', width: 1 }, context.colors) ||
    ' stroke="#000000" stroke-width="1"'
  const viewBox = Array.isArray(element.viewBox) ? element.viewBox : []
  const vw = asNumber(viewBox[0]) || rect.width || 1
  const vh = asNumber(viewBox[1]) || rect.height || 1
  const points = (asString(element.points) ?? '')
    .trim()
    .split(/\s+/)
    .map((pair) => pair.split(',').map(Number))
    .filter((pair) => pair.length === 2 && pair.every(Number.isFinite))
    .map(([x, y]) => [rect.x + (x / vw) * rect.width, rect.y + (y / vh) * rect.height])
  const path = points.length < 2
    ? `M${round(rect.x)} ${round(rect.y)} L${round(rect.x + rect.width)} ${round(rect.y + rect.height)}`
    : points.length === 3 && element.curve !== 'sharp'
      ? `M${round(points[0][0])} ${round(points[0][1])} Q${round(points[1][0])} ${round(points[1][1])} ${round(points[2][0])} ${round(points[2][1])}`
      : points.length === 4 && element.curve !== 'sharp'
        ? `M${round(points[0][0])} ${round(points[0][1])} C${points.slice(1).map(([x, y]) => `${round(x)} ${round(y)}`).join(' ')}`
        : `M${points.map(([x, y]) => `${round(x)} ${round(y)}`).join(' L')}`
  const arrows = Array.isArray(element.arrow) ? element.arrow : []
  const marker = (end: 'start' | 'end'): string => {
    if (!arrows[end === 'start' ? 0 : 1]) return ''
    const id = context.id('arrow')
    const color = /stroke="(#[0-9A-F]{6})"/i.exec(stroke)?.[1] ?? '#000000'
    context.defs.push(`<marker id="${id}" viewBox="0 0 10 10" refX="8" refY="5" markerWidth="6" markerHeight="6" orient="auto-start-reverse"><path d="M0 0 L10 5 L0 10 Z" fill="${color}"/></marker>`)
    return ` marker-${end}="url(#${id})"`
  }
  return `<path d="${path}" fill="none"${stroke} stroke-linecap="round" stroke-linejoin="round"${marker('start')}${marker('end')}/>`
}

async function imageElementMarkup(element: Record<string, unknown>, rect: PptdRect, context: PptdPaintContext): Promise<string> {
  const resolved = await context.image(asString(element.src) ?? '', rect)
  const cropShape = asRecord(element.cropShape)
  let body = resolved.ok
    ? imageMarkup(resolved.image, rect, element.fit, element.crop)
    : missingImageMarkup(rect, resolved.reason)
  if (resolved.ok && cropShape) {
    const geometry = pptdShapeGeometry(asString(cropShape.shapeName), rect, undefined, cropShape)
    const clipId = context.id('clip')
    context.defs.push(`<clipPath id="${clipId}">${geometryMarkup(geometry, rect, '')}</clipPath>`)
    body = `<g clip-path="url(#${clipId})">${body}</g>`
  }
  const stroke = strokeAttributes(element.border, context.colors)
  return stroke ? `${body}${geometryMarkup({ kind: 'rect', radius: 0 }, rect, ` fill="none"${stroke}`)}` : body
}

function iconMarkup(element: Record<string, unknown>, rect: PptdRect, context: PptdPaintContext): string {
  // Font Awesome glyphs are not bundled; a tinted badge keeps the icon's place and color.
  const fill = asRecord(element.fill)
  const paint = colorAttributes(asString(fill?.color) ?? '#000000', context.colors, 'fill') ?? ' fill="#000000"'
  const size = Math.min(rect.width, rect.height)
  const x = rect.x + (rect.width - size) / 2
  const y = rect.y + (rect.height - size) / 2
  return `<rect x="${round(x + size * 0.12)}" y="${round(y + size * 0.12)}" width="${round(size * 0.76)}" height="${round(size * 0.76)}" rx="${round(size * 0.2)}"${paint} fill-opacity="0.85"/>`
}

function tableStyleConfig(element: Record<string, unknown>, tableStyles: Record<string, unknown>): Record<string, unknown> {
  const style = element.style
  if (typeof style === 'string' && style.startsWith('$')) return asRecord(tableStyles[style.slice(1)]) ?? {}
  return asRecord(style) ?? {}
}

function borderSides(value: unknown): [unknown, unknown, unknown, unknown] {
  if (value === null) return [null, null, null, null]
  if (Array.isArray(value)) {
    if (value.length === 2) return [value[0], value[1], value[0], value[1]]
    if (value.length >= 4) return [value[0], value[1], value[2], value[3]]
  }
  return [value, value, value, value]
}

function tableMarkup(element: Record<string, unknown>, rect: PptdRect, context: PptdPaintContext, textStyles: Record<string, unknown>, tableStyles: Record<string, unknown>): string {
  const rows = (Array.isArray(element.rows) ? element.rows : []).map((row) => Array.isArray(row) ? row : [])
  const columnCount = Array.isArray(element.columnWidths) && element.columnWidths.length > 0
    ? element.columnWidths.length
    : Math.max(0, ...rows.map((row) => row.length))
  const ratios = (values: unknown, count: number): number[] => {
    const list = Array.isArray(values) ? values.map((value) => asNumber(value) ?? 0) : []
    const filled = list.length === count ? list : Array.from({ length: count }, () => 1 / Math.max(count, 1))
    const total = filled.reduce((sum, value) => sum + value, 0) || 1
    return filled.map((value) => value / total)
  }
  const widths = ratios(element.columnWidths, columnCount)
  const heights = ratios(element.rowHeights, rows.length)
  const config = tableStyleConfig(element, tableStyles)
  const bodyStyles = Array.isArray(config.bodyStyles) ? config.bodyStyles.map((style) => asRecord(style)) : []
  const rowOverColumn = asBoolean(config.rowOverColumn) !== false
  const parts: string[] = []
  if (asRecord(element.fill)) parts.push(geometryMarkup({ kind: 'rect', radius: 0 }, rect, fillAttributes(element.fill, context)))
  const occupied = new Set<string>()
  for (const [rowIndex, row] of rows.entries()) {
    let columnIndex = 0
    for (const cellValue of row) {
      while (occupied.has(`${rowIndex}:${columnIndex}`)) columnIndex += 1
      const cell = asRecord(cellValue) ?? {}
      const rowSpan = Math.max(1, Math.floor(asNumber(cell.rowSpan) ?? 1))
      const colSpan = Math.max(1, Math.floor(asNumber(cell.colSpan) ?? 1))
      for (let r = 0; r < rowSpan; r += 1) for (let c = 0; c < colSpan; c += 1) occupied.add(`${rowIndex + r}:${columnIndex + c}`)
      const rowStyle = asRecord(rowIndex === 0 ? config.firstRowStyle : rowIndex === rows.length - 1 ? config.lastRowStyle : undefined)
      const columnStyle = asRecord(columnIndex === 0 ? config.firstColumnStyle : columnIndex === columnCount - 1 ? config.lastColumnStyle : undefined)
      const bodyStyle = rowIndex > 0 && rowIndex < rows.length - 1 && bodyStyles.length > 0
        ? bodyStyles[(rowIndex - 1) % bodyStyles.length]
        : undefined
      const layers = [cell, ...(rowOverColumn ? [rowStyle, columnStyle] : [columnStyle, rowStyle]), bodyStyle, asRecord(config.cellStyle)]
      const pick = (field: string): unknown => layers.find((layer) => layer?.[field] !== undefined)?.[field]
      const cellRect = {
        x: rect.x + widths.slice(0, columnIndex).reduce((sum, value) => sum + value, 0) * rect.width,
        y: rect.y + heights.slice(0, rowIndex).reduce((sum, value) => sum + value, 0) * rect.height,
        width: widths.slice(columnIndex, columnIndex + colSpan).reduce((sum, value) => sum + value, 0) * rect.width,
        height: heights.slice(rowIndex, rowIndex + rowSpan).reduce((sum, value) => sum + value, 0) * rect.height
      }
      const fill = pick('fill')
      if (asRecord(fill)) parts.push(geometryMarkup({ kind: 'rect', radius: 0 }, cellRect, fillAttributes(fill, context)))
      const border = pick('border')
      const [top, right, bottom, left] = borderSides(border === undefined ? { style: 'solid', width: 1, color: '#000000' } : border)
      const edges: Array<[unknown, number, number, number, number]> = [
        [top, cellRect.x, cellRect.y, cellRect.x + cellRect.width, cellRect.y],
        [right, cellRect.x + cellRect.width, cellRect.y, cellRect.x + cellRect.width, cellRect.y + cellRect.height],
        [bottom, cellRect.x, cellRect.y + cellRect.height, cellRect.x + cellRect.width, cellRect.y + cellRect.height],
        [left, cellRect.x, cellRect.y, cellRect.x, cellRect.y + cellRect.height]
      ]
      for (const [side, x1, y1, x2, y2] of edges) {
        const stroke = strokeAttributes(side, context.colors)
        if (stroke) parts.push(`<line x1="${round(x1)}" y1="${round(y1)}" x2="${round(x2)}" y2="${round(y2)}"${stroke}/>`)
      }
      const style = mergePptdTextStyle(layers, textStyles)
      if (style.fontSize === undefined) style.fontSize = Math.max(Math.min(18, cellRect.height * 0.42), 8)
      const content: Record<string, unknown> = { text: cell.text, align: pick('align') ?? ['center', 'middle'] }
      const padded = { x: cellRect.x + 6, y: cellRect.y + 3, width: Math.max(cellRect.width - 12, 4), height: Math.max(cellRect.height - 6, 4) }
      parts.push(textMarkup({ content: { ...content, ...style, style: undefined } }, padded, context, {}))
      columnIndex += colSpan
    }
  }
  return parts.join('')
}

async function elementMarkup(element: Record<string, unknown>, context: PptdPaintContext, deck: PptdDeck): Promise<string> {
  const rect = resolveBounds(element.bounds)
  if (!rect) return ''
  const textStyles = asRecord(deck.theme.textStyles) ?? {}
  let body = ''
  switch (asString(element.elementType)) {
    case 'text': body = textMarkup(element, rect, context, textStyles); break
    case 'shape': body = await shapeMarkup(element, rect, context); break
    case 'line': body = lineMarkup(element, rect, context); break
    case 'image': body = await imageElementMarkup(element, rect, context); break
    case 'icon': body = iconMarkup(element, rect, context); break
    case 'table': body = tableMarkup(element, rect, context, textStyles, asRecord(deck.theme.tableStyles) ?? {}); break
    case 'chart': {
      const frame = asRecord(element.fill) || asRecord(element.border)
        ? geometryMarkup({ kind: 'rect', radius: 0 }, rect, `${fillAttributes(element.fill, context)}${strokeAttributes(element.border, context.colors)}`)
        : ''
      body = `${frame}${renderPptdChart(element, rect, context.colors)}`
      break
    }
    default: return ''
  }
  return body ? `<g${transformAttribute(element, rect)}>${body}</g>` : ''
}

export function pptdPageTitle(page: PptdPage, textStyles: Record<string, unknown>): string {
  const explicit = stripRichText(asRecord(page.record.title)?.text ?? page.record.title)
  if (explicit) return explicit.slice(0, 120)
  const texts = (Array.isArray(page.record.elements) ? page.record.elements : [])
    .map((value) => asRecord(value))
    .filter((element): element is Record<string, unknown> => asString(element?.elementType) === 'text')
    .map((element) => {
      const content = asRecord(element.content) ?? {}
      return { text: stripRichText(content.text).split('\n')[0]?.trim() ?? '', size: mergePptdTextStyle([content], textStyles).fontSize ?? 18 }
    })
    .filter((entry) => entry.text)
  const largest = texts.sort((left, right) => right.size - left.size)[0]
  return (largest?.text ?? asString(page.record.pageType) ?? `第 ${page.index + 1} 页`).slice(0, 120)
}

export async function renderPptdPageSvg(deck: PptdDeck, page: PptdPage): Promise<PptdPreviewPage> {
  const { width, height } = deck.pageSize
  const context = new PptdPaintContext(deck.deckDir, deck.colors, `p${page.index + 1}`)
  const background = asRecord(page.record.background) ?? { type: 'solid', color: '#FFFFFF' }
  const pageRect = { x: 0, y: 0, width, height }
  const parts = [geometryMarkup({ kind: 'rect', radius: 0 }, pageRect, ' fill="#FFFFFF"')]
  parts.push(asString(background.type) === 'image'
    ? await imageFillMarkup(background, { kind: 'rect', radius: 0 }, pageRect, context)
    : geometryMarkup({ kind: 'rect', radius: 0 }, pageRect, fillAttributes(background, context)))
  for (const value of Array.isArray(page.record.elements) ? page.record.elements : []) {
    const element = asRecord(value)
    if (element) parts.push(await elementMarkup(element, context, deck))
  }
  const defs = context.defs.length ? `<defs>${context.defs.join('')}</defs>` : ''
  const clipId = context.id('page')
  return {
    index: page.index,
    pageFile: page.file,
    title: pptdPageTitle(page, asRecord(deck.theme.textStyles) ?? {}),
    images: [...new Set(context.images.map((image) => image.path))],
    imageSlots: context.images.map((image) => ({ path: image.path, rect: normalizedSlot(image.rect, width, height) })),
    svg: `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}"><defs><clipPath id="${clipId}"><rect width="${width}" height="${height}"/></clipPath></defs>${defs}<g clip-path="url(#${clipId})">${parts.join('')}</g></svg>`
  }
}

/** Clip a page-pixel rect to the page and express it as fractions of the page size. */
function normalizedSlot(rect: PptdRect, width: number, height: number): PptdRect {
  const unit = (value: number) => Math.round(Math.min(Math.max(value, 0), 1) * 10_000) / 10_000
  const left = unit(rect.x / width)
  const top = unit(rect.y / height)
  return {
    x: left,
    y: top,
    width: Math.round((unit((rect.x + rect.width) / width) - left) * 10_000) / 10_000,
    height: Math.round((unit((rect.y + rect.height) / height) - top) * 10_000) / 10_000
  }
}

/** Render every page of a PPTD project (manifest path or project directory). */
export async function renderPptdPreviewDeck(input: string): Promise<PptdPreviewDeck> {
  const deck = await loadPptdDeck(await resolvePptdManifest(input))
  const pages: PptdPreviewPage[] = []
  for (const page of deck.pages) pages.push(await renderPptdPageSvg(deck, page))
  return {
    manifestPath: deck.manifestPath,
    deckDir: deck.deckDir,
    title: deck.title,
    width: deck.pageSize.width,
    height: deck.pageSize.height,
    pages
  }
}
