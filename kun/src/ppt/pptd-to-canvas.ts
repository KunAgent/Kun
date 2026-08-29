import { readFile } from 'node:fs/promises'
import { dirname, isAbsolute, join, relative, resolve } from 'node:path'
import { parse as parseYaml } from 'yaml'

/**
 * Deterministic PPTD → whiteboard converter.
 *
 * Parses a PPTD deck project (deck.pptd + pages/*.page + media/) and emits a
 * flat list of ShapeOps that the Design canvas understands (same protocol as
 * `design_canvas` / `design_update_shapes`, see
 * src/renderer/src/design/canvas/shape-ops/schema.ts). Conversion is fully
 * deterministic — no LLM in the loop — so a deck can be laid out on the
 * whiteboard and then edited by the user (text, fonts, colors, images).
 *
 * Output shapes intentionally use a strict subset of the schema: every field
 * emitted exists in the renderer's strict PartialShapeSchema.
 */

export type PptBoardFill =
  | { type: 'solid'; color: string; opacity: number }
  | {
      type: 'linear' | 'radial'
      stops: Array<{ offset: number; color: string; opacity?: number }>
      angle?: number
      opacity: number
    }

export type PptBoardStroke = {
  color: string
  width: number
  opacity: number
  position: 'center' | 'inside' | 'outside'
  dash?: 'solid' | 'dashed' | 'dotted'
}

export type PptBoardShape = {
  type: 'text' | 'rect' | 'ellipse' | 'image' | 'frame' | 'line'
  name?: string
  x: number
  y: number
  width: number
  height: number
  rotation?: number
  opacity?: number
  fills?: PptBoardFill[]
  strokes?: PptBoardStroke[]
  cornerRadius?: number
  textContent?: string
  fontSize?: number
  fontFamily?: string
  fontWeight?: number
  fontColor?: string
  textAlign?: 'left' | 'center' | 'right'
  lineHeight?: number
  imageUrl?: string
  clipContent?: boolean
  points?: Array<{ x: number; y: number }>
}

export type PptBoardOp =
  | {
      op: 'add-screen'
      name: string
      x: number
      y: number
      width: number
      height: number
    }
  | { op: 'add'; shape: PptBoardShape }

export type PptdToCanvasResult = {
  boardTitle: string
  pageCount: number
  ops: PptBoardOp[]
}

/** Renderer per-batch budget (mirrors design_update_shapes). */
export { PPT_TO_BOARD_BATCH_SIZE, sliceOpsForBatch } from './pptd-to-canvas-batching.js'
export type { PptBoardBatch } from './pptd-to-canvas-batching.js'

export type PptdToCanvasOptions = {
  /** 2-column grid ('grid') or single row ('row'). Default 'grid'. */
  layout?: 'grid' | 'row'
  /** Workspace root. When provided, image srcs are emitted as workspace-relative paths. */
  workspaceRoot?: string
  /** Fixed page gap between screens in canvas units. Default 80. */
  pageGap?: number
}

type Rect = { x: number; y: number; width: number; height: number }

function err(message: string, cause?: unknown): Error {
  const error = new Error(`pptd-to-canvas: ${message}`)
  if (cause !== undefined) (error as { cause?: unknown }).cause = cause
  return error
}

function asRecord(value: unknown): Record<string, unknown> | undefined {
  if (typeof value === 'object' && value !== null && !Array.isArray(value)) {
    return value as Record<string, unknown>
  }
  return undefined
}

function asString(value: unknown): string | undefined {
  return typeof value === 'string' ? value : undefined
}

function asNumber(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined
}

function asBoolean(value: unknown): boolean | undefined {
  return typeof value === 'boolean' ? value : undefined
}

/** Parse "#RRGGBBAA" into [color, opacity]. Falls back to [color, 1]. */
function splitColorAlpha(raw: string): { color: string; opacity: number } {
  const trimmed = raw.trim()
  const match = /^#([0-9a-fA-F]{6})([0-9a-fA-F]{2})$/.exec(trimmed)
  if (match) {
    const alpha = Number.parseInt(match[2], 16) / 255
    return { color: `#${match[1].toUpperCase()}`, opacity: Math.round(alpha * 1000) / 1000 }
  }
  return { color: trimmed, opacity: 1 }
}

function stripRichText(raw: unknown): string {
  if (typeof raw !== 'string') return ''
  // Strip HTML-ish tags from PPTD rich text blocks; keep text and newlines.
  return raw
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/(p|div)>/gi, '\n')
    .replace(/<[^>]*>/g, '')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&nbsp;/g, ' ')
    .trim()
}

