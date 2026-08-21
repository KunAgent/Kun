import {
  ANNOTATION_FONT_STACKS,
  type AnnotationOp,
  type AnnotationPoint
} from './image-annotation-model'

export type AnnotationBounds = { x: number; y: number; width: number; height: number }
export type AnnotationHandle = 'start' | 'end' | 'nw' | 'ne' | 'se' | 'sw'
export type PositionedAnnotationHandle = { handle: AnnotationHandle; point: AnnotationPoint }

const TEXT_LINE_HEIGHT = 1.2

function lineDash(op: Extract<AnnotationOp, { kind: 'pen' | 'arrow' | 'rect' }>): number[] {
  if (op.dash === 'dashed') return [op.width * 3, op.width * 2]
  if (op.dash === 'dotted') return [Math.max(0.5, op.width * 0.1), op.width * 2]
  return []
}

function paintArrowhead(
  ctx: CanvasRenderingContext2D,
  op: Extract<AnnotationOp, { kind: 'arrow' }>
): void {
  if (op.arrowhead === 'none') return
  const angle = Math.atan2(op.to.y - op.from.y, op.to.x - op.from.x)
  const head = Math.max(10, op.width * 4)
  const left = {
    x: op.to.x - head * Math.cos(angle - Math.PI / 6),
    y: op.to.y - head * Math.sin(angle - Math.PI / 6)
  }
  const right = {
    x: op.to.x - head * Math.cos(angle + Math.PI / 6),
    y: op.to.y - head * Math.sin(angle + Math.PI / 6)
  }
  ctx.setLineDash([])
  ctx.beginPath()
  ctx.moveTo(op.to.x, op.to.y)
  ctx.lineTo(left.x, left.y)
  if (op.arrowhead === 'triangle') {
    ctx.lineTo(right.x, right.y)
    ctx.closePath()
    ctx.fill()
    return
  }
  ctx.moveTo(op.to.x, op.to.y)
  ctx.lineTo(right.x, right.y)
  ctx.stroke()
}

function configureLine(
  ctx: CanvasRenderingContext2D,
  op: Extract<AnnotationOp, { kind: 'pen' | 'arrow' | 'rect' }>
): void {
  ctx.strokeStyle = op.color
  ctx.fillStyle = op.color
  ctx.globalAlpha = op.opacity
  ctx.lineCap = 'round'
  ctx.lineJoin = 'round'
  ctx.lineWidth = op.width
  ctx.setLineDash(lineDash(op))
}

export function paintAnnotation(ctx: CanvasRenderingContext2D, op: AnnotationOp): void {
  ctx.save()
  if (op.kind === 'text') {
    ctx.globalAlpha = op.opacity
    ctx.font = `${op.fontWeight} ${op.fontSize}px ${ANNOTATION_FONT_STACKS[op.fontFamily]}`
    ctx.textBaseline = 'top'
    ctx.lineWidth = Math.max(2, op.fontSize / 10)
    ctx.strokeStyle = op.color === '#ffffff' ? 'rgba(0,0,0,0.55)' : 'rgba(255,255,255,0.85)'
    ctx.fillStyle = op.color
    const lineHeight = op.fontSize * TEXT_LINE_HEIGHT
    for (const [index, line] of op.text.split(/\r?\n/).entries()) {
      const y = op.y + index * lineHeight
      ctx.strokeText(line, op.x, y)
      ctx.fillText(line, op.x, y)
    }
    ctx.restore()
    return
  }

  configureLine(ctx, op)
  if (op.kind === 'pen') {
    if (op.points.length === 1) {
      ctx.beginPath()
      ctx.arc(op.points[0].x, op.points[0].y, op.width / 2, 0, Math.PI * 2)
      ctx.fill()
    } else if (op.points.length > 1) {
      ctx.beginPath()
      ctx.moveTo(op.points[0].x, op.points[0].y)
      for (const point of op.points.slice(1)) ctx.lineTo(point.x, point.y)
      ctx.stroke()
    }
  } else if (op.kind === 'arrow') {
    ctx.beginPath()
    ctx.moveTo(op.from.x, op.from.y)
    ctx.lineTo(op.to.x, op.to.y)
    ctx.stroke()
    paintArrowhead(ctx, op)
  } else {
    ctx.strokeRect(
      Math.min(op.from.x, op.to.x),
      Math.min(op.from.y, op.to.y),
      Math.abs(op.to.x - op.from.x),
      Math.abs(op.to.y - op.from.y)
    )
  }
  ctx.restore()
}