function resolveBounds(value: unknown): Rect | undefined {
  if (Array.isArray(value) && value.length >= 4) {
    const [x, y, width, height] = value
    if ([x, y, width, height].every((n) => typeof n === 'number' && Number.isFinite(n))) {
      return { x, y, width, height }
    }
  }
  const record = asRecord(value)
  if (record) {
    const x = asNumber(record.x)
    const y = asNumber(record.y)
    const width = asNumber(record.width)
    const height = asNumber(record.height)
    if (x !== undefined && y !== undefined && width !== undefined && height !== undefined) {
      return { x, y, width, height }
    }
  }
  return undefined
}

function resolveTokenColor(value: unknown, colors: Record<string, unknown>): string | undefined {
  if (typeof value !== 'string') return undefined
  const trimmed = value.trim()
  if (trimmed.startsWith('$')) {
    const token = trimmed.slice(1)
    const resolved = asString(colors[token])
    if (resolved === undefined) {
      // Unknown token: keep the reference so it degrades visibly on the board.
      return trimmed
    }
    return resolved
  }
  return trimmed
}

function toFill(
  value: unknown,
  colors: Record<string, unknown>
): PptBoardFill | undefined {
  const record = asRecord(value)
  if (!record) return undefined
  const type = asString(record.type)
  if (type === 'none' || type === undefined) return undefined
  if (type === 'solid') {
    const color = resolveTokenColor(record.color, colors)
    if (!color) return undefined
    const { color: hex, opacity } = splitColorAlpha(color)
    return { type: 'solid', color: hex, opacity }
  }
  if (type === 'gradient' || type === 'linear' || type === 'radial') {
    const gradientType: 'linear' | 'radial' = type === 'radial' ? 'radial' : 'linear'
    const rawStops = Array.isArray(record.stops) ? record.stops : []
    const stops = rawStops
      .map((stop) => {
        const s = asRecord(stop)
        if (!s) return undefined
        const offset = asNumber(s.position) ?? asNumber(s.offset)
        const color = resolveTokenColor(s.color, colors)
        if (offset === undefined || !color) return undefined
        const { color: hex, opacity } = splitColorAlpha(color)
        return { offset, color: hex, ...(opacity < 1 ? { opacity } : {}) }
      })
      .filter((s): s is { offset: number; color: string; opacity?: number } => s !== undefined)
    if (stops.length < 2) return undefined
    const angle = asNumber(record.angle)
    return {
      type: gradientType,
      stops,
      ...(angle !== undefined ? { angle } : {}),
      opacity: 1
    }
  }
  return undefined
}

function toStrokes(
  value: unknown,
  colors: Record<string, unknown>
): PptBoardStroke[] | undefined {
  const record = asRecord(value)
  if (!record) return undefined
  const color = resolveTokenColor(record.color, colors)
  if (!color) return undefined
  const { color: hex, opacity } = splitColorAlpha(color)
  const width = asNumber(record.width) ?? 1
  const style = asString(record.style)
  const dash: PptBoardStroke['dash'] =
    style === 'dashed' || style === 'dotted' ? style : undefined
  return [{ color: hex, width, opacity, position: 'center', ...(dash ? { dash } : {}) }]
}

function toTextStyle(
  content: Record<string, unknown>,
  textStyles: Record<string, unknown>,
  colors: Record<string, unknown>
): {
  textContent?: string
  fontSize?: number
  fontFamily?: string
  fontWeight?: number
  fontColor?: string
  textAlign?: 'left' | 'center' | 'right'
  lineHeight?: number
} {
  const styleRef = asString(content.style)
  const styleBase: Record<string, unknown> = {}
  if (styleRef?.startsWith('$')) {
    const named = asRecord(textStyles[styleRef.slice(1)])
    if (named) Object.assign(styleBase, named)
  }
  const merged: Record<string, unknown> = { ...styleBase, ...content }
  const color = resolveTokenColor(merged.color, colors)
  const bold = asBoolean(merged.bold)
  return {
    textContent: stripRichText(merged.text),
    fontSize: asNumber(merged.fontSize),
    fontFamily: asString(merged.fontFamily),
    ...(bold === true ? { fontWeight: 700 } : {}),
    ...(color ? { fontColor: splitColorAlpha(color).color } : {}),
    textAlign: toTextAlign(merged.align),
    lineHeight: asNumber(merged.lineHeight)
  }
}

function toTextAlign(alignValue: unknown): 'left' | 'center' | 'right' | undefined {
  if (Array.isArray(alignValue)) {
    const horizontal = alignValue[0]
    if (horizontal === 'center' || horizontal === 'right') return horizontal
    return 'left'
  }
  const record = asRecord(alignValue)
  if (record) {
    const h = record.horizontal ?? record.h
    if (h === 'center' || h === 'right') return h
    return 'left'
  }
  return undefined
}

/** Translate element rect by the page origin on the board. */
function offsetRect(rect: Rect, origin: { x: number; y: number }): Rect {
  return {
    x: Math.round(rect.x + origin.x),
    y: Math.round(rect.y + origin.y),
    width: Math.round(rect.width),
    height: Math.round(rect.height)
  }
}

function mapElement(
  element: Record<string, unknown>,
  origin: { x: number; y: number },
  theme: Record<string, unknown>,
  projectDir: string,
  workspaceRoot: string | undefined
): PptBoardOp[] {
  const bounds = resolveBounds(element.bounds)
  if (!bounds) return []
  const rect = offsetRect(bounds, origin)
  const colors = asRecord(theme.colors) ?? {}
  const textStyles = asRecord(theme.textStyles) ?? {}
  const elementType = asString(element.elementType) ?? ''

  const base = { name: asString(element.elementId) }

  if (elementType === 'text') {
    const content = asRecord(element.content) ?? {}
    const style = toTextStyle(content, textStyles, colors)
    const shape: PptBoardShape = {
      type: 'text',
      ...base,
      x: rect.x,
      y: rect.y,
      width: rect.width,
      height: rect.height,
      ...style
    }
    return [{ op: 'add', shape }]
  }

  if (elementType === 'shape') {
    const shapeName = asString(element.shapeName) ?? 'rect'
    const fills = toFill(element.fill, colors)
    const strokes = toStrokes(element.border, colors)
    const shapeType: PptBoardShape['type'] =
      shapeName === 'ellipse' || shapeName === 'oval' ? 'ellipse' : 'rect'
    const cornerRadius =
      shapeName === 'roundRect'
        ? Math.round(Math.min(rect.width, rect.height) * 0.12)
        : asNumber(element.radius)
    const shape: PptBoardShape = {
      type: shapeType,
      ...base,
      x: rect.x,
      y: rect.y,
      width: rect.width,
      height: rect.height,
      ...(fills ? { fills: [fills] } : {}),
      ...(strokes ? { strokes } : {}),
      ...(cornerRadius !== undefined ? { cornerRadius } : {}),
      ...(asNumber(element.rotation) !== undefined
        ? { rotation: asNumber(element.rotation) }
        : {})
    }
    return [{ op: 'add', shape }]
  }

  if (elementType === 'line') {
    const shape: PptBoardShape = {
      type: 'line',
      ...base,
      x: rect.x,
      y: rect.y,
      width: rect.width,
      height: rect.height,
      points: [
        { x: rect.x, y: rect.y },
        { x: rect.x + rect.width, y: rect.y + rect.height }
      ],
      strokes: toStrokes(element.border ?? element.stroke, colors) ?? toStrokes(element.fill, colors)
    }
    return [{ op: 'add', shape }]
  }

  if (elementType === 'image') {
    const src = asString(element.src)
    if (!src) return []
    const imageUrl = resolveImageUrl(src, projectDir, workspaceRoot)
    const shape: PptBoardShape = {
      type: 'image',
      ...base,
      x: rect.x,
      y: rect.y,
      width: rect.width,
      height: rect.height,
      imageUrl
    }
    return [{ op: 'add', shape }]
  }

  if (elementType === 'table') {
    return mapTable(element, rect, colors)
  }

  if (elementType === 'chart') {
    const chartTitle = stripRichText(
      asRecord(element.title)?.text ?? element.title ?? ''
    )
    const chartType = asString(element.chartType) ?? asString(element.type) ?? 'chart'
    const placeholder = `图表占位（${chartType}${chartTitle ? `：${chartTitle}` : ''}），可在白板继续编辑`
    const label: PptBoardShape = {
      type: 'text',
      ...base,
      x: rect.x + 12,
      y: rect.y + 12,
      width: Math.max(rect.width - 24, 40),
      height: 40,
      textContent: placeholder,
      fontSize: 14,
      fontColor: '#6B7280',
      textAlign: 'left',
      lineHeight: 1.4
    }
    return [{ op: 'add', shape: label }]
  }

  // icon / custom / unknown: skip silently — content is preserved in the PPTD.
  return []
}