function textDimensions(
  op: Extract<AnnotationOp, { kind: 'text' }>,
  ctx?: CanvasRenderingContext2D | null
): { width: number; height: number } {
  const lines = op.text.split(/\r?\n/)
  let width = 0
  if (ctx) {
    ctx.save()
    ctx.font = `${op.fontWeight} ${op.fontSize}px ${ANNOTATION_FONT_STACKS[op.fontFamily]}`
    width = Math.max(...lines.map((line) => ctx.measureText(line || ' ').width))
    ctx.restore()
  } else {
    width = Math.max(...lines.map((line) => Math.max(1, Array.from(line).length) * op.fontSize * 0.62))
  }
  return { width, height: Math.max(1, lines.length) * op.fontSize * TEXT_LINE_HEIGHT }
}

export function annotationBounds(
  op: AnnotationOp,
  ctx?: CanvasRenderingContext2D | null
): AnnotationBounds {
  if (op.kind === 'text') {
    const dimensions = textDimensions(op, ctx)
    return { x: op.x, y: op.y, ...dimensions }
  }
  const points = op.kind === 'pen' ? op.points : [op.from, op.to]
  if (points.length === 0) return { x: 0, y: 0, width: 0, height: 0 }
  const xs = points.map((point) => point.x)
  const ys = points.map((point) => point.y)
  const x = Math.min(...xs)
  const y = Math.min(...ys)
  return { x, y, width: Math.max(...xs) - x, height: Math.max(...ys) - y }
}

function distanceToSegment(point: AnnotationPoint, from: AnnotationPoint, to: AnnotationPoint): number {
  const dx = to.x - from.x
  const dy = to.y - from.y
  const lengthSq = dx * dx + dy * dy
  if (lengthSq === 0) return Math.hypot(point.x - from.x, point.y - from.y)
  const ratio = Math.max(0, Math.min(1, ((point.x - from.x) * dx + (point.y - from.y) * dy) / lengthSq))
  return Math.hypot(point.x - (from.x + ratio * dx), point.y - (from.y + ratio * dy))
}

function pointInBounds(point: AnnotationPoint, bounds: AnnotationBounds, padding: number): boolean {
  return point.x >= bounds.x - padding && point.x <= bounds.x + bounds.width + padding &&
    point.y >= bounds.y - padding && point.y <= bounds.y + bounds.height + padding
}

export function annotationContainsPoint(
  op: AnnotationOp,
  point: AnnotationPoint,
  tolerance: number,
  ctx?: CanvasRenderingContext2D | null
): boolean {
  if (op.kind === 'text') return pointInBounds(point, annotationBounds(op, ctx), tolerance)
  if (op.kind === 'rect') return pointInBounds(point, annotationBounds(op), tolerance)
  const threshold = tolerance + op.width / 2
  if (op.kind === 'arrow') return distanceToSegment(point, op.from, op.to) <= threshold
  for (let index = 1; index < op.points.length; index++) {
    if (distanceToSegment(point, op.points[index - 1], op.points[index]) <= threshold) return true
  }
  return op.points.length === 1 && Math.hypot(point.x - op.points[0].x, point.y - op.points[0].y) <= threshold
}

export function hitTestAnnotations(
  ops: readonly AnnotationOp[],
  point: AnnotationPoint,
  tolerance: number,
  ctx?: CanvasRenderingContext2D | null
): string | null {
  for (let index = ops.length - 1; index >= 0; index--) {
    if (annotationContainsPoint(ops[index], point, tolerance, ctx)) return ops[index].id
  }
  return null
}