function resolveImageUrl(
  src: string,
  projectDir: string,
  workspaceRoot: string | undefined
): string {
  if (/^[a-z]+:/i.test(src) || src.startsWith('//')) return src
  if (isAbsolute(src)) return src
  const absolute = resolve(projectDir, src)
  if (workspaceRoot) {
    const rel = relative(workspaceRoot, absolute)
    return rel.startsWith('..') ? absolute : rel.replaceAll('\\', '/')
  }
  return relative(projectDir, absolute).replaceAll('\\', '/')
}

function mapTable(
  element: Record<string, unknown>,
  rect: Rect,
  colors: Record<string, unknown>
): PptBoardOp[] {
  const columnWidths = Array.isArray(element.columnWidths)
    ? element.columnWidths.map((w) => asNumber(w) ?? 0)
    : []
  const rowHeights = Array.isArray(element.rowHeights)
    ? element.rowHeights.map((h) => asNumber(h) ?? 0)
    : []
  const rows = Array.isArray(element.rows) ? element.rows : []
  const ops: PptBoardOp[] = []
  const occupied = new Set<string>()

  const colCount =
    columnWidths.length > 0
      ? columnWidths.length
      : Math.max(...rows.map((r) => (Array.isArray(r) ? r.length : 0)), 0)

  const widths =
    columnWidths.length > 0
      ? columnWidths
      : Array.from({ length: colCount }, () => 1 / Math.max(colCount, 1))

  const heights =
    rowHeights.length > 0
      ? rowHeights
      : Array.from({ length: rows.length }, () => 1 / Math.max(rows.length, 1))

  for (let rowIndex = 0; rowIndex < rows.length; rowIndex += 1) {
    const row = Array.isArray(rows[rowIndex]) ? rows[rowIndex] : []
    let colIndex = 0
    for (const cellValue of row) {
      while (occupied.has(`${rowIndex}:${colIndex}`)) colIndex += 1
      const cell = asRecord(cellValue) ?? {}
      const rowSpan = Math.max(1, Math.floor(asNumber(cell.rowSpan) ?? 1))
      const colSpan = Math.max(1, Math.floor(asNumber(cell.colSpan) ?? 1))
      for (let r = 0; r < rowSpan; r += 1) {
        for (let c = 0; c < colSpan; c += 1) {
          occupied.add(`${rowIndex + r}:${colIndex + c}`)
        }
      }
      const cellRect = {
        x: rect.x + Math.round(widths.slice(0, colIndex).reduce((a, b) => a + b, 0) * rect.width),
        y: rect.y + Math.round(heights.slice(0, rowIndex).reduce((a, b) => a + b, 0) * rect.height),
        width: Math.round(widths.slice(colIndex, colIndex + colSpan).reduce((a, b) => a + b, 0) * rect.width),
        height: Math.round(heights.slice(rowIndex, rowIndex + rowSpan).reduce((a, b) => a + b, 0) * rect.height)
      }
      const fill = toFill(cell.fill, colors)
      if (fill) {
        ops.push({
          op: 'add',
          shape: {
            type: 'rect',
            x: cellRect.x,
            y: cellRect.y,
            width: cellRect.width,
            height: cellRect.height,
            fills: [fill]
          }
        })
      }
      const text = stripRichText(cell.text)
      if (text) {
        ops.push({
          op: 'add',
          shape: {
            type: 'text',
            x: cellRect.x + 6,
            y: cellRect.y + 4,
            width: Math.max(cellRect.width - 12, 8),
            height: Math.max(cellRect.height - 8, 8),
            textContent: text,
            fontSize: asNumber(cell.fontSize) ?? 13,
            textAlign: toTextAlign(cell.align) ?? 'center',
            lineHeight: 1.3
          }
        })
      }
      colIndex += colSpan
    }
  }
  return ops
}

function mapPageBackground(
  page: Record<string, unknown>,
  origin: { x: number; y: number },
  pageSize: { width: number; height: number },
  theme: Record<string, unknown>,
  projectDir: string,
  workspaceRoot: string | undefined
): PptBoardOp[] {
  const background = asRecord(page.background)
  if (!background) return []
  const colors = asRecord(theme.colors) ?? {}
  const type = asString(background.type)
  if (type === 'solid' || type === 'gradient') {
    const fill = toFill(background, colors)
    if (!fill) return []
    return [
      {
        op: 'add',
        shape: {
          type: 'frame',
          x: origin.x,
          y: origin.y,
          width: pageSize.width,
          height: pageSize.height,
          fills: [fill],
          clipContent: true
        }
      }
    ]
  }
  if (type === 'image') {
    const src = asString(background.src)
    if (!src) return []
    return [
      {
        op: 'add',
        shape: {
          type: 'image',
          x: origin.x,
          y: origin.y,
          width: pageSize.width,
          height: pageSize.height,
          imageUrl: resolveImageUrl(src, projectDir, workspaceRoot)
        }
      }
    ]
  }
  return []
}

async function readYamlFile(filePath: string): Promise<Record<string, unknown>> {
  let source: string
  try {
    source = await readFile(filePath, 'utf8')
  } catch (cause) {
    throw err(`无法读取 ${filePath}: ${(cause as Error).message}`, cause)
  }
  const parsed = parseYaml(source, { prettyErrors: true })
  const record = asRecord(parsed)
  if (!record) {
    throw err(`不是有效的 YAML 映射: ${filePath}`)
  }
  return record
}

/**
 * Convert a PPTD deck project into whiteboard ShapeOps.
 *
 * @param pptdPath absolute path to deck.pptd
 */
export async function convertPptdToCanvas(
  pptdPath: string,
  options: PptdToCanvasOptions = {}
): Promise<PptdToCanvasResult> {
  const layout = options.layout ?? 'grid'
  const pageGap = options.pageGap ?? 80
  const workspaceRoot = options.workspaceRoot
  const deckDir = dirname(pptdPath)
  const deck = await readYamlFile(pptdPath)

  const sizeValue = deck.size
  const sizeRecord = asRecord(sizeValue)
  let pageSize: { width: number; height: number }
  if (Array.isArray(sizeValue) && sizeValue.length >= 2) {
    const width = asNumber(sizeValue[0])
    const height = asNumber(sizeValue[1])
    if (width === undefined || height === undefined) {
      throw err(`deck.pptd size 非法: ${JSON.stringify(sizeValue)}`)
    }
    pageSize = { width, height }
  } else if (sizeRecord) {
    const width = asNumber(sizeRecord.width)
    const height = asNumber(sizeRecord.height)
    if (width === undefined || height === undefined) {
      throw err(`deck.pptd size 非法: ${JSON.stringify(sizeValue)}`)
    }
    pageSize = { width, height }
  } else {
    // Default 16:9 like the PPTD spec.
    pageSize = { width: 960, height: 540 }
  }

  const theme = asRecord(deck.theme) ?? {}
  const rawPages = Array.isArray(deck.pages) ? deck.pages : []
  const pageFiles = rawPages
    .map((p) => asString(p))
    .filter((p): p is string => p !== undefined)
  if (pageFiles.length === 0) {
    throw err(`deck.pptd 没有 pages 列表`)
  }

  const ops: PptBoardOp[] = []
  const columns = layout === 'row' ? pageFiles.length : 2

  for (let index = 0; index < pageFiles.length; index += 1) {
    const pageFile = pageFiles[index]
    const pagePath = isAbsolute(pageFile) ? pageFile : join(deckDir, pageFile)
    const page = await readYamlFile(pagePath)

    const column = layout === 'row' ? index : index % columns
    const row = layout === 'row' ? 0 : Math.floor(index / columns)
    const origin = {
      x: column * (pageSize.width + pageGap),
      y: row * (pageSize.height + pageGap)
    }

    const pageTitle = stripRichText(
      asRecord(page.title)?.text ?? page.title ?? page.pageType ?? `Page ${index + 1}`
    )
    ops.push({
      op: 'add-screen',
      name: `P${index + 1} ${pageTitle}`.trim(),
      x: origin.x,
      y: origin.y,
      width: pageSize.width,
      height: pageSize.height
    })

    const backgroundOps = mapPageBackground(
      page,
      origin,
      pageSize,
      theme,
      deckDir,
      workspaceRoot
    )
    ops.push(...backgroundOps)

    const elements = Array.isArray(page.elements) ? page.elements : []
    for (const elementValue of elements) {
      const element = asRecord(elementValue)
      if (!element) continue
      ops.push(...mapElement(element, origin, theme, deckDir, workspaceRoot))
    }
  }

  const deckTitle = stripRichText(deck.title) || 'PPT 白板'
  return {
    boardTitle: `${deckTitle}（${pageFiles.length} 页）`,
    pageCount: pageFiles.length,
    ops
  }
}