export function annotationHandles(
  op: AnnotationOp,
  ctx?: CanvasRenderingContext2D | null
): PositionedAnnotationHandle[] {
  if (op.kind === 'text') return []
  if (op.kind === 'arrow') {
    return [{ handle: 'start', point: op.from }, { handle: 'end', point: op.to }]
  }
  const bounds = annotationBounds(op, ctx)
  return [
    { handle: 'nw', point: { x: bounds.x, y: bounds.y } },
    { handle: 'ne', point: { x: bounds.x + bounds.width, y: bounds.y } },
    { handle: 'se', point: { x: bounds.x + bounds.width, y: bounds.y + bounds.height } },
    { handle: 'sw', point: { x: bounds.x, y: bounds.y + bounds.height } }
  ]
}

export function hitTestAnnotationHandle(
  op: AnnotationOp,
  point: AnnotationPoint,
  tolerance: number,
  ctx?: CanvasRenderingContext2D | null
): AnnotationHandle | null {
  return annotationHandles(op, ctx).find((item) => Math.hypot(point.x - item.point.x, point.y - item.point.y) <= tolerance)?.handle ?? null
}

export function paintAnnotationSelection(
  ctx: CanvasRenderingContext2D,
  op: AnnotationOp,
  canvasUnitsPerRenderedPixel: number
): void {
  const bounds = annotationBounds(op, ctx)
  const padding = 4 * canvasUnitsPerRenderedPixel
  ctx.save()
  ctx.globalAlpha = 1
  ctx.strokeStyle = '#60a5fa'
  ctx.lineWidth = Math.max(1, canvasUnitsPerRenderedPixel)
  ctx.setLineDash([4 * canvasUnitsPerRenderedPixel, 3 * canvasUnitsPerRenderedPixel])
  ctx.strokeRect(bounds.x - padding, bounds.y - padding, bounds.width + padding * 2, bounds.height + padding * 2)
  ctx.setLineDash([])
  for (const item of annotationHandles(op, ctx)) {
    ctx.beginPath()
    ctx.fillStyle = '#ffffff'
    ctx.strokeStyle = '#2563eb'
    ctx.lineWidth = Math.max(1, canvasUnitsPerRenderedPixel)
    ctx.arc(item.point.x, item.point.y, 5 * canvasUnitsPerRenderedPixel, 0, Math.PI * 2)
    ctx.fill()
    ctx.stroke()
  }
  ctx.restore()
}

export function translateAnnotation(op: AnnotationOp, dx: number, dy: number): AnnotationOp {
  const move = (point: AnnotationPoint): AnnotationPoint => ({ x: point.x + dx, y: point.y + dy })
  if (op.kind === 'text') return { ...op, x: op.x + dx, y: op.y + dy }
  if (op.kind === 'pen') return { ...op, points: op.points.map(move) }
  return { ...op, from: move(op.from), to: move(op.to) }
}

function oppositeCorner(bounds: AnnotationBounds, handle: AnnotationHandle): AnnotationPoint {
  if (handle === 'nw') return { x: bounds.x + bounds.width, y: bounds.y + bounds.height }
  if (handle === 'ne') return { x: bounds.x, y: bounds.y + bounds.height }
  if (handle === 'sw') return { x: bounds.x + bounds.width, y: bounds.y }
  return { x: bounds.x, y: bounds.y }
}

export function resizeAnnotation(
  op: AnnotationOp,
  handle: AnnotationHandle,
  point: AnnotationPoint
): AnnotationOp {
  if (op.kind === 'text') return op
  if (op.kind === 'arrow') {
    if (handle === 'start') return { ...op, from: point }
    if (handle === 'end') return { ...op, to: point }
    return op
  }
  const bounds = annotationBounds(op)
  const anchor = oppositeCorner(bounds, handle)
  if (op.kind === 'rect') return { ...op, from: anchor, to: point }
  const oldWidth = bounds.width || 1
  const oldHeight = bounds.height || 1
  const nextX = Math.min(anchor.x, point.x)
  const nextY = Math.min(anchor.y, point.y)
  const nextWidth = Math.max(1, Math.abs(point.x - anchor.x))
  const nextHeight = Math.max(1, Math.abs(point.y - anchor.y))
  return {
    ...op,
    points: op.points.map((candidate) => ({
      x: nextX + ((candidate.x - bounds.x) / oldWidth) * nextWidth,
      y: nextY + ((candidate.y - bounds.y) / oldHeight) * nextHeight
    }))
  }
}
